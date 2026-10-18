import { BN, Idl, Program } from "@coral-xyz/anchor";
import {
    AddressLookupTableAccount,
    AddressLookupTableProgram,
    Keypair,
    NONCE_ACCOUNT_LENGTH,
    NonceAccount,
    PublicKey,
    Signer,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import assert from "node:assert/strict";
import {
    MAX_TX_SIZE,
    NO_ACCOUNT,
    PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    TxError,
    assertLocalCluster,
    assetAuthorityPda,
    assetPda,
    configPda,
    connection,
    ensureGovernanceSet,
    fetchData,
    fund,
    keys,
    lamports,
    newProgram,
    randomUserId,
    recordCu,
    recordSpike,
    send,
    throwaway,
    txSize,
    userAssetDataPda,
    withComputeLimit,
} from "../helpers/context";
import {
    MPL_CORE_PROGRAM_ID,
    PluginAuthorityPair,
    PluginType,
    approvePluginAuthorityV1Ix,
    authority,
    burnV1Ix,
    createV2Ix,
    decodeAsset,
    describeAuthority,
    findPlugin,
    isBurnedAsset,
    plugins,
    transferV1Ix,
    updatePluginV1Ix,
} from "../helpers/mpl-core";

const MAX_CU = 1_400_000;
const FEE_LAMPORTS = 1_000_000;
const MAX_PROCESSING_AGE = 151;
const SPIKE_URI = "https://example.invalid/spike.json";

interface Attempt {
    ok: boolean;
    unitsConsumed: number | null;
    size: number | null;
    error: string | null;
}

async function attempt(
    ixs: TransactionInstruction[],
    signers: Signer[],
    cu: number = MAX_CU,
): Promise<Attempt> {
    try {
        const r = await send(ixs, signers, { cu });
        return {
            ok: true,
            unitsConsumed: r.unitsConsumed,
            size: r.size,
            error: null,
        };
    } catch (e) {
        if (!(e instanceof TxError)) {
            throw e;
        }
        const detail = e.logs
            .filter((l) => /error|failed/i.test(l))
            .slice(-3)
            .join(" | ");
        return {
            ok: false,
            unitsConsumed: null,
            size: null,
            error: `${e.message} ${detail}`.trim(),
        };
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSlotAfter(slot: number): Promise<void> {
    while ((await connection().getSlot("confirmed")) <= slot) {
        await sleep(400);
    }
}

function offlineLookupTable(addresses: PublicKey[]): AddressLookupTableAccount {
    return new AddressLookupTableAccount({
        key: throwaway().publicKey,
        state: {
            deactivationSlot: BigInt("18446744073709551615"),
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
            authority: undefined,
            addresses,
        },
    });
}

function maxFitting(
    build: (n: number) => TransactionInstruction[],
    payer: PublicKey,
    lookup: (n: number) => AddressLookupTableAccount[] = () => [],
): { maxN: number; sizeAtMax: number } {
    let maxN = 0;
    let sizeAtMax = 0;
    for (let n = 1; n <= 128; n++) {
        const size = txSize(
            withComputeLimit(build(n), MAX_CU),
            payer,
            lookup(n),
        );
        if (size > MAX_TX_SIZE) {
            break;
        }
        maxN = n;
        sizeAtMax = size;
    }
    return { maxN, sizeAtMax };
}

describe("08 spike: raw mpl-core behaviour, transaction size and durable nonces", () => {
    const feePayer = throwaway();
    const delegate = throwaway();
    const freezeAdmin = throwaway();
    const updateAuthority = throwaway();
    const oldOwner = throwaway();
    const newOwner = throwaway();
    const rentPayer = throwaway();
    const thirdSigner = throwaway();
    const feeVault = throwaway();

    const permanentTrio = (
        holder: PublicKey,
        frozen: boolean,
    ): PluginAuthorityPair[] => [
        {
            plugin: plugins.permanentFreezeDelegate(frozen),
            authority: authority.address(holder),
        },
        {
            plugin: plugins.permanentTransferDelegate(),
            authority: authority.address(holder),
        },
        {
            plugin: plugins.permanentBurnDelegate(),
            authority: authority.address(holder),
        },
    ];

    async function createAssets(
        count: number,
        owner: PublicKey,
        pluginList: PluginAuthorityPair[],
    ): Promise<PublicKey[]> {
        const out: PublicKey[] = [];
        while (out.length < count) {
            const batch: Keypair[] = [];
            for (let i = 0; i < 2 && out.length + batch.length < count; i++) {
                batch.push(throwaway());
            }
            const ixs = batch.map((a) =>
                createV2Ix(
                    {
                        asset: a.publicKey,
                        payer: feePayer.publicKey,
                        owner,
                        updateAuthority: updateAuthority.publicKey,
                    },
                    { name: "Spike", uri: SPIKE_URI, plugins: pluginList },
                ),
            );
            await send(ixs, [feePayer, ...batch], { label: "spike create" });
            out.push(...batch.map((a) => a.publicKey));
        }
        return out;
    }

    async function createAsset(
        owner: PublicKey,
        pluginList: PluginAuthorityPair[],
    ): Promise<PublicKey> {
        return (await createAssets(1, owner, pluginList))[0];
    }

    async function createLookupTable(
        addresses: PublicKey[],
    ): Promise<AddressLookupTableAccount> {
        const recentSlot = await connection().getSlot("finalized");
        const [createIx, table] = AddressLookupTableProgram.createLookupTable({
            authority: feePayer.publicKey,
            payer: feePayer.publicKey,
            recentSlot,
        });
        await send([createIx], [feePayer], { label: "alt create", cu: null });
        for (let i = 0; i < addresses.length; i += 20) {
            const extendIx = AddressLookupTableProgram.extendLookupTable({
                lookupTable: table,
                authority: feePayer.publicKey,
                payer: feePayer.publicKey,
                addresses: addresses.slice(i, i + 20),
            });
            await send([extendIx], [feePayer], {
                label: "alt extend",
                cu: null,
            });
        }
        await waitForSlotAfter(await connection().getSlot("confirmed"));
        const fetched = (await connection().getAddressLookupTable(table)).value;
        assert.ok(fetched, "lookup table is readable");
        assert.equal(fetched.state.addresses.length, addresses.length);
        return fetched;
    }

    before(async () => {
        await assertLocalCluster();
        await fund(
            [
                feePayer.publicKey,
                delegate.publicKey,
                freezeAdmin.publicKey,
                oldOwner.publicKey,
                newOwner.publicKey,
                rentPayer.publicKey,
                thirdSigner.publicKey,
            ],
            50,
        );
        recordSpike("pending", {
            spike3: "suitcase oracle state: not reproducible on a local validator",
            spike6: "wallet signAllTransactions behaviour: needs real wallets",
            spike8: "Squads-signed execution: needs the Squads program on a public test cluster",
        });
    });

    it("spike 1: permanent transfer and burn delegates on a PermanentFreeze-frozen asset", async () => {
        const frozenForTransfer = await createAsset(
            oldOwner.publicKey,
            permanentTrio(delegate.publicKey, true),
        );
        const transferWhileFrozen = await attempt(
            [
                transferV1Ix({
                    asset: frozenForTransfer,
                    payer: feePayer.publicKey,
                    authority: delegate.publicKey,
                    newOwner: newOwner.publicKey,
                }),
            ],
            [feePayer, delegate],
        );
        const ownerAfterTransfer = decodeAsset(
            await fetchData(frozenForTransfer),
        ).owner.toBase58();

        const frozenForBurn = await createAsset(
            oldOwner.publicKey,
            permanentTrio(delegate.publicKey, true),
        );
        const burnWhileFrozen = await attempt(
            [
                burnV1Ix({
                    asset: frozenForBurn,
                    payer: feePayer.publicKey,
                    authority: delegate.publicKey,
                }),
            ],
            [feePayer, delegate],
        );
        const burnedWhileFrozen = isBurnedAsset(await fetchData(frozenForBurn));

        const thawTransferRefreeze = await createAsset(
            oldOwner.publicKey,
            permanentTrio(delegate.publicKey, true),
        );
        const pluginAccounts = {
            asset: thawTransferRefreeze,
            payer: feePayer.publicKey,
            authority: delegate.publicKey,
        };
        const thawActRefreeze = await attempt(
            [
                updatePluginV1Ix(
                    pluginAccounts,
                    plugins.permanentFreezeDelegate(false),
                ),
                transferV1Ix({
                    ...pluginAccounts,
                    newOwner: newOwner.publicKey,
                }),
                updatePluginV1Ix(
                    pluginAccounts,
                    plugins.permanentFreezeDelegate(true),
                ),
            ],
            [feePayer, delegate],
        );
        const afterThawAct = decodeAsset(await fetchData(thawTransferRefreeze));
        const freezeAfter = findPlugin(
            afterThawAct,
            PluginType.PermanentFreezeDelegate,
        );

        const thawBurnAsset = await createAsset(
            oldOwner.publicKey,
            permanentTrio(delegate.publicKey, true),
        );
        const thawBurn = await attempt(
            [
                updatePluginV1Ix(
                    {
                        asset: thawBurnAsset,
                        payer: feePayer.publicKey,
                        authority: delegate.publicKey,
                    },
                    plugins.permanentFreezeDelegate(false),
                ),
                burnV1Ix({
                    asset: thawBurnAsset,
                    payer: feePayer.publicKey,
                    authority: delegate.publicKey,
                }),
            ],
            [feePayer, delegate],
        );

        recordSpike("spike1", {
            question:
                "Can PermanentTransferDelegate / PermanentBurnDelegate act while PermanentFreezeDelegate is frozen?",
            transferWhileFrozen: {
                ...transferWhileFrozen,
                ownerAfter: ownerAfterTransfer,
            },
            burnWhileFrozen: { ...burnWhileFrozen, burned: burnedWhileFrozen },
            thawTransferRefreeze: {
                ...thawActRefreeze,
                ownerAfter: afterThawAct.owner.toBase58(),
                frozenAfter:
                    freezeAfter?.plugin.type ===
                    PluginType.PermanentFreezeDelegate
                        ? freezeAfter.plugin.frozen
                        : null,
            },
            thawBurn: {
                ...thawBurn,
                burned: isBurnedAsset(await fetchData(thawBurnAsset)),
            },
        });
        assert.ok(
            thawActRefreeze.ok,
            `thaw, transfer, refreeze must work: ${thawActRefreeze.error}`,
        );
        assert.ok(afterThawAct.owner.equals(newOwner.publicKey));
        assert.ok(thawBurn.ok, `thaw then burn must work: ${thawBurn.error}`);
    });

    it("spike 2: legacy FreezeDelegate authority after TransferV1 and same-transaction re-approval", async () => {
        const legacyPlugins: PluginAuthorityPair[] = [
            {
                plugin: plugins.freezeDelegate(true),
                authority: authority.address(freezeAdmin.publicKey),
            },
        ];

        const separate = await createAsset(oldOwner.publicKey, legacyPlugins);
        const thaw = await attempt(
            [
                updatePluginV1Ix(
                    {
                        asset: separate,
                        payer: feePayer.publicKey,
                        authority: freezeAdmin.publicKey,
                    },
                    plugins.freezeDelegate(false),
                ),
            ],
            [feePayer, freezeAdmin],
        );
        const transfer = await attempt(
            [
                transferV1Ix({
                    asset: separate,
                    payer: feePayer.publicKey,
                    authority: oldOwner.publicKey,
                    newOwner: newOwner.publicKey,
                }),
            ],
            [feePayer, oldOwner],
        );
        const afterTransfer = decodeAsset(await fetchData(separate));
        const freezeEntry = findPlugin(
            afterTransfer,
            PluginType.FreezeDelegate,
        );

        const combined = await createAsset(oldOwner.publicKey, legacyPlugins);
        const combinedAccounts = { asset: combined, payer: feePayer.publicKey };
        const combinedResult = await attempt(
            [
                updatePluginV1Ix(
                    { ...combinedAccounts, authority: freezeAdmin.publicKey },
                    plugins.freezeDelegate(false),
                ),
                transferV1Ix({
                    ...combinedAccounts,
                    authority: oldOwner.publicKey,
                    newOwner: newOwner.publicKey,
                }),
                approvePluginAuthorityV1Ix(
                    { ...combinedAccounts, authority: newOwner.publicKey },
                    PluginType.FreezeDelegate,
                    authority.address(freezeAdmin.publicKey),
                ),
                updatePluginV1Ix(
                    { ...combinedAccounts, authority: freezeAdmin.publicKey },
                    plugins.freezeDelegate(true),
                ),
            ],
            [feePayer, freezeAdmin, oldOwner, newOwner],
        );
        const combinedAfter = decodeAsset(await fetchData(combined));
        const combinedFreeze = findPlugin(
            combinedAfter,
            PluginType.FreezeDelegate,
        );

        const noApprove = await createAsset(oldOwner.publicKey, legacyPlugins);
        const noApproveAccounts = {
            asset: noApprove,
            payer: feePayer.publicKey,
        };
        const noApproveResult = await attempt(
            [
                updatePluginV1Ix(
                    { ...noApproveAccounts, authority: freezeAdmin.publicKey },
                    plugins.freezeDelegate(false),
                ),
                transferV1Ix({
                    ...noApproveAccounts,
                    authority: oldOwner.publicKey,
                    newOwner: newOwner.publicKey,
                }),
                updatePluginV1Ix(
                    { ...noApproveAccounts, authority: freezeAdmin.publicKey },
                    plugins.freezeDelegate(true),
                ),
            ],
            [feePayer, freezeAdmin, oldOwner],
        );

        recordSpike("spike2", {
            question:
                "Is the owner-managed FreezeDelegate authority reset by TransferV1, and can it be re-approved in the same transaction?",
            thaw,
            transfer,
            authorityAfterTransfer: freezeEntry
                ? describeAuthority(freezeEntry.authority)
                : "plugin missing",
            resetToOwner: freezeEntry?.authority.kind === "Owner",
            frozenAfterTransfer:
                freezeEntry?.plugin.type === PluginType.FreezeDelegate
                    ? freezeEntry.plugin.frozen
                    : null,
            sameTransactionThawTransferApproveFreeze: {
                ...combinedResult,
                finalAuthority: combinedFreeze
                    ? describeAuthority(combinedFreeze.authority)
                    : "plugin missing",
                finalFrozen:
                    combinedFreeze?.plugin.type === PluginType.FreezeDelegate
                        ? combinedFreeze.plugin.frozen
                        : null,
                owner: combinedAfter.owner.toBase58(),
            },
            sameTransactionWithoutApprove: noApproveResult,
        });
        assert.ok(thaw.ok, `admin thaw: ${thaw.error}`);
        assert.ok(transfer.ok, `owner transfer after thaw: ${transfer.error}`);
    });

    it("spike 4: BurnV1 rent beneficiary with payer different from the authority", async () => {
        const asset = await createAsset(oldOwner.publicKey, [
            {
                plugin: plugins.permanentBurnDelegate(),
                authority: authority.address(delegate.publicKey),
            },
        ]);
        const assetLamports = await lamports(asset);
        const before = {
            payer: await lamports(rentPayer.publicKey),
            authority: await lamports(delegate.publicKey),
            owner: await lamports(oldOwner.publicKey),
            feePayer: await lamports(feePayer.publicKey),
        };
        const result = await attempt(
            [
                burnV1Ix({
                    asset,
                    payer: rentPayer.publicKey,
                    authority: delegate.publicKey,
                }),
            ],
            [feePayer, rentPayer, delegate],
        );
        const info = await connection().getAccountInfo(asset, "confirmed");
        const deltas = {
            payer: (await lamports(rentPayer.publicKey)) - before.payer,
            authority: (await lamports(delegate.publicKey)) - before.authority,
            owner: (await lamports(oldOwner.publicKey)) - before.owner,
            feePayer: (await lamports(feePayer.publicKey)) - before.feePayer,
            asset: (info?.lamports ?? 0) - assetLamports,
        };
        const beneficiary =
            Object.entries(deltas)
                .filter(([k]) => k !== "asset")
                .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
        recordSpike("spike4", {
            question: "Who receives the burned asset rent?",
            result,
            assetLamportsBefore: assetLamports,
            deltas,
            beneficiary,
            leftoverDataLength: info?.data.length ?? null,
            leftoverOwner: info?.owner.toBase58() ?? null,
        });
        assert.ok(result.ok, `burn by permanent delegate: ${result.error}`);
    });

    describe("spike 5: transaction size and compute", () => {
        const fakeAssets = Array.from(
            { length: 128 },
            () => throwaway().publicKey,
        );
        const fakeSigners = Array.from({ length: 128 }, () => throwaway());
        const feeIx = () =>
            SystemProgram.transfer({
                fromPubkey: thirdSigner.publicKey,
                toPubkey: feeVault.publicKey,
                lamports: FEE_LAMPORTS,
            });

        const transferIxs = (assets: PublicKey[]) => [
            feeIx(),
            ...assets.map((asset) =>
                transferV1Ix({
                    asset,
                    payer: feePayer.publicKey,
                    authority: delegate.publicKey,
                    newOwner: newOwner.publicKey,
                }),
            ),
        ];

        const burnCreateIxs = (assets: PublicKey[], fresh: PublicKey[]) => [
            feeIx(),
            ...assets.flatMap((asset, i) => [
                burnV1Ix({
                    asset,
                    payer: feePayer.publicKey,
                    authority: delegate.publicKey,
                }),
                createV2Ix(
                    {
                        asset: fresh[i],
                        payer: feePayer.publicKey,
                        owner: newOwner.publicKey,
                        updateAuthority: updateAuthority.publicKey,
                    },
                    {
                        name: "Nomad ID",
                        uri: SPIKE_URI,
                        plugins: permanentTrio(delegate.publicKey, true),
                    },
                ),
            ]),
        ];

        const commonKeys = [
            newOwner.publicKey,
            feeVault.publicKey,
            updateAuthority.publicKey,
            MPL_CORE_PROGRAM_ID,
            SYSTEM_PROGRAM_ID,
        ];

        it("raw TransferV1 by a permanent delegate, without and with a lookup table", async () => {
            const without = maxFitting(
                (n) => transferIxs(fakeAssets.slice(0, n)),
                feePayer.publicKey,
            );
            const withAlt = maxFitting(
                (n) => transferIxs(fakeAssets.slice(0, n)),
                feePayer.publicKey,
                (n) => [
                    offlineLookupTable([
                        ...commonKeys,
                        ...fakeAssets.slice(0, n),
                    ]),
                ],
            );
            const unfrozen: PluginAuthorityPair[] = [
                {
                    plugin: plugins.permanentTransferDelegate(),
                    authority: authority.address(delegate.publicKey),
                },
            ];
            const realWithout = await createAssets(
                without.maxN,
                oldOwner.publicKey,
                unfrozen,
            );
            const runWithout = await attempt(transferIxs(realWithout), [
                feePayer,
                delegate,
                thirdSigner,
            ]);

            const realWith = await createAssets(
                withAlt.maxN,
                oldOwner.publicKey,
                unfrozen,
            );
            const table = await createLookupTable([...commonKeys, ...realWith]);
            let runWith: Attempt;
            try {
                const r = await send(
                    transferIxs(realWith),
                    [feePayer, delegate, thirdSigner],
                    {
                        cu: MAX_CU,
                        lookupTables: [table],
                    },
                );
                runWith = {
                    ok: true,
                    unitsConsumed: r.unitsConsumed,
                    size: r.size,
                    error: null,
                };
            } catch (e) {
                if (!(e instanceof TxError)) {
                    throw e;
                }
                runWith = {
                    ok: false,
                    unitsConsumed: null,
                    size: null,
                    error: e.message,
                };
            }
            recordSpike("spike5Transfer", {
                signers: 3,
                feeTransfer: true,
                computeLimitIx: true,
                withoutLookupTable: { ...without, run: runWithout },
                withLookupTable: { ...withAlt, run: runWith },
            });
            assert.ok(without.maxN >= 1);
        });

        it("raw BurnV1 + CreateV2 pairs, without and with a lookup table", async () => {
            const build = (n: number) =>
                burnCreateIxs(
                    fakeAssets.slice(0, n),
                    fakeSigners.slice(0, n).map((s) => s.publicKey),
                );
            const without = maxFitting(build, feePayer.publicKey);
            const withAlt = maxFitting(build, feePayer.publicKey, (n) => [
                offlineLookupTable([...commonKeys, ...fakeAssets.slice(0, n)]),
            ]);
            const burnable: PluginAuthorityPair[] = [
                {
                    plugin: plugins.permanentBurnDelegate(),
                    authority: authority.address(delegate.publicKey),
                },
            ];
            const real = await createAssets(
                without.maxN,
                oldOwner.publicKey,
                burnable,
            );
            const fresh = real.map(() => throwaway());
            const run = await attempt(
                burnCreateIxs(
                    real,
                    fresh.map((f) => f.publicKey),
                ),
                [feePayer, delegate, thirdSigner, ...fresh],
            );
            recordSpike("spike5BurnCreate", {
                signers: "3 + one per created asset",
                feeTransfer: true,
                withoutLookupTable: { ...without, run },
                withLookupTable: withAlt,
                note: "every CreateV2 needs the new asset keypair as a signer, which a lookup table cannot hold",
            });
            assert.ok(without.maxN >= 1);
        });

        describe("program instructions", () => {
            let program: Program<Idl>;
            const { admin } = keys();
            const config = configPda();

            before(() => {
                program = newProgram();
            });

            const transferIx = (userId: string, payer: PublicKey) => {
                const asset = assetPda(userId);
                return program.methods
                    .soulboundTransfer({ userId })
                    .accounts({
                        config,
                        userAssetData: userAssetDataPda(userId),
                        asset,
                        assetAuthority: assetAuthorityPda(asset),
                        admin: admin.publicKey,
                        payer,
                        currentOwner: NO_ACCOUNT,
                        mplCoreProgram: MPL_CORE_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                    })
                    .instruction();
            };

            const reissueIx = (
                userId: string,
                current: PublicKey,
                generation: number,
                payer: PublicKey,
            ) => {
                const nextAsset = assetPda(userId, generation);
                return program.methods
                    .soulboundReissue({ userId, uri: SPIKE_URI })
                    .accounts({
                        config,
                        userAssetData: userAssetDataPda(userId),
                        asset: current,
                        assetAuthority: assetAuthorityPda(current),
                        newAsset: nextAsset,
                        newAssetAuthority: assetAuthorityPda(nextAsset),
                        admin: admin.publicKey,
                        payer,
                        mplCoreProgram: MPL_CORE_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                    })
                    .instruction();
            };

            it("records how many soulbound_transfer / soulbound_reissue fit and their compute", async () => {
                const ids = Array.from({ length: 64 }, () => randomUserId());
                const payer = newOwner.publicKey;
                const feeFrom = () =>
                    SystemProgram.transfer({
                        fromPubkey: payer,
                        toPubkey: feeVault.publicKey,
                        lamports: FEE_LAMPORTS,
                    });
                const transfers = await Promise.all(
                    ids.map((id) => transferIx(id, payer)),
                );
                const reissues = await Promise.all(
                    ids.map((id) => reissueIx(id, assetPda(id), 1, payer)),
                );
                const sizeTransfer = maxFitting(
                    (n) => [feeFrom(), ...transfers.slice(0, n)],
                    feePayer.publicKey,
                );
                const sizeReissue = maxFitting(
                    (n) => [feeFrom(), ...reissues.slice(0, n)],
                    feePayer.publicKey,
                );

                const owner = throwaway();
                const nextOwner = throwaway();
                const reissueOwner = throwaway();
                await fund([
                    owner.publicKey,
                    nextOwner.publicKey,
                    reissueOwner.publicKey,
                ]);
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
                await send([initIx], [admin], { label: "spike init user" });
                const cfg = program.coder.accounts.decode(
                    "Config",
                    await fetchData(config),
                );
                const mintIx = await program.methods
                    .mintSoulboundNft({ uri: SPIKE_URI, userId })
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
                const mint = await send([mintIx], [owner, admin], {
                    label: "spike mint v1",
                    cu: MAX_CU,
                });
                recordCu(
                    "mint_soulbound_nft v1",
                    mint.unitsConsumed,
                    mint.size,
                );

                const transfer = await send(
                    [await transferIx(userId, nextOwner.publicKey)],
                    [nextOwner, admin],
                    {
                        label: "spike soulbound_transfer v1",
                        cu: MAX_CU,
                    },
                );
                recordCu(
                    "soulbound_transfer v1",
                    transfer.unitsConsumed,
                    transfer.size,
                );

                await ensureGovernanceSet(program);
                const reissue = await send(
                    [await reissueIx(userId, asset, 1, reissueOwner.publicKey)],
                    [reissueOwner, admin],
                    { label: "spike soulbound_reissue v1", cu: MAX_CU },
                );
                recordCu(
                    "soulbound_reissue v1",
                    reissue.unitsConsumed,
                    reissue.size,
                );

                recordSpike("spike5Program", {
                    signers: 3,
                    feeTransfer: true,
                    soulboundTransfer: { ...sizeTransfer, singleV1: transfer },
                    soulboundReissue: {
                        ...sizeReissue,
                        singleV1FromV1: reissue,
                    },
                });
                assert.ok(sizeTransfer.maxN >= 1);
                assert.ok(sizeReissue.maxN >= 1);
            });
        });

        it("durable nonce: three-signer transaction held past the blockhash lifetime", async () => {
            const nonce = throwaway();
            const rent =
                await connection().getMinimumBalanceForRentExemption(
                    NONCE_ACCOUNT_LENGTH,
                );
            await send(
                [
                    SystemProgram.createNonceAccount({
                        fromPubkey: feePayer.publicKey,
                        noncePubkey: nonce.publicKey,
                        authorizedPubkey: freezeAdmin.publicKey,
                        lamports: rent,
                    }).instructions,
                ].flat(),
                [feePayer, nonce],
                { label: "nonce create", cu: null },
            );
            await waitForSlotAfter(await connection().getSlot("confirmed"));
            const nonceValue = NonceAccount.fromAccountData(
                await fetchData(nonce.publicKey),
            ).nonce;

            const asset = await createAsset(oldOwner.publicKey, []);
            const tx = new Transaction({
                feePayer: newOwner.publicKey,
                nonceInfo: {
                    nonce: nonceValue,
                    nonceInstruction: SystemProgram.nonceAdvance({
                        noncePubkey: nonce.publicKey,
                        authorizedPubkey: freezeAdmin.publicKey,
                    }),
                },
            });
            tx.add(
                SystemProgram.transfer({
                    fromPubkey: newOwner.publicKey,
                    toPubkey: feeVault.publicKey,
                    lamports: FEE_LAMPORTS,
                }),
                transferV1Ix({
                    asset,
                    payer: newOwner.publicKey,
                    authority: oldOwner.publicKey,
                    newOwner: newOwner.publicKey,
                }),
            );
            tx.recentBlockhash = nonceValue;
            tx.partialSign(oldOwner);
            tx.partialSign(newOwner);

            const control = new Transaction({ feePayer: feePayer.publicKey });
            control.add(
                SystemProgram.transfer({
                    fromPubkey: feePayer.publicKey,
                    toPubkey: oldOwner.publicKey,
                    lamports: 1,
                }),
            );
            control.recentBlockhash = (
                await connection().getLatestBlockhash("confirmed")
            ).blockhash;
            control.sign(feePayer);

            const startHeight = await connection().getBlockHeight("confirmed");
            while (
                (await connection().getBlockHeight("confirmed")) <
                startHeight + MAX_PROCESSING_AGE + 1
            ) {
                await sleep(1000);
            }
            const heldBlocks =
                (await connection().getBlockHeight("confirmed")) - startHeight;

            let controlResult: string;
            try {
                await connection().sendRawTransaction(control.serialize(), {
                    skipPreflight: false,
                });
                controlResult = "accepted (unexpected)";
            } catch (e) {
                controlResult = `rejected: ${(e as Error).message.slice(0, 200)}`;
            }

            tx.partialSign(freezeAdmin);
            let nonceResult: Attempt;
            try {
                const signature = await connection().sendRawTransaction(
                    tx.serialize(),
                    { skipPreflight: true },
                );
                let status = null;
                for (let i = 0; i < 60 && !status; i++) {
                    const s = (
                        await connection().getSignatureStatuses([signature])
                    ).value[0];
                    if (
                        s &&
                        (s.confirmationStatus === "confirmed" ||
                            s.confirmationStatus === "finalized")
                    ) {
                        status = s;
                    } else {
                        await sleep(500);
                    }
                }
                const res = await connection().getTransaction(signature, {
                    commitment: "confirmed",
                    maxSupportedTransactionVersion: 0,
                });
                nonceResult = {
                    ok: !!status && !status.err,
                    unitsConsumed: res?.meta?.computeUnitsConsumed ?? null,
                    size: tx.serialize().length,
                    error: status?.err
                        ? JSON.stringify(status.err)
                        : status
                          ? null
                          : "not confirmed",
                };
            } catch (e) {
                nonceResult = {
                    ok: false,
                    unitsConsumed: null,
                    size: null,
                    error: (e as Error).message,
                };
            }
            const after = decodeAsset(await fetchData(asset));
            recordSpike("spike5DurableNonce", {
                signers: [
                    "old owner",
                    "new owner (fee payer)",
                    "admin (nonce authority) last",
                ],
                instructions: ["nonceAdvance", "fee transfer", "TransferV1"],
                heldBlocks,
                regularBlockhashControl: controlResult,
                nonceTransaction: nonceResult,
                ownerAfter: after.owner.toBase58(),
            });
            assert.ok(heldBlocks > MAX_PROCESSING_AGE);
            assert.ok(
                nonceResult.ok,
                `durable nonce transaction: ${nonceResult.error}`,
            );
            assert.ok(after.owner.equals(newOwner.publicKey));
        });
    });
});
