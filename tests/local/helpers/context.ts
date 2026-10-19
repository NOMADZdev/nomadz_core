import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
    AddressLookupTableAccount,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Signer,
    SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MPL_CORE_PROGRAM_ID } from "./mpl-core";

export const ROOT = path.resolve(__dirname, "..", "..", "..");
export const ANCHOR_DIR = path.join(ROOT, ".anchor");
export const KEYS_DIR = path.join(ANCHOR_DIR, "local-keys");
export const STATE_DIR = path.join(ANCHOR_DIR, "local-state");
export const LEGACY_SNAPSHOT_PATH = path.join(STATE_DIR, "legacy.json");
export const SPIKE_PATH = path.join(STATE_DIR, "spike.json");
export const NEW_IDL_PATH = path.join(
    ROOT,
    "target",
    "idl",
    "nomadz_core.json",
);
export const LEGACY_IDL_PATH = path.join(
    ANCHOR_DIR,
    "legacy",
    "nomadz_core.json",
);

export const RPC_URL = "http://127.0.0.1:8899";
export const PROGRAM_ID = new PublicKey(
    "GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr",
);
export const MPL_CORE_ID = MPL_CORE_PROGRAM_ID;
export const DEFAULT_CU = 600_000;
export const NO_ACCOUNT = null as unknown as PublicKey;
export const MAX_TX_SIZE = 1232;

const BLOCKED_SIGNER_PREFIXES = ["HwT3", "EvETdy", "BUnm"];
const PUBLIC_CLUSTER_GENESIS = new Set([
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
]);

export function assertLocalUrl(url: string): void {
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
        throw new Error(`refusing non-local RPC endpoint ${url}`);
    }
}

export function assertSafeSigner(pubkey: PublicKey): void {
    const b58 = pubkey.toBase58();
    if (BLOCKED_SIGNER_PREFIXES.some((prefix) => b58.startsWith(prefix))) {
        throw new Error(`refusing to sign with a known production key ${b58}`);
    }
}

assertLocalUrl(RPC_URL);
if (process.env.ANCHOR_PROVIDER_URL) {
    assertLocalUrl(process.env.ANCHOR_PROVIDER_URL);
}
if (fs.existsSync(path.join(ROOT, "deploy.json"))) {
    throw new Error(
        "deploy.json is present in the worktree; local tests refuse to run",
    );
}

let cachedConnection: Connection | null = null;

export function connection(): Connection {
    if (!cachedConnection) {
        cachedConnection = new Connection(RPC_URL, { commitment: "confirmed" });
    }
    return cachedConnection;
}

export async function assertLocalCluster(): Promise<void> {
    const genesis = await connection().getGenesisHash();
    if (PUBLIC_CLUSTER_GENESIS.has(genesis)) {
        throw new Error(
            `refusing to run against a public cluster (genesis ${genesis})`,
        );
    }
}

export function loadKeypair(name: string): Keypair {
    const file = path.join(KEYS_DIR, `${name}.json`);
    const kp = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))),
    );
    assertSafeSigner(kp.publicKey);
    return kp;
}

export interface LocalKeys {
    admin: Keypair;
    governance: Keypair;
    feeVault: Keypair;
    upgradeAuthority: Keypair;
    cliPayer: Keypair;
    attacker: Keypair;
    wallets: Keypair[];
}

let cachedKeys: LocalKeys | null = null;

export function keys(): LocalKeys {
    if (!cachedKeys) {
        cachedKeys = {
            admin: loadKeypair("admin"),
            governance: loadKeypair("governance"),
            feeVault: loadKeypair("fee-vault"),
            upgradeAuthority: loadKeypair("upgrade-authority"),
            cliPayer: loadKeypair("cli-payer"),
            attacker: loadKeypair("attacker"),
            wallets: [1, 2, 3, 4, 5, 6].map((i) => loadKeypair(`wallet-${i}`)),
        };
    }
    return cachedKeys;
}

