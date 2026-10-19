import { BN, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import {
    LegacyUserSnapshot,
    PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    assertLocalCluster,
    assetAuthorityPda,
    assetPda,
    configPda,
    fetchData,
    fund,
    keys,
    legacyProgram,
    randomUserId,
    send,
    snapshotAccount,
    userAssetDataPda,
    writeLegacySnapshot,
} from "./helpers/context";
import {
    MPL_CORE_PROGRAM_ID,
    PluginType,
    decodeAsset,
    findPlugin,
} from "./helpers/mpl-core";

const CONFIG_LEN = 594;
const USER_ASSET_DATA_LEN = 1696;
const LVL_PERCENTAGES = [10, 5];
const MINT_FEE = 1_000_000;

interface PlannedUser {
    name: string;
    walletIndex: number;
    userId: string;
    xp: number;
    level: number;
    luck: number;
    travelPoints: number;
    mint: boolean;
}

describe("legacy setup (pre-upgrade program)", () => {
    let program: Program<Idl>;
    const { admin, governance, feeVault, attacker, wallets } = keys();
    const config = configPda();

    const planned: PlannedUser[] = [
        {
            name: "u1",
            walletIndex: 0,
            userId: randomUserId(),
            xp: 1200,
            level: 3,
            luck: 4,
            travelPoints: 5000,
            mint: true,
        },
        {
            name: "u2",
            walletIndex: 1,
            userId: randomUserId(),
            xp: 800,
            level: 2,
            luck: 7,
            travelPoints: 250,
            mint: true,
        },
        {
            name: "u3",
            walletIndex: 2,
            userId: randomUserId(),
            xp: 300,
            level: 1,
            luck: 1,
            travelPoints: 0,
            mint: true,
        },
        {
            name: "u4",
            walletIndex: 3,
            userId: randomUserId(),
            xp: 50,
            level: 1,
            luck: 2,
            travelPoints: 10,
            mint: false,
        },
    ];

    const wallet = (u: PlannedUser) => wallets[u.walletIndex];
    const byName = (name: string) => {
        const u = planned.find((p) => p.name === name);
        assert.ok(u);
        return u;
    };

    before(async () => {
        await assertLocalCluster();
        program = legacyProgram();
        await fund([
            admin.publicKey,
            governance.publicKey,
            feeVault.publicKey,
            attacker.publicKey,
        ]);
        await fund(wallets.map((w) => w.publicKey));
    });

    it("initializes the config with the legacy layout", async () => {
        const ix = await program.methods
            .initialize({
                lvlPercentages: LVL_PERCENTAGES,
                mintSoulboundFee: new BN(MINT_FEE),
            })
            .accounts({
                config,
                initializer: admin.publicKey,
                admin: admin.publicKey,
                feeVault: feeVault.publicKey,
                systemProgram: SYSTEM_PROGRAM_ID,
            })
            .instruction();
        await send([ix], [admin], { label: "legacy initialize" });
        const data = await fetchData(config);
        assert.equal(data.length, CONFIG_LEN);
        const decoded = program.coder.accounts.decode("Config", data);
        assert.ok((decoded.admin as PublicKey).equals(admin.publicKey));
    });

    it("initializes the users", async () => {
        for (const u of planned) {
            const ix = await program.methods
                .initializeUserAssetData({
                    userId: u.userId,
                    xp: new BN(0),
                    level: 1,
                    luck: 0,
                })
                .accounts({
                    userAssetData: userAssetDataPda(u.userId),
                    user: wallet(u).publicKey,
                    admin: admin.publicKey,
                    config,
                    nomadzProgram: PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                })
                .instruction();
            await send([ix], [admin], { label: `legacy init ${u.name}` });
            assert.equal(
                (await fetchData(userAssetDataPda(u.userId))).length,
                USER_ASSET_DATA_LEN,
            );
        }
    });

    it("applies referrals so the history holds one and two entries", async () => {
        for (const [userName, referrerName] of [
            ["u2", "u1"],
            ["u3", "u2"],
        ]) {
            const ix = await program.methods
                .applyReferral()
                .accounts({
                    userAssetData: userAssetDataPda(byName(userName).userId),
                    referrerAssetData: userAssetDataPda(
                        byName(referrerName).userId,
                    ),
                    authority: admin.publicKey,
                    config,
                })
                .instruction();
            await send([ix], [admin], {
                label: `legacy referral ${userName}<-${referrerName}`,
            });
        }
        const u3 = program.coder.accounts.decode(
            "UserAssetData",
            await fetchData(userAssetDataPda(byName("u3").userId)),
        );
        assert.equal(u3.referralHistory.length, 2);
    });

    it("sets xp, level, luck and travel points", async () => {
        for (const u of planned) {
            const ix = await program.methods
                .updateUserAssetData({
                    userId: u.userId,
                    xp: new BN(u.xp),
                    level: u.level,
                    luck: u.luck,
                    travelPoints: new BN(u.travelPoints),
                    updateReferralXp: false,
                })
                .accounts({
                    userAssetData: userAssetDataPda(u.userId),
                    admin: admin.publicKey,
                    config,
                    nomadzProgram: PROGRAM_ID,
                })
                .instruction();
            await send([ix], [admin], { label: `legacy update ${u.name}` });
        }
    });

    it("mints legacy Nomad IDs with the admin FreezeDelegate", async () => {
        for (const u of planned.filter((p) => p.mint)) {
            const asset = assetPda(u.userId);
            const ix = await program.methods
                .mintSoulboundNft({
                    uri: `https://example.invalid/nomad-id/${u.userId}.json`,
                    userId: u.userId,
                })
                .accounts({
                    userAssetData: userAssetDataPda(u.userId),
                    assetAccount: asset,
                    assetAuthority: assetAuthorityPda(asset),
                    payer: wallet(u).publicKey,
                    user: wallet(u).publicKey,
                    admin: admin.publicKey,
                    config,
                    feeVault: feeVault.publicKey,
                    nomadzProgram: PROGRAM_ID,
                    mplCoreProgram: MPL_CORE_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                })
                .instruction();
            await send([ix], [wallet(u), admin], {
                label: `legacy mint ${u.name}`,
            });
            const decoded = decodeAsset(await fetchData(asset));
            assert.ok(decoded.owner.equals(wallet(u).publicKey));
            const freeze = findPlugin(decoded, PluginType.FreezeDelegate);
            assert.ok(freeze, "legacy asset has a FreezeDelegate");
            assert.equal(freeze.authority.kind, "Address");
            assert.equal(
                findPlugin(decoded, PluginType.PermanentFreezeDelegate),
                undefined,
            );
        }
    });

    it("writes the raw-byte snapshot", async () => {
        const configSnap = await snapshotAccount(config);
        const users: LegacyUserSnapshot[] = [];
        for (const u of planned) {
            const uad = userAssetDataPda(u.userId);
            const uadSnap = await snapshotAccount(uad);
            const decoded = program.coder.accounts.decode(
                "UserAssetData",
                Buffer.from(uadSnap.dataBase64, "base64"),
            );
            assert.equal(decoded.xp.toString(), String(u.xp));
            assert.equal(
                decoded.travelPoints.toString(),
                String(u.travelPoints),
            );
            users.push({
                name: u.name,
                userId: u.userId,
                walletKey: `wallet-${u.walletIndex + 1}`,
                wallet: wallet(u).publicKey.toBase58(),
                userAssetData: uadSnap,
                asset: u.mint
                    ? await snapshotAccount(assetPda(u.userId))
                    : null,
                expected: {
                    xp: String(u.xp),
                    level: u.level,
                    luck: u.luck,
                    travelPoints: String(u.travelPoints),
                    referrers: (
                        decoded.referralHistory as {
                            referrer: PublicKey;
                            level: number;
                        }[]
                    ).map((e) => ({
                        referrer: e.referrer.toBase58(),
                        level: e.level,
                    })),
                },
            });
        }
        assert.deepEqual(
            users.find((u) => u.name === "u2")?.expected.referrers,
            [
                {
                    referrer: userAssetDataPda(byName("u1").userId).toBase58(),
                    level: 1,
                },
            ],
        );
        assert.deepEqual(
            users.find((u) => u.name === "u3")?.expected.referrers,
            [
                {
                    referrer: userAssetDataPda(byName("u1").userId).toBase58(),
                    level: 2,
                },
                {
                    referrer: userAssetDataPda(byName("u2").userId).toBase58(),
                    level: 1,
                },
            ],
        );
        writeLegacySnapshot({
            programId: PROGRAM_ID.toBase58(),
            createdAt: new Date().toISOString(),
            config: {
                ...configSnap,
                expected: {
                    admin: admin.publicKey.toBase58(),
                    feeVault: feeVault.publicKey.toBase58(),
                    mintSoulboundFee: String(MINT_FEE),
                    lvlPercentages: LVL_PERCENTAGES,
                },
            },
            users,
        });
    });
});
