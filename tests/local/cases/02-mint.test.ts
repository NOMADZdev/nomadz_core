import { BN, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import assert from "node:assert/strict";
import {
    PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    assertLocalCluster,
    assetAuthorityPda,
    assetPda,
    configPda,
    expectFailure,
    fetchData,
    fund,
    keys,
    lamports,
    newProgram,
    randomUserId,
    recordCu,
    send,
    throwaway,
    userAssetDataPda,
} from "../helpers/context";
import {
    MPL_CORE_PROGRAM_ID,
    PluginType,
    authority,
    authorityEquals,
    burnV1Ix,
    decodeAsset,
    describeAuthority,
    findPlugin,
    isFrozen,
    plugins,
    transferV1Ix,
    updatePluginV1Ix,
} from "../helpers/mpl-core";

const NOMAD_ID_NAME = "Nomad ID";

describe("02 mint: program-delegated Nomad IDs", () => {
    let program: Program<Idl>;
    const { admin, feeVault, attacker } = keys();
    const config = configPda();
    const owner = throwaway();
    const stranger = throwaway();
    const userId = randomUserId();
    const asset = assetPda(userId);
    const assetAuthority = assetAuthorityPda(asset);
    const uri = `https://example.invalid/nomad-id/${userId}.json`;

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        await fund([owner.publicKey, stranger.publicKey]);
        const ix = await program.methods
            .initializeUserAssetData({
                userId,
                xp: new BN(0),
                level: 1,
                luck: 0,
            })
            .accounts({
                userAssetData: userAssetDataPda(userId),
                user: owner.publicKey,
                admin: admin.publicKey,
                config,
                nomadzProgram: PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([ix], [admin], { label: "02 init user" });
    });

    describe("AC11 mint behaviour", () => {
        it("charges the fee, sets the user asset data and uses the base seeds", async () => {
            const cfg = program.coder.accounts.decode(
                "Config",
                await fetchData(config),
            );
            const fee = BigInt(cfg.mintSoulboundFee.toString());
            const vaultBefore = await lamports(feeVault.publicKey);
            const ix = await program.methods
                .mintSoulboundNft({ uri, userId })
                .accounts({
                    userAssetData: userAssetDataPda(userId),
                    assetAccount: asset,
                    assetAuthority,
                    payer: owner.publicKey,
                    user: owner.publicKey,
                    admin: admin.publicKey,
                    config,
                    feeVault: feeVault.publicKey,
                    nomadzProgram: PROGRAM_ID,
                    mplCoreProgram: MPL_CORE_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                })
                .instruction();
            const res = await send([ix], [owner, admin], { label: "02 mint" });
            recordCu("mint_soulbound_nft", res.unitsConsumed, res.size);
            const vaultAfter = await lamports(feeVault.publicKey);
            assert.equal(
                BigInt(vaultAfter - vaultBefore),
                fee,
                "fee reached the vault",
            );

            const uad = program.coder.accounts.decode(
                "UserAssetData",
                await fetchData(userAssetDataPda(userId)),
            );
            assert.ok(
                (uad.asset as PublicKey).equals(asset),
                "uad.asset is the base-seed PDA",
            );
            assert.ok((uad.user as PublicKey).equals(owner.publicKey));
            assert.equal(uad.assetVersion, 1);
            assert.equal(uad.reissueCount, 0);
            const info = await program.provider.connection.getAccountInfo(
                asset,
                "confirmed",
            );
            assert.ok(
                info?.owner.equals(MPL_CORE_PROGRAM_ID),
                "asset owned by mpl-core",
            );
        });
    });

    describe("AC9 asset shape", () => {
        it("has the PDA as update authority and the three permanent delegates held by the PDA", async () => {
            const decoded = decodeAsset(await fetchData(asset));
            assert.ok(decoded.owner.equals(owner.publicKey));
            assert.equal(decoded.name, NOMAD_ID_NAME);
            assert.equal(decoded.uri, uri);
            assert.equal(decoded.updateAuthority.kind, "Address");
            assert.ok(
                decoded.updateAuthority.kind === "Address" &&
                    decoded.updateAuthority.address.equals(assetAuthority),
                "update authority is the asset_authority PDA",
            );
            const pda = authority.address(assetAuthority);
            for (const type of [
                PluginType.PermanentFreezeDelegate,
                PluginType.PermanentTransferDelegate,
                PluginType.PermanentBurnDelegate,
            ]) {
                const entry = findPlugin(decoded, type);
                assert.ok(entry, `plugin ${PluginType[type]} present`);
                assert.ok(
                    authorityEquals(entry.authority, pda),
                    `${PluginType[type]} authority is the PDA, got ${describeAuthority(entry.authority)}`,
                );
            }
            const freeze = findPlugin(
                decoded,
                PluginType.PermanentFreezeDelegate,
            );
            assert.ok(
                freeze &&
                    freeze.plugin.type === PluginType.PermanentFreezeDelegate &&
                    freeze.plugin.frozen,
                "PermanentFreezeDelegate is frozen",
            );
            assert.ok(isFrozen(decoded));
            for (const type of [
                PluginType.FreezeDelegate,
                PluginType.AddBlocker,
                PluginType.ImmutableMetadata,
            ]) {
                assert.equal(
                    findPlugin(decoded, type),
                    undefined,
                    `no ${PluginType[type]} plugin`,
                );
            }
            assert.equal(decoded.registry.length, 3);
        });
    });

    describe("AC10 nobody bypasses the program through mpl-core", () => {
        const expectRejected = async (
            label: string,
            ix: TransactionInstruction,
            signers: Parameters<typeof send>[1],
        ) => {
            const before = await fetchData(asset);
            const err = await expectFailure(send([ix], signers, { label }));
            assert.ok(
                err.logs.some((l) =>
                    l.includes(MPL_CORE_PROGRAM_ID.toBase58()),
                ),
                `${label} failed inside mpl-core\n${err.logs.slice(-6).join("\n")}`,
            );
            assert.ok(
                (await fetchData(asset)).equals(before),
                `${label} left the asset unchanged`,
            );
        };

        it("rejects the owner transferring directly", async () => {
            await expectRejected(
                "AC10 owner TransferV1",
                transferV1Ix({
                    asset,
                    payer: owner.publicKey,
                    newOwner: stranger.publicKey,
                    authority: owner.publicKey,
                }),
                [owner],
            );
        });

        it("rejects the owner burning directly", async () => {
            await expectRejected(
                "AC10 owner BurnV1",
                burnV1Ix({
                    asset,
                    payer: owner.publicKey,
                    authority: owner.publicKey,
                }),
                [owner],
            );
        });

        it("rejects the admin address as a transfer or burn delegate", async () => {
            await expectRejected(
                "AC10 admin TransferV1",
                transferV1Ix({
                    asset,
                    payer: admin.publicKey,
                    newOwner: stranger.publicKey,
                    authority: admin.publicKey,
                }),
                [admin],
            );
            await expectRejected(
                "AC10 admin BurnV1",
                burnV1Ix({
                    asset,
                    payer: admin.publicKey,
                    authority: admin.publicKey,
                }),
                [admin],
            );
        });

        it("rejects the admin address thawing or touching the permanent delegates", async () => {
            await expectRejected(
                "AC10 admin UpdatePluginV1 PermanentFreeze",
                updatePluginV1Ix(
                    {
                        asset,
                        payer: admin.publicKey,
                        authority: admin.publicKey,
                    },
                    plugins.permanentFreezeDelegate(false),
                ),
                [admin],
            );
            await expectRejected(
                "AC10 owner UpdatePluginV1 PermanentFreeze",
                updatePluginV1Ix(
                    {
                        asset,
                        payer: owner.publicKey,
                        authority: owner.publicKey,
                    },
                    plugins.permanentFreezeDelegate(false),
                ),
                [owner],
            );
        });

        it("rejects a random signer as delegate", async () => {
            await expectRejected(
                "AC10 attacker TransferV1",
                transferV1Ix({
                    asset,
                    payer: attacker.publicKey,
                    newOwner: attacker.publicKey,
                    authority: attacker.publicKey,
                }),
                [attacker],
            );
        });

        it("still has the owner and the frozen state after every attempt", async () => {
            const decoded = decodeAsset(await fetchData(asset));
            assert.ok(decoded.owner.equals(owner.publicKey));
            assert.ok(isFrozen(decoded));
        });
    });
});
