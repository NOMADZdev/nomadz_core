import { BN, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    LegacyAccountSnapshot,
    LegacySnapshot,
    PROGRAM_ID,
    ROOT,
    assertLocalCluster,
    configPda,
    connection,
    fetchData,
    keys,
    legacyProgram,
    newProgram,
    readLegacySnapshot,
    send,
    userAssetDataPda,
} from "../helpers/context";

const CONFIG_LEN = 594;
const USER_ASSET_DATA_LEN = 1696;
const PROGRAM_DATA_HEADER = 45;

interface DecodedEntry {
    referrer: PublicKey;
    level: number;
    padding: number[];
}

function allZero(values: ArrayLike<number> | number[][]): boolean {
    return Array.from(values as ArrayLike<number | number[]>).every((v) =>
        Array.isArray(v) ? v.every((x) => x === 0) : v === 0,
    );
}

async function assertBytesUnchanged(
    snap: LegacyAccountSnapshot,
): Promise<Buffer> {
    const info = await connection().getAccountInfo(
        new PublicKey(snap.address),
        "confirmed",
    );
    assert.ok(info, `${snap.address} exists after the upgrade`);
    assert.equal(info.owner.toBase58(), snap.owner);
    assert.equal(info.lamports, snap.lamports);
    const data = Buffer.from(info.data);
    assert.ok(
        data.equals(Buffer.from(snap.dataBase64, "base64")),
        `${snap.address} bytes are identical`,
    );
    return data;
}