export function throwaway(): Keypair {
    const kp = Keypair.generate();
    assertSafeSigner(kp.publicKey);
    return kp;
}

export function randomUserId(): string {
    return randomBytes(16).toString("hex");
}

export function configPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        PROGRAM_ID,
    )[0];
}

export function userAssetDataPda(userId: string): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("user_asset_data"),
            Buffer.from(userId),
            PROGRAM_ID.toBuffer(),
        ],
        PROGRAM_ID,
    )[0];
}

export function reissueSeed(generation: number): Buffer {
    if (!Number.isInteger(generation) || generation < 1 || generation > 255) {
        throw new Error(`reissue generation must be 1..255, got ${generation}`);
    }
    return Buffer.from([generation]);
}

export function assetPda(userId: string, generation = 0): PublicKey {
    const seeds = [
        Buffer.from("soulbound_asset"),
        Buffer.from(userId),
        PROGRAM_ID.toBuffer(),
    ];
    if (generation > 0) {
        seeds.push(reissueSeed(generation));
    }
    return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

export function assetAuthorityPda(asset: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("asset_authority"),
            PROGRAM_ID.toBuffer(),
            asset.toBuffer(),
        ],
        PROGRAM_ID,
    )[0];
}

export function loadIdl(file: string): Idl {
    if (!fs.existsSync(file)) {
        throw new Error(
            `IDL not found at ${file}; build first (tests/local/run.sh does it)`,
        );
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as Idl;
}

export function provider(wallet: Keypair = keys().admin): AnchorProvider {
    assertSafeSigner(wallet.publicKey);
    return new AnchorProvider(connection(), new Wallet(wallet), {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
    });
}

export function newProgram(): Program<Idl> {
    return new Program(loadIdl(NEW_IDL_PATH), PROGRAM_ID, provider());
}

export function legacyProgram(): Program<Idl> {
    return new Program(loadIdl(LEGACY_IDL_PATH), PROGRAM_ID, provider());
}

export async function fund(pubkeys: PublicKey[], sol = 10): Promise<void> {
    const conn = connection();
    for (const pubkey of pubkeys) {
        const sig = await conn.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
        const latest = await conn.getLatestBlockhash("confirmed");
        await conn.confirmTransaction(
            { signature: sig, ...latest },
            "confirmed",
        );
    }
}

export async function fetchData(pubkey: PublicKey): Promise<Buffer> {
    const info = await connection().getAccountInfo(pubkey, "confirmed");
    if (!info) {
        throw new Error(`account ${pubkey.toBase58()} not found`);
    }
    return Buffer.from(info.data);
}

export async function lamports(pubkey: PublicKey): Promise<number> {
    return connection().getBalance(pubkey, "confirmed");
}

export class TxError extends Error {
    constructor(
        message: string,
        readonly logs: string[],
        readonly err: unknown,
        readonly signature: string | null,
    ) {
        super(message);
    }
}

export interface SendOptions {
    cu?: number | null;
    feePayer?: Signer;
    lookupTables?: AddressLookupTableAccount[];
    label?: string;
}

export interface SendResult {
    signature: string;
    unitsConsumed: number | null;
    logs: string[];
    size: number;
}

function uniqueSigners(signers: Signer[]): Signer[] {
    const seen = new Set<string>();
    return signers.filter((s) => {
        const k = s.publicKey.toBase58();
        if (seen.has(k)) {
            return false;
        }
        seen.add(k);
        return true;
    });
}

export function withComputeLimit(
    ixs: TransactionInstruction[],
    cu: number | null | undefined,
): TransactionInstruction[] {
    if (cu === null) {
        return ixs;
    }
    return [
        ComputeBudgetProgram.setComputeUnitLimit({ units: cu ?? DEFAULT_CU }),
        ...ixs,
    ];
}

export async function buildTx(
    ixs: TransactionInstruction[],
    signers: Signer[],
    opts: SendOptions = {},
): Promise<VersionedTransaction> {
    const all = uniqueSigners(
        opts.feePayer ? [opts.feePayer, ...signers] : signers,
    );
    if (all.length === 0) {
        throw new Error("at least one signer is required");
    }
    all.forEach((s) => assertSafeSigner(s.publicKey));
    const { blockhash } = await connection().getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
        payerKey: all[0].publicKey,
        recentBlockhash: blockhash,
        instructions: withComputeLimit(ixs, opts.cu),
    }).compileToV0Message(opts.lookupTables ?? []);
    const tx = new VersionedTransaction(message);
    const required = new Set(
        message.staticAccountKeys
            .slice(0, message.header.numRequiredSignatures)
            .map((k) => k.toBase58()),
    );
    tx.sign(all.filter((s) => required.has(s.publicKey.toBase58())));
    return tx;
}

