# Upgrading nomadz_core on mainnet

**Program ID:** `GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr`

This is an **in-place upgrade**. The program ID does not change, the config PDA does not change, and
no user asset account is touched — only the executable bytes are replaced. Nothing is closed and
nothing is redeployed under a new ID.

---

## Toolchain

The build is pinned and will fail without these. Both pins are committed:

- **`Anchor.toml` → `[toolchain] anchor_version = "0.29.0"`.** The program depends on `anchor-lang`
  0.29.0, and the IDL format changed in 0.30. Building with a 0.30.x CLI fails with
  `Error: IDL doesn't exist`, and the backend consumes `@coral-xyz/anchor ^0.29.0`, so a 0.30-format
  IDL would be unreadable to it.
- **`Cargo.lock` → `proc-macro2` pinned to 1.0.94.** 1.0.95 calls `Span::file()`, which needs
  rustc ≥ 1.87. The program is compiled by `cargo-build-sbf` (platform-tools v1.41, **rustc 1.75.0**)
  regardless of the host toolchain, so it fails with
  `no method named 'file' found for reference '&proc_macro::Span'`.
- **Keep `Cargo.lock` at format version 3.** A modern host cargo rewrites it to version 4 on
  `cargo update`, and cargo 1.75 then refuses it with
  `lock file version 4 requires -Znext-lockfile-bump`. If that happens, change the `version = 4`
  line near the top back to `version = 3`.

---

## What this upgrade changes

This upgrade adds permanent program-held delegates on new Nomad IDs, a governance authority, and the
`soulbound_*` instructions. The upgrade authority and close authority are not part of the program;
they stay with the deploy wallet.

### Authority split

| Authority | Held by | May call |
|---|---|---|
| Hot admin (`config.admin`) | backend signer | `initialize_user_asset_data`, `update_user_asset_data`, `update_user_with_referrer`, `apply_referral`, `mint_soulbound_nft`, `update_soulbound_nft` (legacy), `soulbound_update`, `soulbound_transfer`, `soulbound_set_frozen` |
| Governance (`config.governance`) | Squads vault `BUnmK1sZD6cBNfJ9uFQpWcPLon3aUHKJAHdVje7Fx8sW` | `update_config`, `soulbound_burn`, `soulbound_reissue`, `soulbound_core_passthrough` |
| Deploy wallet | the upgrade authority | program upgrade and program close, outside the program |

The program charges no fees; the backend does.

### New and changed instructions

- `soulbound_transfer`: admin. Moves a Nomad ID to a new owner. Works on new and legacy assets.
- `soulbound_set_frozen`: admin. Freezes or thaws a Nomad ID.
- `soulbound_update`: admin. Updates the metadata of a Nomad ID, including while it is frozen.
- `soulbound_burn`: governance. Burns a new-style Nomad ID.
- `soulbound_reissue`: governance. For a new-style Nomad ID, burns it and mints the next one. For a legacy one, keeps the old asset, marks it `status=revoked` with `replaced_by`, and mints the replacement.
- `soulbound_core_passthrough`: governance. Calls an allowlisted mpl-core instruction, signed by the asset authority PDA.
  On a frozen asset it thaws before an allowlisted plugin operation and refreezes afterwards. It
  rejects any operation on the three permanent delegates (freeze, transfer, burn) and any Add of
  `ImmutableMetadata` or an add-blocker plugin. The rejection returns `PassthroughPluginNotAllowed`.
- `update_config`: the signer account is now named `authority` and there is a new last argument, `governance`. The backend IDL and any `updateConfig` caller must be regenerated.
- `update_soulbound_nft` (legacy): now requires the trailing `config` account and checks the signer against `config.admin`.
- `apply_referral`: a duplicate referral still returns silent success. What changed is that duplicates are now detected by comparing against the referrer's `user_asset_data` PDA.
- `mint_soulbound_nft`: new Nomad IDs get permanent freeze, transfer and burn delegates held by the asset authority PDA.

### Error codes

`SoulboundErrorCode` errors have runtime codes from 7000, but the Anchor 0.29 IDL lists only one error
enum, with codes from 6000. Clients must match errors by name, not by number.

### Legacy Nomad IDs after an admin rotation

Legacy Nomad IDs carry an owner-managed freeze delegate whose authority is the admin address at mint
time. After `config.admin` is rotated, thawing a legacy asset, and so transferring it, still needs
the signature of that original key. Keep the original admin key after any rotation.

### One-time governance bootstrap

`Config.governance` is unset after the upgrade. While it is unset, the hot admin may call
`update_config` once to set it to the Squads vault; after that only governance can call it.