describe("00 layout: legacy accounts after the upgrade in place", () => {
    let program: Program<Idl>;
    let legacy: Program<Idl>;
    let snapshot: LegacySnapshot;
    const { admin } = keys();
    const config = configPda();

    const user = (name: string) => {
        const u = snapshot.users.find((x) => x.name === name);
        assert.ok(u, `legacy user ${name}`);
        return u;
    };

    const decodeUad = async (name: string) =>
        program.coder.accounts.decode(
            "UserAssetData",
            await fetchData(userAssetDataPda(user(name).userId)),
        );

    before(async () => {
        await assertLocalCluster();
        program = newProgram();
        legacy = legacyProgram();
        snapshot = readLegacySnapshot();
        assert.equal(snapshot.programId, PROGRAM_ID.toBase58());
    });

    it("runs the new binary at the program address", async () => {
        const programInfo = await connection().getAccountInfo(
            PROGRAM_ID,
            "confirmed",
        );
        assert.ok(programInfo?.executable);
        const programData = new PublicKey(programInfo.data.subarray(4, 36));
        const programDataInfo = await connection().getAccountInfo(
            programData,
            "confirmed",
        );
        assert.ok(programDataInfo);
        const so = fs.readFileSync(
            path.join(ROOT, "target", "deploy", "nomadz_core.so"),
        );
        const deployed = Buffer.from(programDataInfo.data).subarray(
            PROGRAM_DATA_HEADER,
            PROGRAM_DATA_HEADER + so.length,
        );
        assert.ok(
            deployed.equals(so),
            "deployed program bytes equal target/deploy/nomadz_core.so",
        );
        const names = (program.idl.instructions as { name: string }[]).map(
            (i) => i.name,
        );
        for (const name of [
            "soulboundTransfer",
            "soulboundSetFrozen",
            "soulboundUpdate",
            "soulboundBurn",
            "soulboundReissue",
            "soulboundCorePassthrough",
        ]) {
            assert.ok(names.includes(name), `new IDL has ${name}`);
        }
    });

    describe("AC1 Config", () => {
        it("keeps its bytes and size", async () => {
            const data = await assertBytesUnchanged(snapshot.config);
            assert.equal(data.length, CONFIG_LEN);
        });

        it("decodes with the new IDL, governance reads as default", async () => {
            const decoded = program.coder.accounts.decode(
                "Config",
                await fetchData(config),
            );
            const expected = snapshot.config.expected;
            assert.equal(
                (decoded.admin as PublicKey).toBase58(),
                expected.admin,
            );
            assert.equal(
                (decoded.feeVault as PublicKey).toBase58(),
                expected.feeVault,
            );
            assert.equal(
                decoded.mintSoulboundFee.toString(),
                expected.mintSoulboundFee,
            );
            assert.deepEqual(
                Array.from(decoded.lvlPercentages as number[]),
                expected.lvlPercentages,
            );
            assert.ok(
                (decoded.governance as PublicKey).equals(PublicKey.default),
            );
            const padding = (decoded.padding as number[][]).flat();
            assert.equal(padding.length, 480);
            assert.ok(allZero(padding));
        });

        it("still decodes with the legacy IDL", async () => {
            const decoded = legacy.coder.accounts.decode(
                "Config",
                await fetchData(config),
            );
            assert.equal(
                (decoded.admin as PublicKey).toBase58(),
                snapshot.config.expected.admin,
            );
        });
    });

    describe("AC2 UserAssetData", () => {
        it("keeps the bytes and size of every user and asset account", async () => {
            for (const u of snapshot.users) {
                const data = await assertBytesUnchanged(u.userAssetData);
                assert.equal(data.length, USER_ASSET_DATA_LEN);
                if (u.asset) {
                    await assertBytesUnchanged(u.asset);
                }
            }
        });

        it("decodes with the new IDL, all old values kept and the new fields zero", async () => {
            for (const u of snapshot.users) {
                const raw = Buffer.from(u.userAssetData.dataBase64, "base64");
                const before = legacy.coder.accounts.decode(
                    "UserAssetData",
                    raw,
                );
                const after = program.coder.accounts.decode(
                    "UserAssetData",
                    raw,
                );
                assert.equal(
                    (after.user as PublicKey).toBase58(),
                    u.wallet,
                    `${u.name} user`,
                );
                assert.ok(
                    (after.asset as PublicKey).equals(
                        before.asset as PublicKey,
                    ),
                    `${u.name} asset`,
                );
                assert.equal(
                    after.createdAt.toString(),
                    before.createdAt.toString(),
                );
                assert.equal(after.xp.toString(), u.expected.xp);
                assert.equal(after.level, u.expected.level);
                assert.equal(after.luck, u.expected.luck);
                assert.equal(
                    after.travelPoints.toString(),
                    u.expected.travelPoints,
                );
                assert.equal(after.assetVersion, 0, `${u.name} assetVersion`);
                assert.equal(after.reissueCount, 0, `${u.name} reissueCount`);
                const tail = [
                    ...(after.reserved as number[]),
                    ...(after.padding as number[][]).flat(),
                ];
                assert.equal(tail.length, 502);
                assert.ok(allZero(tail));
                const entries = after.referralHistory as DecodedEntry[];
                assert.deepEqual(
                    entries.map((e) => ({
                        referrer: e.referrer.toBase58(),
                        level: e.level,
                    })),
                    u.expected.referrers,
                    `${u.name} referral history`,
                );
                for (const e of entries) {
                    assert.equal(e.padding.length, 512);
                    assert.ok(allZero(e.padding));
                }
            }
        });

        it("covers histories with zero, one and two referral entries", () => {
            const lengths = snapshot.users
                .map((u) => u.expected.referrers.length)
                .sort();
            assert.ok(
                lengths.includes(0) &&
                    lengths.includes(1) &&
                    lengths.includes(2),
            );
        });
    });

    describe("AC3 pre-existing instructions on legacy accounts", () => {
        it("update_user_asset_data pays referral XP through remaining accounts", async () => {
            const u1 = user("u1");
            const u2 = user("u2");
            const u3 = user("u3");
            const cfg = program.coder.accounts.decode(
                "Config",
                await fetchData(config),
            );
            const [p1, p2] = Array.from(cfg.lvlPercentages as number[]);
            const before1 = await decodeUad("u1");
            const before2 = await decodeUad("u2");
            const before3 = await decodeUad("u3");
            const gained = 1000;
            const ix = await program.methods
                .updateUserAssetData({
                    userId: u3.userId,
                    xp: new BN(before3.xp.toString()).addn(gained),
                    level: null,
                    luck: null,
                    travelPoints: new BN(777),
                    updateReferralXp: null,
                })
                .accounts({
                    userAssetData: userAssetDataPda(u3.userId),
                    admin: admin.publicKey,
                    config,
                    nomadzProgram: PROGRAM_ID,
                })
                .remainingAccounts([
                    {
                        pubkey: userAssetDataPda(u2.userId),
                        isSigner: false,
                        isWritable: true,
                    },
                    {
                        pubkey: userAssetDataPda(u1.userId),
                        isSigner: false,
                        isWritable: true,
                    },
                ])
                .instruction();
            await send([ix], [admin], { label: "AC3 update_user_asset_data" });
            const after1 = await decodeUad("u1");
            const after2 = await decodeUad("u2");
            const after3 = await decodeUad("u3");
            assert.equal(
                after3.xp.toString(),
                new BN(before3.xp.toString()).addn(gained).toString(),
            );
            assert.equal(after3.travelPoints.toString(), "777");
            assert.equal(
                after2.xp.toString(),
                new BN(before2.xp.toString())
                    .addn(Math.floor((gained * p1) / 100))
                    .toString(),
            );
            assert.equal(
                after1.xp.toString(),
                new BN(before1.xp.toString())
                    .addn(Math.floor((gained * p2) / 100))
                    .toString(),
            );
            for (const d of [after1, after2, after3]) {
                assert.equal(d.assetVersion, 0);
                assert.equal(d.reissueCount, 0);
                assert.ok(allZero(d.padding as number[]));
            }
            for (const name of ["u1", "u2", "u3"]) {
                assert.equal(
                    (await fetchData(userAssetDataPda(user(name).userId)))
                        .length,
                    USER_ASSET_DATA_LEN,
                );
            }
        });

        it("update_user_with_referrer updates both legacy accounts", async () => {
            const u1 = user("u1");
            const u2 = user("u2");
            const ix = await program.methods
                .updateUserWithReferrer({
                    userId: u2.userId,
                    referrerId: u1.userId,
                    userXp: null,
                    userLevel: null,
                    userLuck: 9,
                    referrerXp: null,
                    referrerLevel: 4,
                    referrerLuck: null,
                })
                .accounts({
                    userAssetData: userAssetDataPda(u2.userId),
                    referrerAssetData: userAssetDataPda(u1.userId),
                    admin: admin.publicKey,
                    config,
                    nomadzProgram: PROGRAM_ID,
                })
                .instruction();
            await send([ix], [admin], {
                label: "AC3 update_user_with_referrer",
            });
            const after1 = await decodeUad("u1");
            const after2 = await decodeUad("u2");
            assert.equal(after2.luck, 9);
            assert.equal(after1.level, 4);
            assert.equal(
                after1.travelPoints.toString(),
                u1.expected.travelPoints,
            );
            assert.equal(
                after2.travelPoints.toString(),
                u2.expected.travelPoints,
            );
            assert.equal(after1.assetVersion, 0);
            assert.equal(after2.reissueCount, 0);
        });

        it("apply_referral with the same referrer leaves the history unchanged", async () => {
            const u2 = user("u2");
            const u3 = user("u3");
            const before = await decodeUad("u3");
            const ix = await program.methods
                .applyReferral()
                .accounts({
                    userAssetData: userAssetDataPda(u3.userId),
                    referrerAssetData: userAssetDataPda(u2.userId),
                    authority: admin.publicKey,
                    config,
                })
                .instruction();
            await send([ix], [admin], {
                label: "AC3 apply_referral duplicate",
            });
            const after = await decodeUad("u3");
            assert.deepEqual(
                (after.referralHistory as DecodedEntry[]).map((e) => [
                    e.referrer.toBase58(),
                    e.level,
                ]),
                (before.referralHistory as DecodedEntry[]).map((e) => [
                    e.referrer.toBase58(),
                    e.level,
                ]),
            );
        });

        it("apply_referral grows an empty legacy history and truncates to two entries", async () => {
            const u2 = user("u2");
            const u3 = user("u3");
            const u4 = user("u4");
            assert.equal(u4.expected.referrers.length, 0);
            const ix = await program.methods
                .applyReferral()
                .accounts({
                    userAssetData: userAssetDataPda(u4.userId),
                    referrerAssetData: userAssetDataPda(u3.userId),
                    authority: admin.publicKey,
                    config,
                })
                .instruction();
            await send([ix], [admin], { label: "AC3 apply_referral u4<-u3" });
            const after = await decodeUad("u4");
            assert.deepEqual(
                (after.referralHistory as DecodedEntry[]).map((e) => ({
                    referrer: e.referrer.toBase58(),
                    level: e.level,
                })),
                [
                    {
                        referrer: userAssetDataPda(u2.userId).toBase58(),
                        level: 2,
                    },
                    {
                        referrer: userAssetDataPda(u3.userId).toBase58(),
                        level: 1,
                    },
                ],
            );
            assert.equal(after.xp.toString(), u4.expected.xp);
            assert.equal(
                after.travelPoints.toString(),
                u4.expected.travelPoints,
            );
            assert.equal(after.assetVersion, 0);
            assert.equal(after.reissueCount, 0);
            assert.ok(allZero(after.padding as number[]));
            assert.equal(
                (await fetchData(userAssetDataPda(u4.userId))).length,
                USER_ASSET_DATA_LEN,
            );
        });
    });
});
