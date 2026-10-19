#!/usr/bin/env bash
set -euo pipefail

W="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$W"

RPC="http://127.0.0.1:8899"
PROGRAM_ID="GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr"
MPL_CORE_ID="CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
LEGACY_COMMIT="e7f8419"
ANCHOR_BIN="${ANCHOR_BIN:-$HOME/.avm/bin/anchor-0.29.0}"
SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX14.4.sdk"

LOCAL_DIR="$W/.anchor"
KEYS="$LOCAL_DIR/local-keys"
STATE="$LOCAL_DIR/local-state"
LEGACY="$LOCAL_DIR/legacy"
LEDGER="$LOCAL_DIR/test-ledger"
CLI="$KEYS/cli.yml"
TS_MOCHA="$W/node_modules/.bin/ts-mocha"
TSCONFIG="$W/tests/local/tsconfig.json"

fail() {
  echo "run.sh: $*" >&2
  exit 1
}

if [ -e "$W/deploy.json" ]; then
  fail "deploy.json exists in the worktree; refusing to run"
fi
if [ -n "${ANCHOR_PROVIDER_URL:-}" ] && ! [[ "$ANCHOR_PROVIDER_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$ ]]; then
  fail "ANCHOR_PROVIDER_URL=$ANCHOR_PROVIDER_URL is not local; refusing to run"
fi
for port in 8899 8900 9900; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "something already listens on port $port; stop it first"
  fi
done
command -v solana >/dev/null || fail "solana CLI not found"
command -v solana-test-validator >/dev/null || fail "solana-test-validator not found"
[ -x "$ANCHOR_BIN" ] || fail "anchor 0.29.0 not found at $ANCHOR_BIN"
[ -x "$TS_MOCHA" ] || fail "ts-mocha not found in node_modules"
[ -f "$W/dump_programs/metaplex_core_program.so" ] || fail "dump_programs/metaplex_core_program.so missing"

export ANCHOR_PROVIDER_URL="$RPC"
export COPYFILE_DISABLE=1
export TS_NODE_PROJECT="$TSCONFIG"

anchor_build() {
  if [ -d "$SDK" ]; then
    SDKROOT="$SDK" MACOSX_DEPLOYMENT_TARGET=14.0 "$ANCHOR_BIN" build
  else
    "$ANCHOR_BIN" build
  fi
}

echo "== keys (throwaway, regenerated every run)"
rm -rf "$KEYS"
mkdir -p "$KEYS" "$STATE"
for name in admin governance fee-vault upgrade-authority cli-payer attacker wallet-1 wallet-2 wallet-3 wallet-4 wallet-5 wallet-6; do
  solana-keygen new --no-bip39-passphrase --silent --force -o "$KEYS/$name.json" >/dev/null
done
cat >"$CLI" <<EOF
json_rpc_url: "$RPC"
websocket_url: ""
keypair_path: "$KEYS/cli-payer.json"
address_labels:
  "11111111111111111111111111111111": System Program
commitment: confirmed
EOF
rm -f "$STATE/legacy.json" "$STATE/spike.json"

sol() {
  solana -C "$CLI" -u "$RPC" -k "$KEYS/cli-payer.json" "$@"
}

echo "== legacy program ($LEGACY_COMMIT)"
if [ ! -f "$LEGACY/nomadz_core.so" ] || [ ! -f "$LEGACY/nomadz_core.json" ]; then
  rm -rf "$LEGACY/src"
  mkdir -p "$LEGACY/src"
  git -C "$W" archive "$LEGACY_COMMIT" -- Anchor.toml Cargo.toml Cargo.lock programs | tar -x -C "$LEGACY/src"
  (cd "$LEGACY/src" && anchor_build)
  cp "$LEGACY/src/target/deploy/nomadz_core.so" "$LEGACY/nomadz_core.so"
  cp "$LEGACY/src/target/idl/nomadz_core.json" "$LEGACY/nomadz_core.json"
fi

echo "== new program"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  anchor_build
fi
NEW_SO="$W/target/deploy/nomadz_core.so"
[ -f "$NEW_SO" ] || fail "target/deploy/nomadz_core.so missing"
[ -f "$W/target/idl/nomadz_core.json" ] || fail "target/idl/nomadz_core.json missing"

echo "== validator"
UPGRADE_AUTHORITY="$(solana-keygen pubkey "$KEYS/upgrade-authority.json")"
CLI_PAYER="$(solana-keygen pubkey "$KEYS/cli-payer.json")"
W="$W" LEGACY_SO="$LEGACY/nomadz_core.so" NEW_SO="$NEW_SO" UPGRADE_AUTHORITY="$UPGRADE_AUTHORITY" OUT_DIR="$STATE" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { PublicKey } = require(path.join(process.env.W, 'node_modules', '@solana', 'web3.js'));
const programId = new PublicKey('GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr');
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], loader);
const elf = fs.readFileSync(process.env.LEGACY_SO);
const newLen = fs.statSync(process.env.NEW_SO).size;
const pd = Buffer.alloc(45 + Math.max(elf.length, newLen) + 20000);
pd.writeUInt32LE(3, 0);
pd.writeBigUInt64LE(0n, 4);
pd.writeUInt8(1, 12);
new PublicKey(process.env.UPGRADE_AUTHORITY).toBuffer().copy(pd, 13);
elf.copy(pd, 45);
const prog = Buffer.alloc(36);
prog.writeUInt32LE(2, 0);
programData.toBuffer().copy(prog, 4);
const rent = n => (128 + n) * 6960;
const write = (file, pubkey, data, executable) =>
  fs.writeFileSync(
    path.join(process.env.OUT_DIR, file),
    JSON.stringify({
      pubkey: pubkey.toBase58(),
      account: {
        lamports: rent(data.length),
        data: [data.toString('base64'), 'base64'],
        owner: loader.toBase58(),
        executable,
        rentEpoch: 0,
        space: data.length,
      },
    }),
  );