1. Upgrade the program (steps below).
2. Call `update_config` signed by the current `config.admin`, passing the existing config values and
   `governance = BUnmK1sZD6cBNfJ9uFQpWcPLon3aUHKJAHdVje7Fx8sW`.
3. Read the config account and confirm `governance` equals that address.
4. From then on, `update_config` and the other governance instructions must be proposed and executed
   through the Squads vault.

Do this straight after the upgrade. Until it is done, the hot admin is the only authority able to set
governance, and the governance instructions cannot run.

---

## Step 1 — Pre-flight

```bash
cd ~/Documents/Programming/Rust/nomadz_core
solana config set --url mainnet-beta

# Must show an Authority. If it is missing, the program is immutable and cannot be upgraded.
solana program show GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr

solana address -k deploy.json     # must equal the Authority above
solana balance -k deploy.json     # keep a few SOL free for the upload
```

Note the **Data Length** — you need it in step 3.

## Step 2 — Build

The native macOS SDK breaks Solana's linker, so build against the 14.4 SDK:

```bash
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX14.4.sdk MACOSX_DEPLOYMENT_TARGET=14.0 \
  ~/.avm/bin/anchor-0.29.0 build

solana address -k target/deploy/nomadz_core-keypair.json   # MUST print GfyUP9mzi...hQAmwr
ls -l target/deploy/nomadz_core.so
```

If the keypair prints a different address, **stop**. Deploying would create a second program and
orphan every existing PDA.

## Step 3 — Extend the program account only if the binary grew

Compare `ls -l target/deploy/nomadz_core.so` with the **Data Length** from step 1. If the new
binary is not larger, skip this step; no extend is needed.

An upgrade cannot grow the on-chain account by itself. Compare the new `.so` size against the
**Data Length** from step 1; if the binary is larger, extend first or the deploy fails with a bare
`Transaction simulation failed`.

```bash
solana program extend GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr 20000 \
  --keypair deploy.json
```

Extending costs rent on the new bytes — roughly **0.00696 SOL per KB** — and is **not refundable**,
because a program account cannot be shrunk. Leave some headroom rather than fitting exactly; hitting
the limit again means paying for another extend plus a failed deploy.

## Step 4 — Deploy

```bash
anchor upgrade target/deploy/nomadz_core.so \
  --program-id GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr \
  --provider.cluster mainnet
```

If it fails part-way it leaves a **buffer account** holding the uploaded bytes and 1-3 SOL of rent.
Resume into it rather than starting over:

```bash
solana program deploy \
  --program-id GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr \
  --buffer <BUFFER_ADDRESS> \
  --keypair deploy.json
```

## Step 5 — Verify

```bash
solana program show GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr
```

`Last Deployed In Slot` should have advanced and `Data Length` should cover the new binary.

## Step 6 — Reclaim leftover buffers

Buffers left by failed deploys hold real SOL. They are scratch space, not the program.

```bash
solana program show --buffers --buffer-authority $(solana address -k deploy.json)
solana program close --buffers --authority deploy.json
```

`--buffers` is the important part. `solana program close <PROGRAM_ID>` **without** it closes the
program permanently and cannot be undone.

## Step 7 — Ship the IDL

`target/idl/nomadz_core.json` is regenerated by the build. If the account layout or instruction set
changed, update the copy the backend uses.

---

## Local test harness

Run the full upgrade-in-place check on a local validator with throwaway keypairs. It never touches a
public cluster and refuses to run if `deploy.json` exists in the worktree.

```bash
bash tests/local/run.sh
```

Set `SKIP_BUILD=1` to reuse an existing build. The script sets `COPYFILE_DISABLE=1` itself (macOS tar otherwise adds files that corrupt the ledger) and loads the program account pre-padded, so the upgrade-in-place needs no extend. Do not use `anchor test`: `Anchor.toml` targets
Mainnet. Run it alone, with nothing else listening on ports 8899, 8900 and 9900.

---

## Account layout rule

Existing on-chain accounts are deserialized against the struct in the new binary, so **a struct that
grows breaks every account already written**.

Add fields by consuming reserved padding, never by extending the struct. `UserAssetData` keeps a
padding array for exactly this reason — `travel_points` was added by taking space from it, leaving
`LEN` unchanged. Confirm `LEN` is identical before and after on any struct you touch; if it moved,
what you need is a migration, not a deploy.

## Timing

Run the upgrade when the backend is quiet. In-flight `initialize_user` / `update_user` calls will
fail while it lands. Nothing corrupts — they simply error.