export async function sendTx(
    tx: VersionedTransaction,
    label = "",
): Promise<SendResult> {
    const conn = connection();
    const raw = tx.serialize();
    let signature: string;
    try {
        signature = await conn.sendRawTransaction(raw, { skipPreflight: true });
    } catch (e) {
        const err = e as Error & { logs?: string[] };
        throw new TxError(
            `${label} send failed: ${err.message}`,
            err.logs ?? [],
            e,
            null,
        );
    }
    const latest = await conn.getLatestBlockhash("confirmed");
    await conn.confirmTransaction({ signature, ...latest }, "confirmed");
    const res = await conn.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    });
    if (!res || !res.meta) {
        throw new TxError(
            `${label} transaction ${signature} not found after confirmation`,
            [],
            null,
            signature,
        );
    }
    const logs = res.meta.logMessages ?? [];
    if (res.meta.err) {
        const line =
            logs.find((l) => l.includes("Error Code:")) ??
            logs.find((l) => l.includes("failed")) ??
            "";
        throw new TxError(
            `${label} failed: ${JSON.stringify(res.meta.err)} ${line}`.trim(),
            logs,
            res.meta.err,
            signature,
        );
    }
    return {
        signature,
        unitsConsumed: res.meta.computeUnitsConsumed ?? null,
        logs,
        size: raw.length,
    };
}

export async function send(
    ixs: TransactionInstruction[],
    signers: Signer[],
    opts: SendOptions = {},
): Promise<SendResult> {
    const tx = await buildTx(ixs, signers, opts);
    return sendTx(tx, opts.label);
}

export async function expectFailure(
    promise: Promise<unknown>,
): Promise<TxError> {
    try {
        await promise;
    } catch (e) {
        if (e instanceof TxError) {
            return e;
        }
        throw e;
    }
    assert.fail("expected the transaction to fail, but it succeeded");
}

export async function expectError(
    promise: Promise<unknown>,
    name: string,
): Promise<TxError> {
    const err = await expectFailure(promise);
    const haystack = [...err.logs, err.message];
    const anchorLine = haystack.find(
        (l) =>
            l.includes(`Error Code: ${name}.`) ||
            l.includes(`Error Code: ${name} `),
    );
    const anyLine = haystack.find((l) => l.includes(name));
    assert.ok(
        anchorLine ?? anyLine,
        `expected error "${name}", got: ${err.message}\n${err.logs.slice(-12).join("\n")}`,
    );
    return err;
}

export async function cu(signature: string): Promise<number | null> {
    const res = await connection().getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    });
    return res?.meta?.computeUnitsConsumed ?? null;
}