write('program.json', programId, prog, true);
write('programdata.json', programData, pd, false);
console.log(`programdata ${programData.toBase58()} preallocated to ${pd.length} bytes`);
NODE
solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LEDGER" \
  --bind-address 127.0.0.1 \
  --rpc-port 8899 \
  --mint "$CLI_PAYER" \
  --bpf-program "$MPL_CORE_ID" "$W/dump_programs/metaplex_core_program.so" \
  --account - "$STATE/program.json" \
  --account - "$STATE/programdata.json" \
  >"$STATE/validator.log" 2>&1 &
VALIDATOR_PID=$!
trap 'kill "$VALIDATOR_PID" 2>/dev/null || true; wait "$VALIDATOR_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"'; then
    break
  fi
  kill -0 "$VALIDATOR_PID" 2>/dev/null || fail "validator exited; see $STATE/validator.log"
  sleep 1
done
curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" | grep -q '"ok"' || fail "validator did not become healthy"
sol program show "$PROGRAM_ID"

echo "== legacy setup"
"$TS_MOCHA" -p "$TSCONFIG" -t 1000000 "$W/tests/local/legacy-setup.ts"

echo "== upgrade in place"
OLD_LEN="$(sol program show "$PROGRAM_ID" --output json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).dataLen))')"
NEW_LEN="$(wc -c <"$NEW_SO" | tr -d ' ')"
echo "programdata $OLD_LEN bytes, new binary $NEW_LEN bytes"
if [ "$NEW_LEN" -gt "$OLD_LEN" ]; then
  sol program extend "$PROGRAM_ID" $((NEW_LEN - OLD_LEN + 20000))
fi
sol program deploy "$NEW_SO" --program-id "$PROGRAM_ID" --upgrade-authority "$KEYS/upgrade-authority.json"
sol program show "$PROGRAM_ID"
sleep 2

echo "== cases"
set +e
"$TS_MOCHA" -p "$TSCONFIG" -t 1000000 "$W"/tests/local/cases/*.test.ts
STATUS=$?
set -e

echo "== spike results: $STATE/spike.json"
[ -f "$STATE/spike.json" ] && cat "$STATE/spike.json"
exit "$STATUS"
