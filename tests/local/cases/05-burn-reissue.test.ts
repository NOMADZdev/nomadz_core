import { BN, Idl, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import {
    PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    assertLocalCluster,
    assetAuthorityPda,
    assetPda,
    configPda,
    connection,
    ensureGovernanceSet,
    expectError,
    fetchData,
    fund,
    keys,
    lamports,
    legacyUser,
    newProgram,
    randomUserId,
    recordCu,
    recordSpike,
    send,
    throwaway,
    userAssetDataPda,
} from "../helpers/context";
import {
    MPL_CORE_PROGRAM_ID,
    PluginType,
    attributesOf,
    authorityEquals,
    authority,
    decodeAsset,
    findPlugin,
    isBurnedAsset,
    isFrozen,
} from "../helpers/mpl-core";

const URI = "https://example.invalid/nomad-id.json";
const REISSUE_URI = "https://example.invalid/nomad-id-reissued.json";
const NOMAD_ID_NAME = "Nomad ID";
const MAX_CU = 1_400_000;

interface UadView {
    asset: PublicKey;
    user: PublicKey;
    assetVersion: number;
    reissueCount: number;
}

describe("05 soulbound_burn and soulbound_reissue", () => {
    let program: Program<Idl>;
    const { admin, governance, attacker } = keys();
    const config = configPda();

    const decodeUad = async (userId: string): Promise<UadView> => {
        const d = program.coder.accounts.decode(
            "UserAssetData",
            await fetchData(userAssetDataPda(userId)),
        );
        return {
            asset: d.asset as PublicKey,
            user: d.user as PublicKey,
            assetVersion: Number(d.assetVersion),
            reissueCount: Number(d.reissueCount),
        };
    };

    const accountData = async (pubkey: PublicKey): Promise<Buffer> => {
        const info = await connection().getAccountInfo(pubkey, "confirmed");
        return info ? Buffer.from(info.data) : Buffer.alloc(0);
    };

    const mintV1User = async (
        owner: Keypair,
    ): Promise<{ userId: string; asset: PublicKey }> => {
        const userId = randomUserId();
        const uad = userAssetDataPda(userId);
        const asset = assetPda(userId);
        const initIx = await program.methods
            .initializeUserAssetData({
                userId,
                xp: new BN(0),
                level: 1,
                luck: 0,
            })
            .accounts({
                userAssetData: uad,
                user: owner.publicKey,
                admin: admin.publicKey,
                config,
                nomadzProgram: PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([initIx], [admin], { label: "05 init user" });
        const cfg = program.coder.accounts.decode(
            "Config",
            await fetchData(config),
        );
        const mintIx = await program.methods
            .mintSoulboundNft({ uri: URI, userId })
            .accounts({
                userAssetData: uad,
                assetAccount: asset,
                assetAuthority: assetAuthorityPda(asset),
                payer: owner.publicKey,
                user: owner.publicKey,
                admin: admin.publicKey,
                config,
                feeVault: cfg.feeVault as PublicKey,
                nomadzProgram: PROGRAM_ID,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([mintIx], [owner, admin], {
            label: "05 mint v1",
            cu: MAX_CU,
        });
        return { userId, asset };
    };

    const burnIx = (
        userId: string,
        asset: PublicKey,
        signer: PublicKey,
        payer: PublicKey,
    ) =>
        program.methods
            .soulboundBurn({ userId })
            .accounts({
                config,
                userAssetData: userAssetDataPda(userId),
                asset,
                assetAuthority: assetAuthorityPda(asset),
                governance: signer,
                payer,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();

    const reissueIx = (
        userId: string,
        asset: PublicKey,
        newAsset: PublicKey,
        signer: PublicKey,
        payer: PublicKey,
        uadUserId: string = userId,
    ) =>
        program.methods
            .soulboundReissue({ userId, uri: REISSUE_URI })
            .accounts({
                config,
                userAssetData: userAssetDataPda(uadUserId),
                asset,
                assetAuthority: assetAuthorityPda(asset),
                newAsset,
                newAssetAuthority: assetAuthorityPda(newAsset),
                governance: signer,
                payer,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();

    const assertNomadIdV1 = async (
        asset: PublicKey,
        owner: PublicKey,
    ): Promise<void> => {
        const decoded = decodeAsset(await fetchData(asset));
        const pda = assetAuthorityPda(asset);
        assert.ok(decoded.owner.equals(owner), "new asset owner");
        assert.equal(decoded.name, NOMAD_ID_NAME);
        assert.equal(decoded.uri, REISSUE_URI);
        assert.equal(decoded.updateAuthority.kind, "Address");
        assert.ok(
            decoded.updateAuthority.kind === "Address" &&
                decoded.updateAuthority.address.equals(pda),
            "update authority is the new asset PDA",
        );
        for (const type of [
            PluginType.PermanentFreezeDelegate,
            PluginType.PermanentTransferDelegate,
            PluginType.PermanentBurnDelegate,
        ]) {
            const entry = findPlugin(decoded, type);
            assert.ok(entry, `plugin ${PluginType[type]} present`);
            assert.ok(
                authorityEquals(entry.authority, authority.address(pda)),
                `plugin ${PluginType[type]} held by the PDA`,
            );
        }
        assert.ok(isFrozen(decoded), "new asset is frozen");
        assert.equal(findPlugin(decoded, PluginType.FreezeDelegate), undefined);
    };

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        await ensureGovernanceSet(program);
    });

    describe("AC16 soulbound_burn", () => {
        let owner: Keypair;
        let userId: string;
        let asset: PublicKey;

        before(async () => {
            owner = throwaway();
            await fund([owner.publicKey]);
            ({ userId, asset } = await mintV1User(owner));
        });

        it("rejects the hot admin", async () => {
            await expectError(
                send(
                    [
                        await burnIx(
                            userId,
                            asset,
                            admin.publicKey,
                            admin.publicKey,
                        ),
                    ],
                    [admin],
                ),
                "Unauthorized",
            );
        });

        it("rejects a random signer", async () => {
            await expectError(
                send(
                    [
                        await burnIx(
                            userId,
                            asset,
                            attacker.publicKey,
                            attacker.publicKey,
                        ),
                    ],
                    [attacker],
                ),
                "Unauthorized",
            );
        });

        it("rejects a wrong user_id", async () => {
            const ix = await program.methods
                .soulboundBurn({ userId: randomUserId() })
                .accounts({
                    config,
                    userAssetData: userAssetDataPda(userId),
                    asset,
                    assetAuthority: assetAuthorityPda(asset),
                    governance: governance.publicKey,
                    payer: governance.publicKey,
                    mplCoreProgram: MPL_CORE_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                })
                .instruction();
            await expectError(send([ix], [governance]), "ConstraintSeeds");
        });

        it("rejects an asset that is not the user's current one", async () => {
            const other = throwaway();
            await fund([other.publicKey]);
            const second = await mintV1User(other);
            await expectError(
                send(
                    [
                        await burnIx(
                            userId,
                            second.asset,
                            governance.publicKey,
                            governance.publicKey,
                        ),
                    ],
                    [governance],
                ),
                "AssetMismatch",
            );
        });

        it("rejects a legacy asset (no permanent burn delegate)", async () => {
            const u = legacyUser("u2");
            assert.ok(u.asset, "u2 has a legacy asset");
            const legacyAsset = new PublicKey(u.asset.address);
            const before = await accountData(legacyAsset);
            await expectError(
                send(
                    [
                        await burnIx(
                            u.userId,
                            legacyAsset,
                            governance.publicKey,
                            governance.publicKey,
                        ),
                    ],
                    [governance],
                ),
                "NotProgramDelegated",
            );
            assert.ok(
                (await accountData(legacyAsset)).equals(before),
                "legacy asset unchanged",
            );
        });

        it("governance burns a program-delegated asset and clears uad.asset", async () => {
            const rentReceiver = throwaway();
            await fund([rentReceiver.publicKey], 1);
            const pda = assetAuthorityPda(asset);
            const beforeLamports = {
                payer: await lamports(rentReceiver.publicKey),
                authority: await lamports(pda),
                asset: await lamports(asset),
            };
            const res = await send(
                [
                    await burnIx(
                        userId,
                        asset,
                        governance.publicKey,
                        rentReceiver.publicKey,
                    ),
                ],
                [governance, rentReceiver],
                { label: "05 burn" },
            );
            recordCu("soulbound_burn", res.unitsConsumed, res.size);
            const afterLamports = {
                payer: await lamports(rentReceiver.publicKey),
                authority: await lamports(pda),
                asset: await lamports(asset),
            };
            const data = await accountData(asset);
            assert.ok(isBurnedAsset(data), "asset is left as a burned stub");
            const uad = await decodeUad(userId);
            assert.ok(uad.asset.equals(PublicKey.default), "uad.asset cleared");
            const deltas = {
                payer: afterLamports.payer - beforeLamports.payer,
                authority: afterLamports.authority - beforeLamports.authority,
                asset: afterLamports.asset - beforeLamports.asset,
            };
            recordSpike("soulboundBurnRent", {
                deltas,
                leftoverDataLength: data.length,
                beneficiary:
                    deltas.payer > 0
                        ? "payer"
                        : deltas.authority > 0
                          ? "asset_authority"
                          : "none",
            });
            assert.ok(deltas.asset < 0, "asset lamports were released");
        });
    });

    describe("AC17/AC18 soulbound_reissue", () => {
        let u: ReturnType<typeof legacyUser>;
        let legacyAsset: PublicKey;
        let gen1: PublicKey;
        let newWallet: Keypair;

        before(async () => {
            u = legacyUser("u2");
            assert.ok(u.asset, "u2 has a legacy asset");
            legacyAsset = new PublicKey(u.asset.address);
            gen1 = assetPda(u.userId, 1);
            newWallet = throwaway();
            await fund([newWallet.publicKey]);
            const uad = await decodeUad(u.userId);
            assert.ok(uad.asset.equals(legacyAsset), "u2 still holds gen 0");
            assert.equal(uad.assetVersion, 0);
            assert.equal(uad.reissueCount, 0);
        });

        it("rejects the hot admin", async () => {
            await expectError(
                send(
                    [
                        await reissueIx(
                            u.userId,
                            legacyAsset,
                            gen1,
                            admin.publicKey,
                            newWallet.publicKey,
                        ),
                    ],
                    [admin, newWallet],
                ),
                "Unauthorized",
            );
        });

        it("rejects a random signer", async () => {
            await expectError(
                send(
                    [
                        await reissueIx(
                            u.userId,
                            legacyAsset,
                            gen1,
                            attacker.publicKey,
                            newWallet.publicKey,
                        ),
                    ],
                    [attacker, newWallet],
                ),
                "Unauthorized",
            );
        });

        it("rejects a wrong user_id", async () => {
            await expectError(
                send(
                    [
                        await reissueIx(
                            randomUserId(),
                            legacyAsset,
                            gen1,
                            governance.publicKey,
                            newWallet.publicKey,
                            u.userId,
                        ),
                    ],
                    [governance, newWallet],
                ),
                "ConstraintSeeds",
            );
        });

        it("rejects new_asset at the wrong seed", async () => {
            for (const wrong of [
                assetPda(u.userId, 2),
                assetPda(u.userId, 0),
                assetPda(randomUserId(), 1),
            ]) {
                await expectError(
                    send(
                        [
                            await reissueIx(
                                u.userId,
                                legacyAsset,
                                wrong,
                                governance.publicKey,
                                newWallet.publicKey,
                            ),
                        ],
                        [governance, newWallet],
                    ),
                    "InvalidReissueAsset",
                );
            }
        });

        it("reissues a legacy asset to [.., [1]] and marks the old one revoked", async () => {
            const before = await accountData(legacyAsset);
            const res = await send(
                [
                    await reissueIx(
                        u.userId,
                        legacyAsset,
                        gen1,
                        governance.publicKey,
                        newWallet.publicKey,
                    ),
                ],
                [governance, newWallet],
                { label: "05 reissue legacy", cu: MAX_CU },
            );
            recordCu("soulbound_reissue legacy", res.unitsConsumed, res.size);

            const uad = await decodeUad(u.userId);
            assert.ok(uad.asset.equals(gen1), "uad.asset is gen 1");
            assert.ok(uad.user.equals(newWallet.publicKey), "uad.user");
            assert.equal(uad.reissueCount, 1);
            assert.equal(uad.assetVersion, 1);

            await assertNomadIdV1(gen1, newWallet.publicKey);

            const old = decodeAsset(await fetchData(legacyAsset));
            assert.ok(before.length > 0);
            assert.ok(
                old.owner.equals(new PublicKey(u.wallet)),
                "old asset keeps its owner",
            );
            const attrs = attributesOf(old);
            assert.equal(attrs.status, "revoked");
            assert.equal(attrs.replaced_by, gen1.toBase58());
            const marker = findPlugin(old, PluginType.Attributes);
            assert.ok(marker);
            assert.equal(marker.authority.kind, "UpdateAuthority");
            recordSpike("revokedMarker", {
                oldAsset: legacyAsset,
                newAsset: gen1,
                attributes: attrs,
                markerAuthority: marker.authority.kind,
            });
        });

        it("rejects a second reissue from the same stale asset", async () => {
            await expectError(
                send(
                    [
                        await reissueIx(
                            u.userId,
                            legacyAsset,
                            assetPda(u.userId, 2),
                            governance.publicKey,
                            newWallet.publicKey,
                        ),
                    ],
                    [governance, newWallet],
                ),
                "AssetMismatch",
            );
        });

        it("reissues the new-style gen 1 to [.., [2]] and burns gen 1", async () => {
            const gen2 = assetPda(u.userId, 2);
            const nextWallet = throwaway();
            await fund([nextWallet.publicKey]);
            const res = await send(
                [
                    await reissueIx(
                        u.userId,
                        gen1,
                        gen2,
                        governance.publicKey,
                        nextWallet.publicKey,
                    ),
                ],
                [governance, nextWallet],
                { label: "05 reissue v1", cu: MAX_CU },
            );
            recordCu("soulbound_reissue v1", res.unitsConsumed, res.size);

            assert.ok(isBurnedAsset(await accountData(gen1)), "gen 1 burned");
            const uad = await decodeUad(u.userId);
            assert.ok(uad.asset.equals(gen2), "uad.asset is gen 2");
            assert.ok(uad.user.equals(nextWallet.publicKey));
            assert.equal(uad.reissueCount, 2);
            assert.equal(uad.assetVersion, 1);
            await assertNomadIdV1(gen2, nextWallet.publicKey);

            const old = decodeAsset(await fetchData(legacyAsset));
            assert.equal(attributesOf(old).replaced_by, gen1.toBase58());

            await expectError(
                send(
                    [
                        await reissueIx(
                            u.userId,
                            gen1,
                            assetPda(u.userId, 3),
                            governance.publicKey,
                            nextWallet.publicKey,
                        ),
                    ],
                    [governance, nextWallet],
                ),
                "AssetMismatch",
            );
        });

        it("reissues a freshly minted new-style asset (gen 0 v1) and burns it", async () => {
            const owner = throwaway();
            const target = throwaway();
            await fund([owner.publicKey, target.publicKey]);
            const fresh = await mintV1User(owner);
            const next = assetPda(fresh.userId, 1);
            await send(
                [
                    await reissueIx(
                        fresh.userId,
                        fresh.asset,
                        next,
                        governance.publicKey,
                        target.publicKey,
                    ),
                ],
                [governance, target],
                { label: "05 reissue fresh v1", cu: MAX_CU },
            );
            assert.ok(isBurnedAsset(await accountData(fresh.asset)));
            const uad = await decodeUad(fresh.userId);
            assert.ok(uad.asset.equals(next));
            assert.ok(uad.user.equals(target.publicKey));
            assert.equal(uad.reissueCount, 1);
            assert.equal(uad.assetVersion, 1);
            await assertNomadIdV1(next, target.publicKey);
        });
    });
});
