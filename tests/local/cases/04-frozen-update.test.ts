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
    decodeAsset,
    findPlugin,
    isFrozen,
} from "../helpers/mpl-core";

const SOULBOUND_ERROR_NUMBERS: Record<string, number> = {
    Unauthorized: 7000,
    NotProgramDelegated: 7004,
};
const UPDATE_SOULBOUND_NFT_UNAUTHORIZED = 6002;

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

describe("04 soulbound_set_frozen, soulbound_update and the legacy update", () => {
    let program: Program<Idl>;
    const { admin, governance, feeVault, attacker } = keys();
    const config = configPda();
    const owner = throwaway();
    const userId = randomUserId();
    const asset = assetPda(userId);
    let legacyUserId: string;
    let legacyAsset: PublicKey;

    const permanentFreezeState = async (target: PublicKey) => {
        const entry = findPlugin(
            decodeAsset(await fetchData(target)),
            PluginType.PermanentFreezeDelegate,
        );
        assert.ok(
            entry && entry.plugin.type === PluginType.PermanentFreezeDelegate,
        );
        return entry.plugin.frozen;
    };

    const setFrozenIx = (
        targetUserId: string,
        frozen: boolean,
        signer: PublicKey,
    ) => {
        const target = assetPda(targetUserId);
        return program.methods
            .soulboundSetFrozen({ userId: targetUserId, frozen })
            .accounts({
                config,
                userAssetData: userAssetDataPda(targetUserId),
                asset: target,
                assetAuthority: assetAuthorityPda(target),
                admin: signer,
                payer: signer,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
    };

    const updateIx = (
        targetUserId: string,
        args: { newName: string | null; newUri: string | null },
        signer: PublicKey,
    ) => {
        const target = assetPda(targetUserId);
        return program.methods
            .soulboundUpdate({ userId: targetUserId, ...args })
            .accounts({
                config,
                userAssetData: userAssetDataPda(targetUserId),
                asset: target,
                assetAuthority: assetAuthorityPda(target),
                admin: signer,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
    };

    const legacyUpdateIx = (
        targetUserId: string,
        newUri: string,
        signer: PublicKey,
    ) => {
        const target = assetPda(targetUserId);
        return program.methods
            .updateSoulboundNft({ newUri, userId: targetUserId })
            .accounts({
                assetAccount: target,
                assetAuthority: assetAuthorityPda(target),
                admin: signer,
                nomadzProgram: PROGRAM_ID,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
                config,
            })
            .instruction();
    };

    const nonAdmins = (): [string, Keypair][] => [
        ["random signer", attacker],
        ["governance", governance],
    ];

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        await fund([owner.publicKey]);
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
        await send([init], [admin], { label: "04 init v1" });
        await send([mint], [owner, admin], { label: "04 mint v1" });

        const u3 = legacyUser("u3");
        legacyUserId = u3.userId;
        legacyAsset = assetPda(legacyUserId);
        const uad = program.coder.accounts.decode(
            "UserAssetData",
            await fetchData(userAssetDataPda(legacyUserId)),
        );
        assert.equal(uad.assetVersion, 0, "u3 is still legacy");
    });

    describe("AC14 soulbound_set_frozen", () => {
        it("thaws and refreezes a program-delegated asset", async () => {
            assert.equal(await permanentFreezeState(asset), true);
            const thaw = await send(
                [await setFrozenIx(userId, false, admin.publicKey)],
                [admin],
                {
                    label: "AC14 thaw",
                },
            );
            recordCu("soulbound_set_frozen", thaw.unitsConsumed, thaw.size);
            assert.equal(await permanentFreezeState(asset), false);
            assert.equal(isFrozen(decodeAsset(await fetchData(asset))), false);

            await send(
                [await setFrozenIx(userId, true, admin.publicKey)],
                [admin],
                {
                    label: "AC14 freeze",
                },
            );
            assert.equal(await permanentFreezeState(asset), true);
            assert.ok(
                decodeAsset(await fetchData(asset)).owner.equals(
                    owner.publicKey,
                ),
            );
        });

        it("rejects a non-admin signer", async () => {
            for (const [who, signer] of nonAdmins()) {
                await expectSoulbound(
                    send(
                        [await setFrozenIx(userId, false, signer.publicKey)],
                        [signer],
                        {
                            label: `AC14 set_frozen by ${who}`,
                        },
                    ),
                    "Unauthorized",
                );
            }
            assert.equal(await permanentFreezeState(asset), true);
        });

        it("rejects a legacy asset", async () => {
            const before = await fetchData(legacyAsset);
            await expectSoulbound(
                send(
                    [await setFrozenIx(legacyUserId, false, admin.publicKey)],
                    [admin],
                    {
                        label: "AC14 set_frozen legacy",
                    },
                ),
                "NotProgramDelegated",
            );
            assert.ok((await fetchData(legacyAsset)).equals(before));
        });
    });

    describe("AC15 soulbound_update", () => {
        it("changes the name and URI of a program-delegated asset", async () => {
            const newName = "Nomad ID Gold";
            const newUri = `https://example.invalid/nomad-id/${userId}-v2.json`;
            const res = await send(
                [await updateIx(userId, { newName, newUri }, admin.publicKey)],
                [admin],
                { label: "AC15 update v1" },
            );
            recordCu("soulbound_update", res.unitsConsumed, res.size);
            const decoded = decodeAsset(await fetchData(asset));
            assert.equal(decoded.name, newName);
            assert.equal(decoded.uri, newUri);
            assert.ok(isFrozen(decoded), "update keeps the asset frozen");
            assert.equal(decoded.registry.length, 3);
        });

        it("changes only the URI when the name is omitted", async () => {
            const before = decodeAsset(await fetchData(asset));
            const newUri = `https://example.invalid/nomad-id/${userId}-v3.json`;
            await send(
                [
                    await updateIx(
                        userId,
                        { newName: null, newUri },
                        admin.publicKey,
                    ),
                ],
                [admin],
                {
                    label: "AC15 update uri only",
                },
            );
            const after = decodeAsset(await fetchData(asset));
            assert.equal(after.name, before.name);
            assert.equal(after.uri, newUri);
        });

        it("changes the name and URI of a legacy asset", async () => {
            const newName = "Nomad ID Legacy";
            const newUri = `https://example.invalid/nomad-id/${legacyUserId}-v2.json`;
            await send(
                [
                    await updateIx(
                        legacyUserId,
                        { newName, newUri },
                        admin.publicKey,
                    ),
                ],
                [admin],
                { label: "AC15 update legacy" },
            );
            const decoded = decodeAsset(await fetchData(legacyAsset));
            assert.equal(decoded.name, newName);
            assert.equal(decoded.uri, newUri);
            assert.ok(
                findPlugin(decoded, PluginType.FreezeDelegate),
                "legacy plugins kept",
            );
            assert.ok(isFrozen(decoded));
        });

        it("rejects a non-admin signer", async () => {
            const before = await fetchData(asset);
            for (const [who, signer] of nonAdmins()) {
                await expectSoulbound(
                    send(
                        [
                            await updateIx(
                                userId,
                                {
                                    newName: "hijacked",
                                    newUri: "https://example.invalid/x",
                                },
                                signer.publicKey,
                            ),
                        ],
                        [signer],
                        { label: `AC15 update by ${who}` },
                    ),
                    "Unauthorized",
                );
            }
            assert.ok((await fetchData(asset)).equals(before));
        });
    });

    describe("AC15 legacy update_soulbound_nft", () => {
        it("still updates the URI when the admin signs", async () => {
            const newUri = `https://example.invalid/nomad-id/${legacyUserId}-legacy-ix.json`;
            await send(
                [await legacyUpdateIx(legacyUserId, newUri, admin.publicKey)],
                [admin],
                {
                    label: "AC15 legacy update admin",
                },
            );
            assert.equal(decodeAsset(await fetchData(legacyAsset)).uri, newUri);
        });

        it("rejects a non-admin signer", async () => {
            const before = await fetchData(legacyAsset);
            for (const [who, signer] of nonAdmins()) {
                await expectCode(
                    send(
                        [
                            await legacyUpdateIx(
                                legacyUserId,
                                "https://example.invalid/hijacked.json",
                                signer.publicKey,
                            ),
                        ],
                        [signer],
                        { label: `AC15 legacy update by ${who}` },
                    ),
                    "Unauthorized",
                    UPDATE_SOULBOUND_NFT_UNAUTHORIZED,
                );
            }
            assert.ok((await fetchData(legacyAsset)).equals(before));
        });
    });
});