export function txSize(
    ixs: TransactionInstruction[],
    payer: PublicKey,
    lookupTables: AddressLookupTableAccount[] = [],
): number {
    try {
        const message = new TransactionMessage({
            payerKey: payer,
            recentBlockhash: PublicKey.default.toBase58(),
            instructions: ixs,
        }).compileToV0Message(lookupTables);
        const sigs = message.header.numRequiredSignatures;
        return message.serialize().length + (sigs < 128 ? 1 : 2) + 64 * sigs;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function readJson(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function jsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof PublicKey) {
        return value.toBase58();
    }
    return value;
}

export function recordSpike(key: string, value: unknown): void {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const current = readJson(SPIKE_PATH);
    current[key] = JSON.parse(JSON.stringify(value, jsonReplacer));
    fs.writeFileSync(SPIKE_PATH, JSON.stringify(current, null, 2));
}

export function recordCu(
    label: string,
    unitsConsumed: number | null,
    size?: number,
): void {
    const current = readJson(SPIKE_PATH);
    const table =
        (current.computeUnits as Record<string, unknown> | undefined) ?? {};
    table[label] = size === undefined ? unitsConsumed : { unitsConsumed, size };
    recordSpike("computeUnits", table);
}

export interface LegacyAccountSnapshot {
    address: string;
    owner: string;
    lamports: number;
    dataBase64: string;
}

export interface LegacyUserSnapshot {
    name: string;
    userId: string;
    walletKey: string;
    wallet: string;
    userAssetData: LegacyAccountSnapshot;
    asset: LegacyAccountSnapshot | null;
    expected: {
        xp: string;
        level: number;
        luck: number;
        travelPoints: string;
        referrers: { referrer: string; level: number }[];
    };
}

export interface LegacySnapshot {
    programId: string;
    createdAt: string;
    config: LegacyAccountSnapshot & {
        expected: {
            admin: string;
            feeVault: string;
            mintSoulboundFee: string;
            lvlPercentages: number[];
        };
    };
    users: LegacyUserSnapshot[];
}

export function writeLegacySnapshot(snapshot: LegacySnapshot): void {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LEGACY_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
}

export function readLegacySnapshot(): LegacySnapshot {
    if (!fs.existsSync(LEGACY_SNAPSHOT_PATH)) {
        throw new Error(
            `legacy snapshot missing at ${LEGACY_SNAPSHOT_PATH}; run tests/local/run.sh`,
        );
    }
    return JSON.parse(
        fs.readFileSync(LEGACY_SNAPSHOT_PATH, "utf8"),
    ) as LegacySnapshot;
}

export function legacyUser(
    name: string,
): LegacyUserSnapshot & { walletKeypair: Keypair } {
    const user = readLegacySnapshot().users.find((u) => u.name === name);
    if (!user) {
        throw new Error(`legacy user ${name} not in the snapshot`);
    }
    return { ...user, walletKeypair: loadKeypair(user.walletKey) };
}

export async function snapshotAccount(
    pubkey: PublicKey,
): Promise<LegacyAccountSnapshot> {
    const info = await connection().getAccountInfo(pubkey, "confirmed");
    if (!info) {
        throw new Error(`account ${pubkey.toBase58()} not found`);
    }
    return {
        address: pubkey.toBase58(),
        owner: info.owner.toBase58(),
        lamports: info.lamports,
        dataBase64: Buffer.from(info.data).toString("base64"),
    };
}

export async function ensureGovernanceSet(
    program: Program<Idl> = newProgram(),
): Promise<PublicKey> {
    const { admin, governance } = keys();
    const config = configPda();
    const decoded = program.coder.accounts.decode(
        "Config",
        await fetchData(config),
    );
    const current = decoded.governance as PublicKey;
    if (!current.equals(PublicKey.default)) {
        return current;
    }
    const ix = await program.methods
        .updateConfig({
            lvlPercentages: null,
            mintSoulboundFee: null,
            admin: null,
            feeVault: null,
            governance: governance.publicKey,
        })
        .accounts({
            config,
            authority: admin.publicKey,
            newAdmin: NO_ACCOUNT,
            newFeeVault: NO_ACCOUNT,
        })
        .instruction();
    await send([ix], [admin], { label: "bootstrap governance" });
    return governance.publicKey;
}

export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
