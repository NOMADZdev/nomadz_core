import { BN, Idl, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import assert from "node:assert/strict";
import {
    LEGACY_IDL_PATH,
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
    loadIdl,
    newProgram,
    randomUserId,
    recordCu,
    send,
    throwaway,
    userAssetDataPda,
} from "../helpers/context";
import {
    MPL_CORE_PROGRAM_ID,
    decodeAsset,
    isBurnedAsset,
    updateV1Data,
} from "../helpers/mpl-core";

const SOULBOUND_ERROR_NUMBERS: Record<string, number> = {
    Unauthorized: 7000,
    GovernanceNotSet: 7001,
};
const UPDATE_CONFIG_ERROR_NUMBERS: Record<string, number> = {
    Unauthorized: 6002,
    InvalidGovernance: 6003,
};

async function expectCode(
    promise: Promise<unknown>,
    name: string,
    errorNumber: number,
): Promise<void> {
    const err = await expectError(promise, name);
    assert.ok(
        err.logs.some((l) => l.includes(`Error Number: ${errorNumber}.`)),
        `expected error number ${errorNumber} for ${name}\n${err.logs.slice(-8).join("\n")}`,
    );
}

const expectSoulbound = (promise: Promise<unknown>, name: string) =>
    expectCode(promise, name, SOULBOUND_ERROR_NUMBERS[name]);

const expectUpdateConfig = (promise: Promise<unknown>, name: string) =>
    expectCode(promise, name, UPDATE_CONFIG_ERROR_NUMBERS[name]);

interface ConfigArgs {
    lvlPercentages?: number[] | null;
    mintSoulboundFee?: BN | null;
    admin?: PublicKey | null;
    feeVault?: PublicKey | null;
    governance?: PublicKey | null;
}

describe("01 governance: bootstrap, governance-only and hot-admin gates", () => {
    let program: Program<Idl>;
    const { admin, governance, feeVault, attacker, wallets } = keys();
    const config = configPda();
    const holder = throwaway();
    const reissueWallet = throwaway();
    const rotatedGovernance = throwaway();
    const v1UserId = randomUserId();
    const bareUserId = randomUserId();

    const decodeConfig = async () =>
        program.coder.accounts.decode("Config", await fetchData(config));

    const decodeUad = async (userId: string) =>
        program.coder.accounts.decode(
            "UserAssetData",
            await fetchData(userAssetDataPda(userId)),
        );

    const updateConfigIx = (authority: PublicKey, args: ConfigArgs) =>
        program.methods
            .updateConfig({
                lvlPercentages: args.lvlPercentages ?? null,
                mintSoulboundFee: args.mintSoulboundFee ?? null,
                admin: args.admin ?? null,
                feeVault: args.feeVault ?? null,
                governance: args.governance ?? null,
            })
            .accounts({
                config,
                authority,
                newAdmin: NO_ACCOUNT,
                newFeeVault: NO_ACCOUNT,
            })
            .instruction();

    const sendUpdateConfig = async (
        signer: Keypair,
        args: ConfigArgs,
        label: string,
    ) =>
        send([await updateConfigIx(signer.publicKey, args)], [signer], {
            label,
        });

    const initUserIx = (userId: string, wallet: PublicKey, signer: PublicKey) =>
        program.methods
            .initializeUserAssetData({
                userId,
                xp: new BN(0),
                level: 1,
                luck: 0,
            })
            .accounts({
                userAssetData: userAssetDataPda(userId),
                user: wallet,
                admin: signer,
                config,
                nomadzProgram: PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();

    const mintIx = (userId: string, payer: PublicKey, signer: PublicKey) => {
        const asset = assetPda(userId);
        return program.methods
            .mintSoulboundNft({
                uri: `https://example.invalid/nomad-id/${userId}.json`,
                userId,
            })
            .accounts({
                userAssetData: userAssetDataPda(userId),
                assetAccount: asset,
                assetAuthority: assetAuthorityPda(asset),
                payer,
                user: payer,
                admin: signer,
                config,
                feeVault: feeVault.publicKey,
                nomadzProgram: PROGRAM_ID,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
    };

    const currentAsset = async (userId: string) =>
        (await decodeUad(userId)).asset as PublicKey;

    const burnIx = async (
        userId: string,
        signer: PublicKey,
        payer: PublicKey,
    ) => {
        const asset = await currentAsset(userId);
        return program.methods
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
    };

    const reissueIx = async (
        userId: string,
        adminSigner: PublicKey,
        payer: PublicKey,
    ) => {
        const uad = await decodeUad(userId);
        const asset = uad.asset as PublicKey;
        const newAsset = assetPda(userId, (uad.reissueCount as number) + 1);
        return {
            newAsset,
            ix: await program.methods
                .soulboundReissue({
                    userId,
                    uri: `https://example.invalid/nomad-id/${userId}-reissued.json`,
                })
                .accounts({
                    config,
                    userAssetData: userAssetDataPda(userId),
                    asset,
                    assetAuthority: assetAuthorityPda(asset),
                    newAsset,
                    newAssetAuthority: assetAuthorityPda(newAsset),
                    admin: adminSigner,
                    payer,
                    mplCoreProgram: MPL_CORE_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                })
                .instruction(),
        };
    };

    const passthroughIx = async (
        userId: string,
        signer: PublicKey,
        payer: PublicKey,
        data: Buffer,
    ) => {
        const asset = await currentAsset(userId);
        return program.methods
            .soulboundCorePassthrough({ userId, data })
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
    };

    const renameData = (name: string) => updateV1Data({ newName: name });

    const governanceOnlyIxs = async (
        signer: Keypair,
    ): Promise<[string, TransactionInstruction, Keypair[]][]> => [
        [
            "soulbound_burn",
            await burnIx(v1UserId, signer.publicKey, signer.publicKey),
            [signer],
        ],
        [
            "soulbound_core_passthrough",
            await passthroughIx(
                v1UserId,
                signer.publicKey,
                signer.publicKey,
                renameData("Nomad ID passthrough"),
            ),
            [signer],
        ],
    ];

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        await fund([
            holder.publicKey,
            reissueWallet.publicKey,
            rotatedGovernance.publicKey,
        ]);
        await send(
            [await initUserIx(v1UserId, holder.publicKey, admin.publicKey)],
            [admin],
            { label: "01 init v1 user" },
        );
        await send(
            [await mintIx(v1UserId, holder.publicKey, admin.publicKey)],
            [holder, admin],
            { label: "01 mint v1 user" },
        );
        await send(
            [
                await initUserIx(
                    bareUserId,
                    wallets[4].publicKey,
                    admin.publicKey,
                ),
            ],
            [admin],
            { label: "01 init bare user" },
        );
        assert.equal((await decodeUad(v1UserId)).assetVersion, 1);
    });

    describe("AC4 while governance is unset", () => {
        it("starts with governance at the default pubkey", async () => {
            const cfg = await decodeConfig();
            assert.ok(
                (cfg.governance as PublicKey).equals(PublicKey.default),
                "01 must run before anything sets governance",
            );
        });

        it("fails every governance-only instruction closed, for governance and admin alike", async () => {
            for (const signer of [governance, admin, attacker]) {
                for (const [name, ix, signers] of await governanceOnlyIxs(
                    signer,
                )) {
                    await expectSoulbound(
                        send([ix], signers, { label: `AC4 ${name}` }),
                        "GovernanceNotSet",
                    );
                }
            }
            const uad = await decodeUad(v1UserId);
            assert.ok((uad.asset as PublicKey).equals(assetPda(v1UserId)));
            assert.equal(uad.reissueCount, 0);
        });

        it("gates soulbound_reissue on config.admin, not on governance", async () => {
            for (const signer of [governance, attacker]) {
                const { ix } = await reissueIx(
                    v1UserId,
                    signer.publicKey,
                    reissueWallet.publicKey,
                );
                await expectSoulbound(
                    send([ix], [signer, reissueWallet], {
                        label: "AC4 reissue by non-admin",
                    }),
                    "Unauthorized",
                );
            }
            assert.equal((await decodeUad(v1UserId)).reissueCount, 0);
        });

        it("rejects update_config from a random signer and from the future governance key", async () => {
            for (const signer of [attacker, governance]) {
                await expectUpdateConfig(
                    sendUpdateConfig(
                        signer,
                        { governance: signer.publicKey },
                        "AC4 update_config non-admin",
                    ),
                    "Unauthorized",
                );
            }
        });

        it("rejects a bootstrap that sets governance to default or to the admin", async () => {
            await expectUpdateConfig(
                sendUpdateConfig(
                    admin,
                    { governance: PublicKey.default },
                    "AC4 governance default",
                ),
                "InvalidGovernance",
            );
            await expectUpdateConfig(
                sendUpdateConfig(
                    admin,
                    { governance: admin.publicKey },
                    "AC4 governance == admin",
                ),
                "InvalidGovernance",
            );
            const cfg = await decodeConfig();
            assert.ok((cfg.governance as PublicKey).equals(PublicKey.default));
        });

        it("lets config.admin set governance once (bootstrap)", async () => {
            const before = await decodeConfig();
            await sendUpdateConfig(
                admin,
                { governance: governance.publicKey },
                "AC4 bootstrap governance",
            );
            const after = await decodeConfig();
            assert.ok(
                (after.governance as PublicKey).equals(governance.publicKey),
            );
            assert.ok((after.admin as PublicKey).equals(before.admin));
            assert.ok((after.feeVault as PublicKey).equals(before.feeVault));
            assert.equal(
                after.mintSoulboundFee.toString(),
                before.mintSoulboundFee.toString(),
            );
            assert.deepEqual(
                Array.from(after.lvlPercentages as number[]),
                Array.from(before.lvlPercentages as number[]),
            );
        });
    });

    describe("AC5 update_config after governance is set", () => {
        it("rejects the hot admin for every field", async () => {
            const before = await fetchData(config);
            const attempts: [string, ConfigArgs][] = [
                ["admin", { admin: throwaway().publicKey }],
                ["fee_vault", { feeVault: throwaway().publicKey }],
                ["governance", { governance: throwaway().publicKey }],
                ["lvl_percentages", { lvlPercentages: [50, 50] }],
                ["mint_soulbound_fee", { mintSoulboundFee: new BN(1) }],
            ];
            for (const [field, args] of attempts) {
                await expectUpdateConfig(
                    sendUpdateConfig(admin, args, `AC5 admin ${field}`),
                    "Unauthorized",
                );
            }
            assert.ok((await fetchData(config)).equals(before));
        });

        it("rejects a random signer", async () => {
            const before = await fetchData(config);
            await expectUpdateConfig(
                sendUpdateConfig(
                    attacker,
                    { lvlPercentages: [1, 1] },
                    "AC5 random signer",
                ),
                "Unauthorized",
            );
            assert.ok((await fetchData(config)).equals(before));
        });

        it("accepts governance for level percentages, fee vault and admin, then restores them", async () => {
            const original = await decodeConfig();
            const originalLvl = Array.from(original.lvlPercentages as number[]);
            const tempVault = throwaway().publicKey;
            const tempAdmin = throwaway().publicKey;

            await sendUpdateConfig(
                governance,
                {
                    lvlPercentages: [20, 7],
                    feeVault: tempVault,
                    admin: tempAdmin,
                },
                "AC5 governance update",
            );
            const changed = await decodeConfig();
            assert.deepEqual(
                Array.from(changed.lvlPercentages as number[]),
                [20, 7],
            );
            assert.ok((changed.feeVault as PublicKey).equals(tempVault));
            assert.ok((changed.admin as PublicKey).equals(tempAdmin));

            await sendUpdateConfig(
                governance,
                {
                    lvlPercentages: originalLvl,
                    feeVault: original.feeVault as PublicKey,
                    admin: original.admin as PublicKey,
                },
                "AC5 governance restore",
            );
            const restored = await decodeConfig();
            assert.deepEqual(
                Array.from(restored.lvlPercentages as number[]),
                originalLvl,
            );
            assert.ok(
                (restored.feeVault as PublicKey).equals(feeVault.publicKey),
            );
            assert.ok((restored.admin as PublicKey).equals(admin.publicKey));
        });

        it("lets governance rotate itself, and only the new key can rotate back", async () => {
            await sendUpdateConfig(
                governance,
                { governance: rotatedGovernance.publicKey },
                "AC5 rotate governance",
            );
            assert.ok(
                ((await decodeConfig()).governance as PublicKey).equals(
                    rotatedGovernance.publicKey,
                ),
            );
            await expectUpdateConfig(
                sendUpdateConfig(
                    governance,
                    { governance: governance.publicKey },
                    "AC5 old governance",
                ),
                "Unauthorized",
            );
            await sendUpdateConfig(
                rotatedGovernance,
                { governance: governance.publicKey },
                "AC5 rotate back",
            );
            assert.ok(
                ((await decodeConfig()).governance as PublicKey).equals(
                    governance.publicKey,
                ),
            );
        });

        it("rejects governance = default, governance = admin and admin = governance", async () => {
            const before = await fetchData(config);
            await expectUpdateConfig(
                sendUpdateConfig(
                    governance,
                    { governance: PublicKey.default },
                    "AC5 governance default",
                ),
                "InvalidGovernance",
            );
            await expectUpdateConfig(
                sendUpdateConfig(
                    governance,
                    { governance: admin.publicKey },
                    "AC5 governance == admin",
                ),
                "InvalidGovernance",
            );
            await expectUpdateConfig(
                sendUpdateConfig(
                    governance,
                    { admin: governance.publicKey },
                    "AC5 admin == governance",
                ),
                "InvalidGovernance",
            );
            assert.ok((await fetchData(config)).equals(before));
        });
    });

    describe("AC6 governance-only instructions", () => {
        it("rejects the hot admin alone and a random signer", async () => {
            for (const signer of [admin, attacker]) {
                for (const [name, ix, signers] of await governanceOnlyIxs(
                    signer,
                )) {
                    await expectSoulbound(
                        send([ix], signers, { label: `AC6 ${name}` }),
                        "Unauthorized",
                    );
                }
            }
            const uad = await decodeUad(v1UserId);
            assert.ok((uad.asset as PublicKey).equals(assetPda(v1UserId)));
            assert.equal(uad.reissueCount, 0);
        });

        it("rejects the hot admin even when governance co-signs as payer", async () => {
            const ix = await passthroughIx(
                v1UserId,
                admin.publicKey,
                governance.publicKey,
                renameData("Nomad ID co-signed"),
            );
            await expectSoulbound(
                send([ix], [admin, governance], {
                    label: "AC6 admin + governance payer",
                }),
                "Unauthorized",
            );
        });

        it("accepts governance for passthrough and burn, with the admin reissuing in between", async () => {
            const renamed = "Nomad ID governed";
            const pass = await send(
                [
                    await passthroughIx(
                        v1UserId,
                        governance.publicKey,
                        governance.publicKey,
                        renameData(renamed),
                    ),
                ],
                [governance],
                { label: "AC6 passthrough" },
            );
            recordCu(
                "soulbound_core_passthrough UpdateV1",
                pass.unitsConsumed,
                pass.size,
            );
            assert.equal(
                decodeAsset(await fetchData(assetPda(v1UserId))).name,
                renamed,
            );

            const { ix, newAsset } = await reissueIx(
                v1UserId,
                admin.publicKey,
                reissueWallet.publicKey,
            );
            const reissue = await send([ix], [admin, reissueWallet], {
                label: "AC6 reissue",
            });
            recordCu(
                "soulbound_reissue v1 (01)",
                reissue.unitsConsumed,
                reissue.size,
            );
            const afterReissue = await decodeUad(v1UserId);
            assert.ok((afterReissue.asset as PublicKey).equals(newAsset));
            assert.ok(
                (afterReissue.user as PublicKey).equals(
                    reissueWallet.publicKey,
                ),
            );
            assert.equal(afterReissue.reissueCount, 1);
            assert.equal(afterReissue.assetVersion, 1);

            const burn = await send(
                [
                    await burnIx(
                        v1UserId,
                        governance.publicKey,
                        governance.publicKey,
                    ),
                ],
                [governance],
                { label: "AC6 burn" },
            );
            recordCu("soulbound_burn (01)", burn.unitsConsumed, burn.size);
            assert.ok(isBurnedAsset(await fetchData(newAsset)));
            assert.ok(
                ((await decodeUad(v1UserId)).asset as PublicKey).equals(
                    PublicKey.default,
                ),
            );
        });
    });

    describe("AC7 hot-admin instructions reject everyone but config.admin", () => {
        const signers = () =>
            [
                ["random signer", attacker],
                ["governance", governance],
            ] as const;

        it("initialize_user_asset_data", async () => {
            for (const [who, signer] of signers()) {
                const userId = randomUserId();
                await expectError(
                    send(
                        [
                            await initUserIx(
                                userId,
                                wallets[5].publicKey,
                                signer.publicKey,
                            ),
                        ],
                        [signer],
                        { label: `AC7 init by ${who}` },
                    ),
                    "Forbidden",
                );
            }
        });

        it("mint_soulbound_nft", async () => {
            for (const [who, signer] of signers()) {
                await expectError(
                    send(
                        [
                            await mintIx(
                                bareUserId,
                                wallets[4].publicKey,
                                signer.publicKey,
                            ),
                        ],
                        [wallets[4], signer],
                        { label: `AC7 mint by ${who}` },
                    ),
                    "Unauthorized",
                );
            }
            const uad = await decodeUad(bareUserId);
            assert.ok((uad.asset as PublicKey).equals(PublicKey.default));
        });

        it("update_user_asset_data", async () => {
            for (const [who, signer] of signers()) {
                const ix = await program.methods
                    .updateUserAssetData({
                        userId: bareUserId,
                        xp: new BN(999_999),
                        level: null,
                        luck: null,
                        travelPoints: null,
                        updateReferralXp: false,
                    })
                    .accounts({
                        userAssetData: userAssetDataPda(bareUserId),
                        admin: signer.publicKey,
                        config,
                        nomadzProgram: PROGRAM_ID,
                    })
                    .instruction();
                await expectError(
                    send([ix], [signer], {
                        label: `AC7 update user by ${who}`,
                    }),
                    "Forbidden",
                );
            }
            assert.equal((await decodeUad(bareUserId)).xp.toString(), "0");
        });

        it("update_user_with_referrer", async () => {
            for (const [who, signer] of signers()) {
                const ix = await program.methods
                    .updateUserWithReferrer({
                        userId: bareUserId,
                        referrerId: v1UserId,
                        userXp: new BN(1),
                        userLevel: null,
                        userLuck: null,
                        referrerXp: null,
                        referrerLevel: null,
                        referrerLuck: null,
                    })
                    .accounts({
                        userAssetData: userAssetDataPda(bareUserId),
                        referrerAssetData: userAssetDataPda(v1UserId),
                        admin: signer.publicKey,
                        config,
                        nomadzProgram: PROGRAM_ID,
                    })
                    .instruction();
                await expectError(
                    send([ix], [signer], {
                        label: `AC7 update with referrer by ${who}`,
                    }),
                    "Forbidden",
                );
            }
        });

        it("apply_referral", async () => {
            for (const [who, signer] of signers()) {
                const ix = await program.methods
                    .applyReferral()
                    .accounts({
                        userAssetData: userAssetDataPda(bareUserId),
                        referrerAssetData: userAssetDataPda(v1UserId),
                        authority: signer.publicKey,
                        config,
                    })
                    .instruction();
                await expectError(
                    send([ix], [signer], { label: `AC7 referral by ${who}` }),
                    "ConstraintAddress",
                );
            }
            assert.equal(
                (await decodeUad(bareUserId)).referralHistory.length,
                0,
            );
        });

        it("soulbound_update, soulbound_transfer, soulbound_set_frozen and soulbound_reissue", async () => {
            const target = randomUserId();
            const owner = throwaway();
            const newWallet = throwaway();
            await fund([owner.publicKey, newWallet.publicKey]);
            await send(
                [await initUserIx(target, owner.publicKey, admin.publicKey)],
                [admin],
                { label: "AC7 init target" },
            );
            await send(
                [await mintIx(target, owner.publicKey, admin.publicKey)],
                [owner, admin],
                { label: "AC7 mint target" },
            );
            const asset = assetPda(target);
            const common = {
                config,
                userAssetData: userAssetDataPda(target),
                asset,
                assetAuthority: assetAuthorityPda(asset),
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            };
            const before = await fetchData(asset);
            for (const [who, signer] of signers()) {
                const update = await program.methods
                    .soulboundUpdate({
                        userId: target,
                        newName: "hijacked",
                        newUri: null,
                    })
                    .accounts({ ...common, admin: signer.publicKey })
                    .instruction();
                await expectSoulbound(
                    send([update], [signer], { label: `AC7 update by ${who}` }),
                    "Unauthorized",
                );
                const transfer = await program.methods
                    .soulboundTransfer({ userId: target })
                    .accounts({
                        ...common,
                        admin: signer.publicKey,
                        payer: newWallet.publicKey,
                        currentOwner: NO_ACCOUNT,
                    })
                    .instruction();
                await expectSoulbound(
                    send([transfer], [signer, newWallet], {
                        label: `AC7 transfer by ${who}`,
                    }),
                    "Unauthorized",
                );
                const frozen = await program.methods
                    .soulboundSetFrozen({ userId: target, frozen: false })
                    .accounts({
                        ...common,
                        admin: signer.publicKey,
                        payer: signer.publicKey,
                    })
                    .instruction();
                await expectSoulbound(
                    send([frozen], [signer], {
                        label: `AC7 set_frozen by ${who}`,
                    }),
                    "Unauthorized",
                );
                const { ix: reissue } = await reissueIx(
                    target,
                    signer.publicKey,
                    newWallet.publicKey,
                );
                await expectSoulbound(
                    send([reissue], [signer, newWallet], {
                        label: `AC7 reissue by ${who}`,
                    }),
                    "Unauthorized",
                );
            }
            const { ix: unsignedReissue } = await reissueIx(
                target,
                admin.publicKey,
                newWallet.publicKey,
            );
            unsignedReissue.keys = unsignedReissue.keys.map((k) =>
                k.pubkey.equals(newWallet.publicKey)
                    ? { ...k, isSigner: false }
                    : k,
            );
            await expectError(
                send([unsignedReissue], [admin], {
                    label: "AC7 reissue without the new owner",
                }),
                "AccountNotSigner",
            );
            assert.equal((await decodeUad(target)).reissueCount, 0);
            assert.ok((await fetchData(asset)).equals(before));
            assert.ok(
                ((await decodeUad(target)).user as PublicKey).equals(
                    owner.publicKey,
                ),
            );
        });
    });

    describe("AC8 Config gains only governance", () => {
        it("has the legacy Config fields plus governance and no new fee field", () => {
            const fieldNames = (idl: Idl, account: string) => {
                const def = (idl.accounts ?? []).find(
                    (a) => a.name === account,
                );
                assert.ok(def, `${account} in IDL`);
                return (def.type as { fields: { name: string }[] }).fields.map(
                    (f) => f.name,
                );
            };
            const legacyFields = fieldNames(loadIdl(LEGACY_IDL_PATH), "Config");
            const newFields = fieldNames(program.idl, "Config");
            assert.deepEqual(
                newFields.filter((f) => f !== "governance"),
                legacyFields,
            );
            assert.equal(newFields.filter((f) => f === "governance").length, 1);
            assert.ok(
                newFields.indexOf("governance") ===
                    newFields.indexOf("feeVault") + 1,
                "governance sits right after feeVault",
            );
            const soulboundArgs = (program.idl.types ?? [])
                .filter((t) => t.name.startsWith("Soulbound"))
                .flatMap((t) =>
                    (
                        (t.type as { fields?: { name: string }[] }).fields ?? []
                    ).map((f) => f.name),
                );
            assert.ok(soulboundArgs.length > 0);
            assert.ok(
                soulboundArgs.every((f) => !/fee|lamports|amount/i.test(f)),
                `no fee args on soulbound instructions: ${soulboundArgs.join(", ")}`,
            );
        });
    });
});
