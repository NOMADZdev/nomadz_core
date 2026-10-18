import { BN, Idl, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import {
    NO_ACCOUNT,
    PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    assertLocalCluster,
    assetAuthorityPda,
    assetPda,
    configPda,
    expectError,
    fetchData,
    fund,
    keys,
    legacyUser,
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
    decodeAsset,
    describeAuthority,
    findPlugin,
    isFrozen,
} from "../helpers/mpl-core";

const SOULBOUND_ERROR_NUMBERS: Record<string, number> = {
    Unauthorized: 7000,
    AssetMismatch: 7002,
    OwnerSignatureRequired: 7005,
    OwnerMismatch: 7006,
};

async function expectSoulbound(
    promise: Promise<unknown>,
    name: string,
): Promise<void> {
    const err = await expectError(promise, name);
    const errorNumber = SOULBOUND_ERROR_NUMBERS[name];
    assert.ok(
        err.logs.some((l) => l.includes(`Error Number: ${errorNumber}.`)),
        `expected error number ${errorNumber} for ${name}\n${err.logs.slice(-8).join("\n")}`,
    );
}

describe("03 soulbound_transfer: program-delegated and legacy Nomad IDs", () => {
    let program: Program<Idl>;
    const { admin, governance, feeVault, attacker } = keys();
    const config = configPda();

    const decodeUad = async (userId: string) =>
        program.coder.accounts.decode(
            "UserAssetData",
            await fetchData(userAssetDataPda(userId)),
        );

    const createV1 = async (owner: Keypair): Promise<string> => {
        const userId = randomUserId();
        const asset = assetPda(userId);
        const init = await program.methods
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
        const mint = await program.methods
            .mintSoulboundNft({
                uri: `https://example.invalid/nomad-id/${userId}.json`,
                userId,
            })
            .accounts({
                userAssetData: userAssetDataPda(userId),
                assetAccount: asset,
                assetAuthority: assetAuthorityPda(asset),
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
        await send([init], [admin], { label: "03 init v1" });
        await send([mint], [owner, admin], { label: "03 mint v1" });
        return userId;
    };

    const transferIx = (a: {
        argsUserId: string;
        accountsUserId?: string;
        asset?: PublicKey;
        admin?: PublicKey;
        payer: PublicKey;
        currentOwner?: PublicKey | null;
    }) => {
        const accountsUserId = a.accountsUserId ?? a.argsUserId;
        const asset = a.asset ?? assetPda(accountsUserId);
        return program.methods
            .soulboundTransfer({ userId: a.argsUserId })
            .accounts({
                config,
                userAssetData: userAssetDataPda(accountsUserId),
                asset,
                assetAuthority: assetAuthorityPda(asset),
                admin: a.admin ?? keys().admin.publicKey,
                payer: a.payer,
                currentOwner: a.currentOwner ?? NO_ACCOUNT,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
    };

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
    });

    describe("AC12 program-delegated asset", () => {
        const owner = throwaway();
        const newWallet = throwaway();
        const otherOwner = throwaway();
        let userId: string;
        let otherUserId: string;

        before(async () => {
            await fund([
                owner.publicKey,
                newWallet.publicKey,
                otherOwner.publicKey,
            ]);
            userId = await createV1(owner);
            otherUserId = await createV1(otherOwner);
        });

        it("rejects a signer that is not config.admin", async () => {
            for (const signer of [attacker, governance]) {
                await expectSoulbound(
                    send(
                        [
                            await transferIx({
                                argsUserId: userId,
                                admin: signer.publicKey,
                                payer: newWallet.publicKey,
                            }),
                        ],
                        [signer, newWallet],
                        { label: "AC12 non-admin" },
                    ),
                    "Unauthorized",
                );
            }
        });

        it("rejects a user_id that does not match the user asset data", async () => {
            await expectError(
                send(
                    [
                        await transferIx({
                            argsUserId: otherUserId,
                            accountsUserId: userId,
                            payer: newWallet.publicKey,
                        }),
                    ],
                    [admin, newWallet],
                    { label: "AC12 wrong user_id" },
                ),
                "ConstraintSeeds",
            );
        });

        it("rejects an asset account that is not the user's Nomad ID", async () => {
            await expectSoulbound(
                send(
                    [
                        await transferIx({
                            argsUserId: userId,
                            asset: assetPda(otherUserId),
                            payer: newWallet.publicKey,
                        }),
                    ],
                    [admin, newWallet],
                    { label: "AC12 mismatched asset" },
                ),
                "AssetMismatch",
            );
            await expectSoulbound(
                send(
                    [
                        await transferIx({
                            argsUserId: userId,
                            asset: assetPda(legacyUser("u1").userId),
                            payer: newWallet.publicKey,
                        }),
                    ],
                    [admin, newWallet],
                    { label: "AC12 legacy asset substituted" },
                ),
                "AssetMismatch",
            );
        });

        it("rejects a payer that does not sign", async () => {
            const ix = await transferIx({
                argsUserId: userId,
                payer: newWallet.publicKey,
            });
            ix.keys = ix.keys.map((k) =>
                k.pubkey.equals(newWallet.publicKey)
                    ? { ...k, isSigner: false }
                    : k,
            );
            await expectError(
                send([ix], [admin], { label: "AC12 payer not signing" }),
                "AccountNotSigner",
            );
        });

        it("moves the asset to the new wallet without the owner, ends frozen and updates uad.user", async () => {
            const asset = assetPda(userId);
            const res = await send(
                [
                    await transferIx({
                        argsUserId: userId,
                        payer: newWallet.publicKey,
                    }),
                ],
                [admin, newWallet],
                { label: "AC12 transfer v1" },
            );
            recordCu("soulbound_transfer v1", res.unitsConsumed, res.size);
            const decoded = decodeAsset(await fetchData(asset));
            assert.ok(decoded.owner.equals(newWallet.publicKey));
            const freeze = findPlugin(
                decoded,
                PluginType.PermanentFreezeDelegate,
            );
            assert.ok(
                freeze &&
                    freeze.plugin.type === PluginType.PermanentFreezeDelegate &&
                    freeze.plugin.frozen,
                "ends frozen",
            );
            assert.ok(
                authorityEquals(
                    freeze.authority,
                    authority.address(assetAuthorityPda(asset)),
                ),
            );
            const uad = await decodeUad(userId);
            assert.ok((uad.user as PublicKey).equals(newWallet.publicKey));
            assert.ok((uad.asset as PublicKey).equals(asset));
            assert.equal(uad.assetVersion, 1);
        });

        it("can transfer again, ignoring a passed current_owner", async () => {
            const third = throwaway();
            await fund([third.publicKey]);
            await send(
                [
                    await transferIx({
                        argsUserId: userId,
                        payer: third.publicKey,
                        currentOwner: attacker.publicKey,
                    }),
                ],
                [admin, third, attacker],
                { label: "AC12 second transfer" },
            );
            const decoded = decodeAsset(await fetchData(assetPda(userId)));
            assert.ok(decoded.owner.equals(third.publicKey));
            assert.ok(isFrozen(decoded));
            assert.ok(
                ((await decodeUad(userId)).user as PublicKey).equals(
                    third.publicKey,
                ),
            );
        });
    });

    describe("AC13 legacy asset", () => {
        const newWallet = throwaway();
        const nextWallet = throwaway();
        let userId: string;
        let owner: Keypair;
        let asset: PublicKey;

        const assertLegacyFrozenToAdmin = async (expectedOwner: PublicKey) => {
            const decoded = decodeAsset(await fetchData(asset));
            assert.ok(decoded.owner.equals(expectedOwner), "owner moved");
            const freeze = findPlugin(decoded, PluginType.FreezeDelegate);
            assert.ok(freeze, "legacy FreezeDelegate still present");
            assert.ok(
                freeze.plugin.type === PluginType.FreezeDelegate &&
                    freeze.plugin.frozen,
                "ends frozen",
            );
            assert.ok(
                authorityEquals(
                    freeze.authority,
                    authority.address(admin.publicKey),
                ),
                `freeze authority is the admin, got ${describeAuthority(freeze.authority)}`,
            );
            assert.equal(
                findPlugin(decoded, PluginType.PermanentFreezeDelegate),
                undefined,
            );
        };

        before(async () => {
            const u1 = legacyUser("u1");
            userId = u1.userId;
            owner = u1.walletKeypair;
            asset = assetPda(userId);
            await fund([newWallet.publicKey, nextWallet.publicKey]);
            const uad = await decodeUad(userId);
            assert.equal(uad.assetVersion, 0, "u1 is still legacy");
            assert.ok((uad.asset as PublicKey).equals(asset));
            assert.ok(
                decodeAsset(await fetchData(asset)).owner.equals(
                    owner.publicKey,
                ),
            );
        });

        it("requires the current owner's signature", async () => {
            const before = await fetchData(asset);
            await expectSoulbound(
                send(
                    [
                        await transferIx({
                            argsUserId: userId,
                            payer: newWallet.publicKey,
                        }),
                    ],
                    [admin, newWallet],
                    { label: "AC13 no current_owner" },
                ),
                "OwnerSignatureRequired",
            );
            assert.ok((await fetchData(asset)).equals(before));
        });

        it("rejects a current_owner that does not own the asset", async () => {
            const before = await fetchData(asset);
            await expectSoulbound(
                send(
                    [
                        await transferIx({
                            argsUserId: userId,
                            payer: newWallet.publicKey,
                            currentOwner: attacker.publicKey,
                        }),
                    ],
                    [admin, newWallet, attacker],
                    { label: "AC13 non-owner current_owner" },
                ),
                "OwnerMismatch",
            );
            assert.ok((await fetchData(asset)).equals(before));
        });

        it("rejects a non-admin signer even with the owner signing", async () => {
            await expectSoulbound(
                send(
                    [
                        await transferIx({
                            argsUserId: userId,
                            admin: attacker.publicKey,
                            payer: newWallet.publicKey,
                            currentOwner: owner.publicKey,
                        }),
                    ],
                    [attacker, newWallet, owner],
                    { label: "AC13 non-admin" },
                ),
                "Unauthorized",
            );
        });

        it("transfers with admin + owner + new wallet and hands the freeze authority back to the admin", async () => {
            const res = await send(
                [
                    await transferIx({
                        argsUserId: userId,
                        payer: newWallet.publicKey,
                        currentOwner: owner.publicKey,
                    }),
                ],
                [admin, newWallet, owner],
                { label: "AC13 transfer legacy" },
            );
            recordCu("soulbound_transfer legacy", res.unitsConsumed, res.size);
            await assertLegacyFrozenToAdmin(newWallet.publicKey);
            const uad = await decodeUad(userId);
            assert.ok((uad.user as PublicKey).equals(newWallet.publicKey));
            assert.ok((uad.asset as PublicKey).equals(asset));
            assert.equal(uad.assetVersion, 0);
        });

        it("rejects the previous owner as current_owner after the move", async () => {
            await expectSoulbound(
                send(
                    [
                        await transferIx({
                            argsUserId: userId,
                            payer: nextWallet.publicKey,
                            currentOwner: owner.publicKey,
                        }),
                    ],
                    [admin, nextWallet, owner],
                    { label: "AC13 stale owner" },
                ),
                "OwnerMismatch",
            );
        });

        it("transfers a second time from the new owner", async () => {
            const res = await send(
                [
                    await transferIx({
                        argsUserId: userId,
                        payer: nextWallet.publicKey,
                        currentOwner: newWallet.publicKey,
                    }),
                ],
                [admin, nextWallet, newWallet],
                { label: "AC13 second legacy transfer" },
            );
            recordCu(
                "soulbound_transfer legacy (second hop)",
                res.unitsConsumed,
                res.size,
            );
            await assertLegacyFrozenToAdmin(nextWallet.publicKey);
            assert.ok(
                ((await decodeUad(userId)).user as PublicKey).equals(
                    nextWallet.publicKey,
                ),
            );
        });
    });
});
