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
    newProgram,
    randomUserId,
    send,
    throwaway,
    userAssetDataPda,
} from "../helpers/context";
import { MPL_CORE_PROGRAM_ID, decodeAsset } from "../helpers/mpl-core";

interface DecodedEntry {
    referrer: PublicKey;
    level: number;
}

const USER_ASSET_DATA_LEN = 1696;

describe("07 apply_referral: duplicate check on the referrer PDA", () => {
    let program: Program<Idl>;
    const { admin, governance, feeVault, attacker } = keys();
    const config = configPda();
    const referrerWallet = throwaway();
    const referrerNewWallet = throwaway();
    const referrerId = randomUserId();
    const firstId = randomUserId();
    const secondId = randomUserId();
    const chainedId = randomUserId();

    const history = async (userId: string) =>
        (
            program.coder.accounts.decode(
                "UserAssetData",
                await fetchData(userAssetDataPda(userId)),
            ).referralHistory as DecodedEntry[]
        ).map((e) => ({ referrer: e.referrer.toBase58(), level: e.level }));

    const initUser = async (userId: string, wallet: PublicKey) => {
        const ix = await program.methods
            .initializeUserAssetData({
                userId,
                xp: new BN(0),
                level: 1,
                luck: 0,
            })
            .accounts({
                userAssetData: userAssetDataPda(userId),
                user: wallet,
                admin: admin.publicKey,
                config,
                nomadzProgram: PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([ix], [admin], { label: `07 init ${userId}` });
    };

    const referralIx = (userId: string, referrer: string, signer: PublicKey) =>
        program.methods
            .applyReferral()
            .accounts({
                userAssetData: userAssetDataPda(userId),
                referrerAssetData: userAssetDataPda(referrer),
                authority: signer,
                config,
            })
            .instruction();

    let sends = 0;
    const applyReferral = async (
        userId: string,
        referrer: string,
        label: string,
    ) => {
        sends += 1;
        return send(
            [await referralIx(userId, referrer, admin.publicKey)],
            [admin],
            {
                label,
                cu: 200_000 + sends,
            },
        );
    };

    const pda = (userId: string) => userAssetDataPda(userId).toBase58();

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        await fund([referrerWallet.publicKey, referrerNewWallet.publicKey]);
        await initUser(referrerId, referrerWallet.publicKey);
        const asset = assetPda(referrerId);
        const mint = await program.methods
            .mintSoulboundNft({
                uri: `https://example.invalid/nomad-id/${referrerId}.json`,
                userId: referrerId,
            })
            .accounts({
                userAssetData: userAssetDataPda(referrerId),
                assetAccount: asset,
                assetAuthority: assetAuthorityPda(asset),
                payer: referrerWallet.publicKey,
                user: referrerWallet.publicKey,
                admin: admin.publicKey,
                config,
                feeVault: feeVault.publicKey,
                nomadzProgram: PROGRAM_ID,
                mplCoreProgram: MPL_CORE_PROGRAM_ID,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([mint], [referrerWallet, admin], {
            label: "07 mint referrer",
        });
        for (const id of [firstId, secondId, chainedId]) {
            await initUser(id, throwaway().publicKey);
        }
    });

    describe("AC23", () => {
        it("stores the referrer PDA on a first referral", async () => {
            await applyReferral(firstId, referrerId, "AC23 first referral");
            assert.deepEqual(await history(firstId), [
                { referrer: pda(referrerId), level: 1 },
            ]);
        });

        it("treats the same referrer again as a silent no-op", async () => {
            const before = await fetchData(userAssetDataPda(firstId));
            const res = await applyReferral(
                firstId,
                referrerId,
                "AC23 duplicate",
            );
            assert.ok(
                res.logs.some((l) =>
                    l.includes("User already referred by this account"),
                ),
                "duplicate path taken",
            );
            const after = await fetchData(userAssetDataPda(firstId));
            assert.ok(after.equals(before), "user asset data unchanged");
            assert.equal(after.length, USER_ASSET_DATA_LEN);
        });

        it("rejects a signer that is not config.admin", async () => {
            const before = await fetchData(userAssetDataPda(secondId));
            for (const signer of [attacker, governance] as Keypair[]) {
                await expectError(
                    send(
                        [
                            await referralIx(
                                secondId,
                                referrerId,
                                signer.publicKey,
                            ),
                        ],
                        [signer],
                        {
                            label: "AC23 non-admin",
                        },
                    ),
                    "ConstraintAddress",
                );
            }
            assert.ok(
                (await fetchData(userAssetDataPda(secondId))).equals(before),
            );
        });

        it("moves the referrer's wallet with soulbound_transfer", async () => {
            const asset = assetPda(referrerId);
            const ix = await program.methods
                .soulboundTransfer({ userId: referrerId })
                .accounts({
                    config,
                    userAssetData: userAssetDataPda(referrerId),
                    asset,
                    assetAuthority: assetAuthorityPda(asset),
                    admin: admin.publicKey,
                    payer: referrerNewWallet.publicKey,
                    currentOwner: NO_ACCOUNT,
                    mplCoreProgram: MPL_CORE_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                })
                .instruction();
            await send([ix], [admin, referrerNewWallet], {
                label: "AC23 referrer wallet change",
            });
            const uad = program.coder.accounts.decode(
                "UserAssetData",
                await fetchData(userAssetDataPda(referrerId)),
            );
            assert.ok(
                (uad.user as PublicKey).equals(referrerNewWallet.publicKey),
            );
            assert.ok(
                decodeAsset(await fetchData(asset)).owner.equals(
                    referrerNewWallet.publicKey,
                ),
            );
        });

        it("still treats the same referrer as a duplicate after the wallet change", async () => {
            const before = await fetchData(userAssetDataPda(firstId));
            await applyReferral(
                firstId,
                referrerId,
                "AC23 duplicate after wallet change",
            );
            assert.ok(
                (await fetchData(userAssetDataPda(firstId))).equals(before),
            );
            assert.deepEqual(await history(firstId), [
                { referrer: pda(referrerId), level: 1 },
            ]);
        });

        it("accepts a first referral by the same referrer after the wallet change", async () => {
            await applyReferral(
                secondId,
                referrerId,
                "AC23 referral after wallet change",
            );
            assert.deepEqual(await history(secondId), [
                { referrer: pda(referrerId), level: 1 },
            ]);
        });

        it("extends a referrer's history with its PDA, not its wallet", async () => {
            await applyReferral(chainedId, firstId, "AC23 chained referral");
            assert.deepEqual(await history(chainedId), [
                { referrer: pda(referrerId), level: 2 },
                { referrer: pda(firstId), level: 1 },
            ]);
            const before = await fetchData(userAssetDataPda(chainedId));
            await applyReferral(chainedId, firstId, "AC23 chained duplicate");
            assert.ok(
                (await fetchData(userAssetDataPda(chainedId))).equals(before),
            );
        });
    });
});
