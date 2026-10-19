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
    MplCoreDiscriminator,
    Plugin,
    PluginType,
    addPluginV1Data,
    approvePluginAuthorityV1Data,
    attributesOf,
    authority,
    burnV1Data,
    createV2Data,
    decodeAsset,
    findPlugin,
    isFrozen,
    plugins,
    rawData,
    removePluginV1Data,
    transferV1Data,
    updatePluginV1Data,
    updateV1Data,
} from "../helpers/mpl-core";

const URI = "https://example.invalid/nomad-id.json";
const MAX_CU = 1_400_000;

const bytes = (values: number[]): Uint8Array => Uint8Array.from(values);

describe("06 soulbound_core_passthrough", () => {
    let program: Program<Idl>;
    const { admin, governance, attacker } = keys();
    const config = configPda();
    let owner: Keypair;
    let userId: string;
    let asset: PublicKey;

    const accountData = async (pubkey: PublicKey): Promise<Buffer> => {
        const info = await connection().getAccountInfo(pubkey, "confirmed");
        return info ? Buffer.from(info.data) : Buffer.alloc(0);
    };

    const mintV1User = async (
        wallet: Keypair,
    ): Promise<{ userId: string; asset: PublicKey }> => {
        const id = randomUserId();
        const uad = userAssetDataPda(id);
        const nomadId = assetPda(id);
        const initIx = await program.methods
            .initializeUserAssetData({
                userId: id,
                xp: new BN(0),
                level: 1,
                luck: 0,
            })
            .accounts({
                userAssetData: uad,
                user: wallet.publicKey,
                admin: admin.publicKey,
                config,
                nomadzProgram: PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([initIx], [admin], { label: "06 init user" });
        const cfg = program.coder.accounts.decode(
            "Config",
            await fetchData(config),
        );
        const mintIx = await program.methods
            .mintSoulboundNft({ uri: URI, userId: id })
            .accounts({
                userAssetData: uad,
                assetAccount: nomadId,
                assetAuthority: assetAuthorityPda(nomadId),
                payer: wallet.publicKey,
                user: wallet.publicKey,
                admin: admin.publicKey,
                config,
                feeVault: cfg.feeVault as PublicKey,
                nomadzProgram: PROGRAM_ID,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([mintIx], [wallet, admin], {
            label: "06 mint v1",
            cu: MAX_CU,
        });
        return { userId: id, asset: nomadId };
    };

    const passIx = (
        data: Buffer,
        opts: {
            userId?: string;
            uadUserId?: string;
            asset?: PublicKey;
            signer?: PublicKey;
            mplCoreProgram?: PublicKey;
        } = {},
    ) => {
        const id = opts.userId ?? userId;
        const target = opts.asset ?? asset;
        const signer = opts.signer ?? governance.publicKey;
        return program.methods
            .soulboundCorePassthrough({ userId: id, data })
            .accounts({
                config,
                userAssetData: userAssetDataPda(opts.uadUserId ?? id),
                asset: target,
                assetAuthority: assetAuthorityPda(target),
                governance: signer,
                payer: signer,
                mplCoreProgram: opts.mplCoreProgram ?? MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
    };

    const spike7: Record<string, unknown> = {};

    const runGovernance = async (
        data: Buffer,
        label: string,
        spikeKey?: string,
    ) => {
        const frozenBefore = isFrozen(decodeAsset(await fetchData(asset)));
        try {
            const res = await send([await passIx(data)], [governance], {
                label,
                cu: MAX_CU,
            });
            recordCu(label, res.unitsConsumed, res.size);
            const frozenAfter = isFrozen(decodeAsset(await fetchData(asset)));
            if (spikeKey) {
                spike7[spikeKey] = {
                    result: "ok",
                    frozenBefore,
                    frozenAfter,
                    unitsConsumed: res.unitsConsumed,
                };
                recordSpike("spike7PassthroughOnFrozenAsset", spike7);
            }
            return res;
        } catch (e) {
            if (spikeKey) {
                const err = e as Error & { logs?: string[] };
                spike7[spikeKey] = {
                    result: "rejected",
                    frozenBefore,
                    error: err.message,
                    logs: (err.logs ?? []).slice(-6),
                };
                recordSpike("spike7PassthroughOnFrozenAsset", spike7);
            }
            throw e;
        }
    };

    const expectRejected = async (
        data: Buffer,
        name: string,
        signer: Keypair = governance,
        opts: Parameters<typeof passIx>[1] = {},
    ) => {
        const target = opts.asset ?? asset;
        const before = await accountData(target);
        await expectError(
            send(
                [await passIx(data, { signer: signer.publicKey, ...opts })],
                [signer],
                { cu: MAX_CU },
            ),
            name,
        );
        assert.ok(
            (await accountData(target)).equals(before),
            `asset bytes unchanged after rejected ${name}`,
        );
    };

    const assertPermanentDelegatesIntact = async () => {
        const decoded = decodeAsset(await fetchData(asset));
        for (const type of [
            PluginType.PermanentFreezeDelegate,
            PluginType.PermanentTransferDelegate,
            PluginType.PermanentBurnDelegate,
        ]) {
            const entry = findPlugin(decoded, type);
            assert.ok(entry, `${PluginType[type]} still present`);
            assert.equal(entry.authority.kind, "Address");
            assert.ok(
                entry.authority.kind === "Address" &&
                    entry.authority.address.equals(assetAuthorityPda(asset)),
                `${PluginType[type]} still held by the PDA`,
            );
        }
        assert.ok(isFrozen(decoded), "asset still frozen");
        assert.ok(decoded.owner.equals(owner.publicKey), "owner unchanged");
    };

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        await ensureGovernanceSet(program);
        owner = throwaway();
        await fund([owner.publicKey]);
        ({ userId, asset } = await mintV1User(owner));
    });

    describe("AC19 allowed instructions succeed on a program-delegated asset", () => {
        it("AddPluginV1 Attributes", async () => {
            await runGovernance(
                addPluginV1Data(
                    plugins.attributes([{ key: "tier", value: "gold" }]),
                ),
                "passthrough AddPluginV1",
                "addPlugin",
            );
            const decoded = decodeAsset(await fetchData(asset));
            assert.deepEqual(attributesOf(decoded), { tier: "gold" });
            const entry = findPlugin(decoded, PluginType.Attributes);
            assert.ok(entry);
            assert.equal(entry.authority.kind, "UpdateAuthority");
            assert.ok(isFrozen(decoded), "still frozen after AddPluginV1");
        });

        it("UpdatePluginV1 Attributes", async () => {
            await runGovernance(
                updatePluginV1Data(
                    plugins.attributes([
                        { key: "tier", value: "platinum" },
                        { key: "verified", value: "true" },
                    ]),
                ),
                "passthrough UpdatePluginV1",
                "updatePlugin",
            );
            const decoded = decodeAsset(await fetchData(asset));
            assert.deepEqual(attributesOf(decoded), {
                tier: "platinum",
                verified: "true",
            });
            assert.ok(isFrozen(decoded), "still frozen after UpdatePluginV1");
        });

        it("RemovePluginV1 Attributes", async () => {
            await runGovernance(
                removePluginV1Data(PluginType.Attributes),
                "passthrough RemovePluginV1",
                "removePlugin",
            );
            const decoded = decodeAsset(await fetchData(asset));
            assert.equal(findPlugin(decoded, PluginType.Attributes), undefined);
            assert.ok(isFrozen(decoded), "still frozen after RemovePluginV1");
        });

        it("AddPluginV1 Attributes with init authority UpdateAuthority", async () => {
            await runGovernance(
                addPluginV1Data(
                    plugins.attributes([{ key: "k", value: "v" }]),
                    authority.updateAuthority(),
                ),
                "passthrough AddPluginV1 UpdateAuthority",
            );
            assert.deepEqual(
                attributesOf(decodeAsset(await fetchData(asset))),
                {
                    k: "v",
                },
            );
        });

        it("UpdateV1 name and uri", async () => {
            await runGovernance(
                updateV1Data({
                    newName: "Nomad ID Renamed",
                    newUri: "https://example.invalid/renamed.json",
                }),
                "passthrough UpdateV1",
                "updateV1",
            );
            const decoded = decodeAsset(await fetchData(asset));
            assert.equal(decoded.name, "Nomad ID Renamed");
            assert.equal(decoded.uri, "https://example.invalid/renamed.json");
            await assertPermanentDelegatesIntact();
        });
    });

    describe("D1 allowlisted Update and Remove on a frozen asset end frozen", () => {
        const royalties = () =>
            plugins.royalties(500, [
                { address: owner.publicKey, percentage: 100 },
            ]);

        it("AddPluginV1 Royalties keeps the asset frozen", async () => {
            assert.ok(isFrozen(decodeAsset(await fetchData(asset))));
            await runGovernance(
                addPluginV1Data(royalties()),
                "passthrough AddPluginV1 Royalties",
                "addPluginRoyalties",
            );
            const decoded = decodeAsset(await fetchData(asset));
            assert.ok(findPlugin(decoded, PluginType.Royalties));
            assert.ok(isFrozen(decoded), "frozen after AddPluginV1 Royalties");
        });

        it("UpdatePluginV1 Royalties on the frozen asset succeeds and ends frozen", async () => {
            assert.ok(isFrozen(decodeAsset(await fetchData(asset))));
            await runGovernance(
                updatePluginV1Data(
                    plugins.royalties(250, [
                        { address: owner.publicKey, percentage: 100 },
                    ]),
                ),
                "passthrough UpdatePluginV1 Royalties",
                "updatePluginRoyalties",
            );
            const decoded = decodeAsset(await fetchData(asset));
            const entry = findPlugin(decoded, PluginType.Royalties);
            assert.ok(entry && entry.plugin.type === PluginType.Royalties);
            assert.equal(entry.plugin.basisPoints, 250);
            assert.ok(isFrozen(decoded), "frozen after UpdatePluginV1");
        });

        it("RemovePluginV1 Royalties on the frozen asset succeeds and ends frozen", async () => {
            assert.ok(isFrozen(decodeAsset(await fetchData(asset))));
            await runGovernance(
                removePluginV1Data(PluginType.Royalties),
                "passthrough RemovePluginV1 Royalties",
                "removePluginRoyalties",
            );
            const decoded = decodeAsset(await fetchData(asset));
            assert.equal(findPlugin(decoded, PluginType.Royalties), undefined);
            assert.ok(isFrozen(decoded), "frozen after RemovePluginV1");
            await assertPermanentDelegatesIntact();
        });
    });

    describe("D4b permanent delegates and lock plugins cannot be targeted", () => {
        const permanent: [string, Plugin][] = [
            ["PermanentFreezeDelegate", plugins.permanentFreezeDelegate(false)],
            [
                "PermanentFreezeDelegate{true}",
                plugins.permanentFreezeDelegate(true),
            ],
            ["PermanentTransferDelegate", plugins.permanentTransferDelegate()],
            ["PermanentBurnDelegate", plugins.permanentBurnDelegate()],
        ];

        for (const [label, plugin] of permanent) {
            it(`rejects Remove, Update and Add of ${label}`, async () => {
                await expectRejected(
                    removePluginV1Data(plugin.type),
                    "PassthroughPluginNotAllowed",
                );
                await expectRejected(
                    updatePluginV1Data(plugin),
                    "PassthroughPluginNotAllowed",
                );
                await expectRejected(
                    addPluginV1Data(plugin),
                    "PassthroughPluginNotAllowed",
                );
                await expectRejected(
                    addPluginV1Data(plugin, authority.updateAuthority()),
                    "PassthroughPluginNotAllowed",
                );
            });
        }

        it("rejects AddPluginV1 ImmutableMetadata and AddBlocker", async () => {
            for (const plugin of [
                plugins.immutableMetadata(),
                plugins.addBlocker(),
            ]) {
                await expectRejected(
                    addPluginV1Data(plugin),
                    "PassthroughPluginNotAllowed",
                );
            }
            await assertPermanentDelegatesIntact();
        });
    });

    describe("AC20 non-allowlisted or malformed data is rejected", () => {
        const notAllowed: [string, Buffer][] = [
            ["TransferV1 (14)", transferV1Data()],
            ["BurnV1 (12)", burnV1Data()],
            [
                "CreateV1 (0)",
                rawData(MplCoreDiscriminator.CreateV1, bytes([0, 0, 0, 0, 0])),
            ],
            ["CreateV2 (20)", createV2Data({ name: "x", uri: "y" })],
            [
                "ApproveCollectionPluginAuthorityV1 (9)",
                rawData(9, bytes([PluginType.Royalties, 2])),
            ],
            [
                "ApprovePluginAuthorityV1 (8)",
                approvePluginAuthorityV1Data(
                    PluginType.PermanentFreezeDelegate,
                    authority.address(PublicKey.default),
                ),
            ],
            [
                "RevokePluginAuthorityV1 (10)",
                rawData(
                    MplCoreDiscriminator.RevokePluginAuthorityV1,
                    bytes([PluginType.PermanentFreezeDelegate]),
                ),
            ],
            [
                "UpdateV2 (30)",
                rawData(MplCoreDiscriminator.UpdateV2, bytes([0, 0, 0, 0])),
            ],
            [
                "ExecuteV1 (31)",
                rawData(MplCoreDiscriminator.ExecuteV1, bytes([0])),
            ],
        ];

        for (const [label, data] of notAllowed) {
            it(`rejects ${label}`, async () => {
                await expectRejected(data, "PassthroughInstructionNotAllowed");
            });
        }

        it("rejects empty data", async () => {
            await expectRejected(Buffer.alloc(0), "InvalidPassthroughData");
        });

        it("rejects truncated data", async () => {
            const full = addPluginV1Data(
                plugins.attributes([{ key: "a", value: "b" }]),
            );
            await expectRejected(
                full.subarray(0, full.length - 2),
                "InvalidPassthroughData",
            );
            await expectRejected(
                rawData(MplCoreDiscriminator.RemovePluginV1),
                "InvalidPassthroughData",
            );
        });

        it("rejects trailing bytes", async () => {
            await expectRejected(
                Buffer.concat([
                    removePluginV1Data(PluginType.Attributes),
                    Buffer.from([0]),
                ]),
                "InvalidPassthroughData",
            );
            await expectRejected(
                Buffer.concat([
                    updateV1Data({ newName: "x" }),
                    Buffer.from([1, 2]),
                ]),
                "InvalidPassthroughData",
            );
        });

        it("rejects UpdateV1 that changes the update authority", async () => {
            await expectRejected(
                updateV1Data({
                    newName: "x",
                    newUpdateAuthority: {
                        kind: "Address",
                        address: attacker.publicKey,
                    },
                }),
                "PassthroughAuthorityNotAllowed",
            );
            await expectRejected(
                updateV1Data({ newUpdateAuthority: { kind: "None" } }),
                "PassthroughAuthorityNotAllowed",
            );
        });

        it("rejects AddPluginV1 with an init authority other than UpdateAuthority", async () => {
            for (const init of [
                authority.address(attacker.publicKey),
                authority.owner(),
                authority.none(),
            ]) {
                await expectRejected(
                    addPluginV1Data(
                        plugins.attributes([{ key: "x", value: "y" }]),
                        init,
                    ),
                    "PassthroughAuthorityNotAllowed",
                );
            }
        });
    });

    describe("AC21 account and signer checks", () => {
        const allowed = () => updateV1Data({ newName: "should not land" });

        it("rejects the hot admin alone", async () => {
            await expectRejected(allowed(), "Unauthorized", admin);
        });

        it("rejects a random signer", async () => {
            await expectRejected(allowed(), "Unauthorized", attacker);
        });

        it("rejects an asset that is not uad.asset", async () => {
            const other = throwaway();
            await fund([other.publicKey]);
            const second = await mintV1User(other);
            await expectRejected(allowed(), "AssetMismatch", governance, {
                asset: second.asset,
            });
        });

        it("rejects a wrong user_id", async () => {
            await expectRejected(allowed(), "ConstraintSeeds", governance, {
                userId: randomUserId(),
                uadUserId: userId,
            });
        });

        it("rejects a substituted mpl_core_program", async () => {
            for (const fake of [
                throwaway().publicKey,
                SYSTEM_PROGRAM_ID,
                PROGRAM_ID,
            ]) {
                await expectRejected(
                    allowed(),
                    "ConstraintAddress",
                    governance,
                    {
                        mplCoreProgram: fake,
                    },
                );
            }
        });

        it("rejects a legacy asset", async () => {
            const u = legacyUser("u3");
            assert.ok(u.asset, "u3 has a legacy asset");
            await expectRejected(allowed(), "NotProgramDelegated", governance, {
                userId: u.userId,
                asset: new PublicKey(u.asset.address),
            });
        });
    });

    describe("AC22 delegate and lock plugins are rejected", () => {
        const delegatePlugins: [string, Plugin][] = [
            ["FreezeDelegate", plugins.freezeDelegate(false)],
            ["BurnDelegate", plugins.burnDelegate()],
            ["TransferDelegate", plugins.transferDelegate()],
            ["UpdateDelegate", plugins.updateDelegate([attacker.publicKey])],
            ["PermanentFreezeDelegate", plugins.permanentFreezeDelegate(false)],
            ["PermanentTransferDelegate", plugins.permanentTransferDelegate()],
            ["PermanentBurnDelegate", plugins.permanentBurnDelegate()],
        ];

        for (const [label, plugin] of delegatePlugins) {
            it(`rejects Add, Update and Remove of ${label}`, async () => {
                await expectRejected(
                    addPluginV1Data(plugin),
                    "PassthroughPluginNotAllowed",
                );
                await expectRejected(
                    updatePluginV1Data(plugin),
                    "PassthroughPluginNotAllowed",
                );
                await expectRejected(
                    removePluginV1Data(plugin.type),
                    "PassthroughPluginNotAllowed",
                );
            });
        }

        for (const [label, plugin] of [
            ["AddBlocker", plugins.addBlocker()],
            ["ImmutableMetadata", plugins.immutableMetadata()],
            ["Edition", plugins.edition(1)],
        ] as [string, Plugin][]) {
            it(`rejects AddPluginV1 ${label}`, async () => {
                await expectRejected(
                    addPluginV1Data(plugin),
                    "PassthroughPluginNotAllowed",
                );
                await expectRejected(
                    addPluginV1Data(plugin, authority.updateAuthority()),
                    "PassthroughPluginNotAllowed",
                );
            });
        }

        it("leaves the permanent delegates intact", async () => {
            await assertPermanentDelegatesIntact();
        });
    });
});
