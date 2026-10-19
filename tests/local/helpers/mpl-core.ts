import {
    AccountMeta,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";

export const MPL_CORE_PROGRAM_ID = new PublicKey(
    "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);

export const MplCoreDiscriminator = {
    CreateV1: 0,
    AddPluginV1: 2,
    RemovePluginV1: 4,
    UpdatePluginV1: 6,
    ApprovePluginAuthorityV1: 8,
    RevokePluginAuthorityV1: 10,
    BurnV1: 12,
    TransferV1: 14,
    UpdateV1: 15,
    CreateV2: 20,
    UpdateV2: 30,
    ExecuteV1: 31,
} as const;

export enum Key {
    Uninitialized = 0,
    AssetV1 = 1,
    HashedAssetV1 = 2,
    PluginHeaderV1 = 3,
    PluginRegistryV1 = 4,
    CollectionV1 = 5,
}

export enum PluginType {
    Royalties = 0,
    FreezeDelegate = 1,
    BurnDelegate = 2,
    TransferDelegate = 3,
    UpdateDelegate = 4,
    PermanentFreezeDelegate = 5,
    Attributes = 6,
    PermanentTransferDelegate = 7,
    PermanentBurnDelegate = 8,
    Edition = 9,
    MasterEdition = 10,
    AddBlocker = 11,
    ImmutableMetadata = 12,
    VerifiedCreators = 13,
    Autograph = 14,
}

export type PluginAuthority =
    | { kind: "None" }
    | { kind: "Owner" }
    | { kind: "UpdateAuthority" }
    | { kind: "Address"; address: PublicKey };

export type UpdateAuthority =
    | { kind: "None" }
    | { kind: "Address"; address: PublicKey }
    | { kind: "Collection"; address: PublicKey };

export type RuleSet =
    | { kind: "None" }
    | { kind: "ProgramAllowList"; programs: PublicKey[] }
    | { kind: "ProgramDenyList"; programs: PublicKey[] };

export interface Attribute {
    key: string;
    value: string;
}

export type Plugin =
    | {
          type: PluginType.Royalties;
          basisPoints: number;
          creators: { address: PublicKey; percentage: number }[];
          ruleSet: RuleSet;
      }
    | { type: PluginType.FreezeDelegate; frozen: boolean }
    | { type: PluginType.BurnDelegate }
    | { type: PluginType.TransferDelegate }
    | { type: PluginType.UpdateDelegate; additionalDelegates: PublicKey[] }
    | { type: PluginType.PermanentFreezeDelegate; frozen: boolean }
    | { type: PluginType.Attributes; attributeList: Attribute[] }
    | { type: PluginType.PermanentTransferDelegate }
    | { type: PluginType.PermanentBurnDelegate }
    | { type: PluginType.Edition; number: number }
    | {
          type: PluginType.MasterEdition;
          maxSupply: number | null;
          name: string | null;
          uri: string | null;
      }
    | { type: PluginType.AddBlocker }
    | { type: PluginType.ImmutableMetadata }
    | {
          type: PluginType.VerifiedCreators;
          signatures: { address: PublicKey; verified: boolean }[];
      }
    | {
          type: PluginType.Autograph;
          signatures: { address: PublicKey; message: string }[];
      };

export interface PluginAuthorityPair {
    plugin: Plugin;
    authority: PluginAuthority | null;
}

export const plugins = {
    freezeDelegate: (frozen: boolean): Plugin => ({
        type: PluginType.FreezeDelegate,
        frozen,
    }),
    permanentFreezeDelegate: (frozen: boolean): Plugin => ({
        type: PluginType.PermanentFreezeDelegate,
        frozen,
    }),
    permanentTransferDelegate: (): Plugin => ({
        type: PluginType.PermanentTransferDelegate,
    }),
    permanentBurnDelegate: (): Plugin => ({
        type: PluginType.PermanentBurnDelegate,
    }),
    burnDelegate: (): Plugin => ({ type: PluginType.BurnDelegate }),
    transferDelegate: (): Plugin => ({ type: PluginType.TransferDelegate }),
    updateDelegate: (additionalDelegates: PublicKey[] = []): Plugin => ({
        type: PluginType.UpdateDelegate,
        additionalDelegates,
    }),
    attributes: (attributeList: Attribute[]): Plugin => ({
        type: PluginType.Attributes,
        attributeList,
    }),
    royalties: (
        basisPoints: number,
        creators: { address: PublicKey; percentage: number }[],
    ): Plugin => ({
        type: PluginType.Royalties,
        basisPoints,
        creators,
        ruleSet: { kind: "None" },
    }),
    addBlocker: (): Plugin => ({ type: PluginType.AddBlocker }),
    immutableMetadata: (): Plugin => ({ type: PluginType.ImmutableMetadata }),
    edition: (number: number): Plugin => ({ type: PluginType.Edition, number }),
};

export const authority = {
    none: (): PluginAuthority => ({ kind: "None" }),
    owner: (): PluginAuthority => ({ kind: "Owner" }),
    updateAuthority: (): PluginAuthority => ({ kind: "UpdateAuthority" }),
    address: (address: PublicKey): PluginAuthority => ({
        kind: "Address",
        address,
    }),
};

export class BorshWriter {
    private chunks: Buffer[] = [];

    u8(value: number): this {
        this.chunks.push(Buffer.from([value & 0xff]));
        return this;
    }

    u16(value: number): this {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(value);
        this.chunks.push(b);
        return this;
    }

    u32(value: number): this {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(value);
        this.chunks.push(b);
        return this;
    }

    u64(value: bigint | number): this {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(value));
        this.chunks.push(b);
        return this;
    }

    bool(value: boolean): this {
        return this.u8(value ? 1 : 0);
    }

    pubkey(value: PublicKey): this {
        this.chunks.push(value.toBuffer());
        return this;
    }

    string(value: string): this {
        const b = Buffer.from(value, "utf8");
        this.u32(b.length);
        this.chunks.push(b);
        return this;
    }

    bytes(value: Uint8Array): this {
        this.chunks.push(Buffer.from(value));
        return this;
    }

    option<T>(
        value: T | null | undefined,
        write: (w: BorshWriter, v: T) => void,
    ): this {
        if (value === null || value === undefined) {
            return this.u8(0);
        }
        this.u8(1);
        write(this, value);
        return this;
    }

    vec<T>(values: T[], write: (w: BorshWriter, v: T) => void): this {
        this.u32(values.length);
        values.forEach((v) => write(this, v));
        return this;
    }

    toBuffer(): Buffer {
        return Buffer.concat(this.chunks);
    }
}

export class BorshReader {
    offset: number;

    constructor(
        private readonly data: Buffer,
        offset = 0,
    ) {
        this.offset = offset;
    }

    u8(): number {
        const v = this.data.readUInt8(this.offset);
        this.offset += 1;
        return v;
    }

    u16(): number {
        const v = this.data.readUInt16LE(this.offset);
        this.offset += 2;
        return v;
    }

    u32(): number {
        const v = this.data.readUInt32LE(this.offset);
        this.offset += 4;
        return v;
    }

    u64(): bigint {
        const v = this.data.readBigUInt64LE(this.offset);
        this.offset += 8;
        return v;
    }

    bool(): boolean {
        return this.u8() !== 0;
    }

    pubkey(): PublicKey {
        const v = new PublicKey(
            this.data.subarray(this.offset, this.offset + 32),
        );
        this.offset += 32;
        return v;
    }

    string(): string {
        const len = this.u32();
        const v = this.data
            .subarray(this.offset, this.offset + len)
            .toString("utf8");
        this.offset += len;
        return v;
    }

    option<T>(read: (r: BorshReader) => T): T | null {
        return this.u8() === 0 ? null : read(this);
    }

    vec<T>(read: (r: BorshReader) => T): T[] {
        const len = this.u32();
        const out: T[] = [];
        for (let i = 0; i < len; i++) {
            out.push(read(this));
        }
        return out;
    }
}

export function writePluginAuthority(w: BorshWriter, a: PluginAuthority): void {
    switch (a.kind) {
        case "None":
            w.u8(0);
            break;
        case "Owner":
            w.u8(1);
            break;
        case "UpdateAuthority":
            w.u8(2);
            break;
        case "Address":
            w.u8(3).pubkey(a.address);
            break;
    }
}

export function writeUpdateAuthority(w: BorshWriter, a: UpdateAuthority): void {
    switch (a.kind) {
        case "None":
            w.u8(0);
            break;
        case "Address":
            w.u8(1).pubkey(a.address);
            break;
        case "Collection":
            w.u8(2).pubkey(a.address);
            break;
    }
}

function writeRuleSet(w: BorshWriter, r: RuleSet): void {
    switch (r.kind) {
        case "None":
            w.u8(0);
            break;
        case "ProgramAllowList":
            w.u8(1).vec(r.programs, (ww, p) => ww.pubkey(p));
            break;
        case "ProgramDenyList":
            w.u8(2).vec(r.programs, (ww, p) => ww.pubkey(p));
            break;
    }
}

export function writePlugin(w: BorshWriter, p: Plugin): void {
    w.u8(p.type);
    switch (p.type) {
        case PluginType.Royalties:
            w.u16(p.basisPoints);
            w.vec(p.creators, (ww, c) => ww.pubkey(c.address).u8(c.percentage));
            writeRuleSet(w, p.ruleSet);
            break;
        case PluginType.FreezeDelegate:
        case PluginType.PermanentFreezeDelegate:
            w.bool(p.frozen);
            break;
        case PluginType.UpdateDelegate:
            w.vec(p.additionalDelegates, (ww, k) => ww.pubkey(k));
            break;
        case PluginType.Attributes:
            w.vec(p.attributeList, (ww, a) => ww.string(a.key).string(a.value));
            break;
        case PluginType.Edition:
            w.u32(p.number);
            break;
        case PluginType.MasterEdition:
            w.option(p.maxSupply, (ww, v) => ww.u32(v));
            w.option(p.name, (ww, v) => ww.string(v));
            w.option(p.uri, (ww, v) => ww.string(v));
            break;
        case PluginType.VerifiedCreators:
            w.vec(p.signatures, (ww, s) =>
                ww.pubkey(s.address).bool(s.verified),
            );
            break;
        case PluginType.Autograph:
            w.vec(p.signatures, (ww, s) =>
                ww.pubkey(s.address).string(s.message),
            );
            break;
        case PluginType.BurnDelegate:
        case PluginType.TransferDelegate:
        case PluginType.PermanentTransferDelegate:
        case PluginType.PermanentBurnDelegate:
        case PluginType.AddBlocker:
        case PluginType.ImmutableMetadata:
            break;
    }
}

export function readPluginAuthority(r: BorshReader): PluginAuthority {
    const tag = r.u8();
    switch (tag) {
        case 0:
            return { kind: "None" };
        case 1:
            return { kind: "Owner" };
        case 2:
            return { kind: "UpdateAuthority" };
        case 3:
            return { kind: "Address", address: r.pubkey() };
        default:
            throw new Error(`unknown PluginAuthority tag ${tag}`);
    }
}

export function readUpdateAuthority(r: BorshReader): UpdateAuthority {
    const tag = r.u8();
    switch (tag) {
        case 0:
            return { kind: "None" };
        case 1:
            return { kind: "Address", address: r.pubkey() };
        case 2:
            return { kind: "Collection", address: r.pubkey() };
        default:
            throw new Error(`unknown UpdateAuthority tag ${tag}`);
    }
}

function readRuleSet(r: BorshReader): RuleSet {
    const tag = r.u8();
    switch (tag) {
        case 0:
            return { kind: "None" };
        case 1:
            return {
                kind: "ProgramAllowList",
                programs: r.vec((rr) => rr.pubkey()),
            };
        case 2:
            return {
                kind: "ProgramDenyList",
                programs: r.vec((rr) => rr.pubkey()),
            };
        default:
            throw new Error(`unknown RuleSet tag ${tag}`);
    }
}

export function readPlugin(r: BorshReader): Plugin {
    const type = r.u8() as PluginType;
    switch (type) {
        case PluginType.Royalties:
            return {
                type,
                basisPoints: r.u16(),
                creators: r.vec((rr) => ({
                    address: rr.pubkey(),
                    percentage: rr.u8(),
                })),
                ruleSet: readRuleSet(r),
            };
        case PluginType.FreezeDelegate:
        case PluginType.PermanentFreezeDelegate:
            return { type, frozen: r.bool() };
        case PluginType.UpdateDelegate:
            return { type, additionalDelegates: r.vec((rr) => rr.pubkey()) };
        case PluginType.Attributes:
            return {
                type,
                attributeList: r.vec((rr) => ({
                    key: rr.string(),
                    value: rr.string(),
                })),
            };
        case PluginType.Edition:
            return { type, number: r.u32() };
        case PluginType.MasterEdition:
            return {
                type,
                maxSupply: r.option((rr) => rr.u32()),
                name: r.option((rr) => rr.string()),
                uri: r.option((rr) => rr.string()),
            };
        case PluginType.VerifiedCreators:
            return {
                type,
                signatures: r.vec((rr) => ({
                    address: rr.pubkey(),
                    verified: rr.bool(),
                })),
            };
        case PluginType.Autograph:
            return {
                type,
                signatures: r.vec((rr) => ({
                    address: rr.pubkey(),
                    message: rr.string(),
                })),
            };
        case PluginType.BurnDelegate:
        case PluginType.TransferDelegate:
        case PluginType.PermanentTransferDelegate:
        case PluginType.PermanentBurnDelegate:
        case PluginType.AddBlocker:
        case PluginType.ImmutableMetadata:
            return { type };
        default:
            throw new Error(`unknown Plugin tag ${type}`);
    }
}

export function createV2Data(args: {
    name: string;
    uri: string;
    plugins?: PluginAuthorityPair[] | null;
}): Buffer {
    return new BorshWriter()
        .u8(MplCoreDiscriminator.CreateV2)
        .u8(0)
        .string(args.name)
        .string(args.uri)
        .option(args.plugins ?? null, (w, list) =>
            w.vec(list, (ww, pair) => {
                writePlugin(ww, pair.plugin);
                ww.option(pair.authority, writePluginAuthority);
            }),
        )
        .u8(0)
        .toBuffer();
}

export function transferV1Data(): Buffer {
    return new BorshWriter()
        .u8(MplCoreDiscriminator.TransferV1)
        .u8(0)
        .toBuffer();
}

export function burnV1Data(): Buffer {
    return new BorshWriter().u8(MplCoreDiscriminator.BurnV1).u8(0).toBuffer();
}

export function updatePluginV1Data(plugin: Plugin): Buffer {
    const w = new BorshWriter().u8(MplCoreDiscriminator.UpdatePluginV1);
    writePlugin(w, plugin);
    return w.toBuffer();
}

export function addPluginV1Data(
    plugin: Plugin,
    initAuthority: PluginAuthority | null = null,
): Buffer {
    const w = new BorshWriter().u8(MplCoreDiscriminator.AddPluginV1);
    writePlugin(w, plugin);
    w.option(initAuthority, writePluginAuthority);
    return w.toBuffer();
}

export function removePluginV1Data(pluginType: PluginType): Buffer {
    return new BorshWriter()
        .u8(MplCoreDiscriminator.RemovePluginV1)
        .u8(pluginType)
        .toBuffer();
}

export function approvePluginAuthorityV1Data(
    pluginType: PluginType,
    newAuthority: PluginAuthority,
): Buffer {
    const w = new BorshWriter()
        .u8(MplCoreDiscriminator.ApprovePluginAuthorityV1)
        .u8(pluginType);
    writePluginAuthority(w, newAuthority);
    return w.toBuffer();
}

export function updateV1Data(args: {
    newName?: string | null;
    newUri?: string | null;
    newUpdateAuthority?: UpdateAuthority | null;
}): Buffer {
    return new BorshWriter()
        .u8(MplCoreDiscriminator.UpdateV1)
        .option(args.newName ?? null, (w, v) => w.string(v))
        .option(args.newUri ?? null, (w, v) => w.string(v))
        .option(args.newUpdateAuthority ?? null, writeUpdateAuthority)
        .toBuffer();
}

export function rawData(
    discriminator: number,
    rest: Uint8Array = new Uint8Array(),
): Buffer {
    return Buffer.concat([Buffer.from([discriminator]), Buffer.from(rest)]);
}

function placeholder(): AccountMeta {
    return { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false };
}

function optionalMeta(
    key: PublicKey | null | undefined,
    isSigner: boolean,
    isWritable: boolean,
): AccountMeta {
    return key ? { pubkey: key, isSigner, isWritable } : placeholder();
}

export interface PluginIxAccounts {
    asset: PublicKey;
    payer: PublicKey;
    authority?: PublicKey | null;
    collection?: PublicKey | null;
}

function pluginStyleKeys(a: PluginIxAccounts): AccountMeta[] {
    return [
        { pubkey: a.asset, isSigner: false, isWritable: true },
        optionalMeta(a.collection, false, true),
        { pubkey: a.payer, isSigner: true, isWritable: true },
        optionalMeta(a.authority, true, false),
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        placeholder(),
    ];
}

function ix(keys: AccountMeta[], data: Buffer): TransactionInstruction {
    return new TransactionInstruction({
        programId: MPL_CORE_PROGRAM_ID,
        keys,
        data,
    });
}

export function createV2Ix(
    a: {
        asset: PublicKey;
        payer: PublicKey;
        owner?: PublicKey | null;
        authority?: PublicKey | null;
        updateAuthority?: PublicKey | null;
        collection?: PublicKey | null;
    },
    args: { name: string; uri: string; plugins?: PluginAuthorityPair[] | null },
): TransactionInstruction {
    return ix(
        [
            { pubkey: a.asset, isSigner: true, isWritable: true },
            optionalMeta(a.collection, false, true),
            optionalMeta(a.authority, true, false),
            { pubkey: a.payer, isSigner: true, isWritable: true },
            optionalMeta(a.owner, false, false),
            optionalMeta(a.updateAuthority, false, false),
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            placeholder(),
        ],
        createV2Data(args),
    );
}

export function transferV1Ix(a: {
    asset: PublicKey;
    payer: PublicKey;
    newOwner: PublicKey;
    authority?: PublicKey | null;
    collection?: PublicKey | null;
}): TransactionInstruction {
    return ix(
        [
            { pubkey: a.asset, isSigner: false, isWritable: true },
            optionalMeta(a.collection, false, false),
            { pubkey: a.payer, isSigner: true, isWritable: true },
            optionalMeta(a.authority, true, false),
            { pubkey: a.newOwner, isSigner: false, isWritable: false },
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            placeholder(),
        ],
        transferV1Data(),
    );
}

export function burnV1Ix(a: {
    asset: PublicKey;
    payer: PublicKey;
    authority?: PublicKey | null;
    collection?: PublicKey | null;
}): TransactionInstruction {
    return ix(
        [
            { pubkey: a.asset, isSigner: false, isWritable: true },
            optionalMeta(a.collection, false, true),
            { pubkey: a.payer, isSigner: true, isWritable: true },
            optionalMeta(a.authority, true, false),
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            placeholder(),
        ],
        burnV1Data(),
    );
}

export function updatePluginV1Ix(
    a: PluginIxAccounts,
    plugin: Plugin,
): TransactionInstruction {
    return ix(pluginStyleKeys(a), updatePluginV1Data(plugin));
}

export function addPluginV1Ix(
    a: PluginIxAccounts,
    plugin: Plugin,
    initAuthority: PluginAuthority | null = null,
): TransactionInstruction {
    return ix(pluginStyleKeys(a), addPluginV1Data(plugin, initAuthority));
}

export function removePluginV1Ix(
    a: PluginIxAccounts,
    pluginType: PluginType,
): TransactionInstruction {
    return ix(pluginStyleKeys(a), removePluginV1Data(pluginType));
}

export function approvePluginAuthorityV1Ix(
    a: PluginIxAccounts,
    pluginType: PluginType,
    newAuthority: PluginAuthority,
): TransactionInstruction {
    return ix(
        pluginStyleKeys(a),
        approvePluginAuthorityV1Data(pluginType, newAuthority),
    );
}

export function updateV1Ix(
    a: PluginIxAccounts,
    args: {
        newName?: string | null;
        newUri?: string | null;
        newUpdateAuthority?: UpdateAuthority | null;
    },
): TransactionInstruction {
    const keys = pluginStyleKeys(a);
    keys[1] = optionalMeta(a.collection, false, false);
    return ix(keys, updateV1Data(args));
}

export interface RegistryEntry {
    pluginType: PluginType;
    authority: PluginAuthority;
    offset: number;
    plugin: Plugin;
}

export interface DecodedAsset {
    key: Key;
    owner: PublicKey;
    updateAuthority: UpdateAuthority;
    name: string;
    uri: string;
    seq: bigint | null;
    baseLength: number;
    pluginRegistryOffset: number | null;
    registry: RegistryEntry[];
    externalRegistryCount: number;
}

export function isBurnedAsset(data: Buffer): boolean {
    return data.length <= 1;
}

export function decodeAsset(data: Buffer): DecodedAsset {
    const r = new BorshReader(data);
    const key = r.u8() as Key;
    if (key !== Key.AssetV1) {
        throw new Error(
            `account is not an AssetV1 (key ${key}, length ${data.length})`,
        );
    }
    const owner = r.pubkey();
    const updateAuthority = readUpdateAuthority(r);
    const name = r.string();
    const uri = r.string();
    const seq = r.option((rr) => rr.u64());
    const baseLength = r.offset;
    const asset: DecodedAsset = {
        key,
        owner,
        updateAuthority,
        name,
        uri,
        seq,
        baseLength,
        pluginRegistryOffset: null,
        registry: [],
        externalRegistryCount: 0,
    };
    if (baseLength >= data.length) {
        return asset;
    }
    const headerKey = r.u8();
    if (headerKey !== Key.PluginHeaderV1) {
        throw new Error(
            `expected PluginHeaderV1 at ${baseLength}, found key ${headerKey}`,
        );
    }
    const registryOffset = Number(r.u64());
    asset.pluginRegistryOffset = registryOffset;
    const rr = new BorshReader(data, registryOffset);
    const registryKey = rr.u8();
    if (registryKey !== Key.PluginRegistryV1) {
        throw new Error(
            `expected PluginRegistryV1 at ${registryOffset}, found key ${registryKey}`,
        );
    }
    const records = rr.vec((x) => ({
        pluginType: x.u8() as PluginType,
        authority: readPluginAuthority(x),
        offset: Number(x.u64()),
    }));
    asset.externalRegistryCount = rr.u32();
    asset.registry = records.map((rec) => ({
        ...rec,
        plugin: readPlugin(new BorshReader(data, rec.offset)),
    }));
    return asset;
}

export function findPlugin(
    asset: DecodedAsset,
    type: PluginType,
): RegistryEntry | undefined {
    return asset.registry.find((e) => e.pluginType === type);
}

export function attributesOf(asset: DecodedAsset): Record<string, string> {
    const entry = findPlugin(asset, PluginType.Attributes);
    if (!entry || entry.plugin.type !== PluginType.Attributes) {
        return {};
    }
    return Object.fromEntries(
        entry.plugin.attributeList.map((a) => [a.key, a.value]),
    );
}

export function isFrozen(asset: DecodedAsset): boolean {
    return asset.registry.some(
        (e) =>
            (e.plugin.type === PluginType.FreezeDelegate ||
                e.plugin.type === PluginType.PermanentFreezeDelegate) &&
            e.plugin.frozen,
    );
}

export function authorityEquals(
    a: PluginAuthority,
    b: PluginAuthority,
): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    if (a.kind === "Address" && b.kind === "Address") {
        return a.address.equals(b.address);
    }
    return true;
}

export function describeAuthority(a: PluginAuthority): string {
    return a.kind === "Address" ? `Address(${a.address.toBase58()})` : a.kind;
}
