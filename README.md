
# Building and Deploying The NomadZ Gamification Engine Program

## Prerequisites

### 1. Install Solana CLI

Ensure the Solana CLI is installed and configured:
```bash
solana --version
```

You should see:
```bash
solana-cli 1.18.26
```

If not installed, follow the [official Solana CLI installation guide](https://docs.solana.com/cli/install-solana-cli-tools).

---

### 2. Install Rust and Cargo

Install Rust via [rustup](https://rustup.rs/):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

### 3. Install Anchor CLI

Install the [Anchor CLI](https://www.anchor-lang.com/docs/installation):
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
```

Install **Anchor v0.29.0** using `avm`:
```bash
avm install 0.29.0
avm use 0.29.0
```

Verify:
```bash
anchor --version
```

Expected output:
```bash
anchor-cli 0.29.0
```

---

### 4. Enable `bytemuck` Derive Feature

You should go to the `bytemuck_derive-1.9.1` package and add on top of the file `cargo-features = ["edition2024"]`, and the rebuild using

```sh
cargo build
```

### 5. Install Node.js
Ensure Node.js and npm are installed for JavaScript/TypeScript bindings.

---

## Localnet Deployment

### Step 1: Start Local Validator
Start a local Solana test validator with custom programs and accounts:
```bash
solana-test-validator -r --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s dump_programs/metaplex_token_metadata_program.so --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d dump_programs/metaplex_core_program.so
```

#### Explanation:
- `-r`: Resets the validator's state on startup.
- `--bpf-program`: Deploys a program to the local validator.
- `--account`: Loads an account with pre-configured data.

### Step 2: Configure Anchor for Localnet
Set the cluster to `localnet`:
```bash
solana config set --url localhost
```

### Step 3: Build the Program
Navigate to your Anchor project directory and build the program:
```bash
anchor build
```

### Step 4: Fund Your Wallet
Ensure your wallet has SOL for deployment. Request an airdrop if necessary:
```bash
solana airdrop 4
```

### Step 5: Deploy the Program
Deploy the program to Localnet:
```bash
anchor deploy
```

---

## Devnet Deployment

### Step 1: Configure Solana for Devnet
Switch to the Solana Devnet cluster:
```bash
solana config set --url devnet
```

### Step 2: Fund Your Wallet
Ensure your wallet has SOL for deployment. Request an airdrop if necessary:
```bash
solana airdrop 4
```

### Step 3: Build the Program
Run the build command to compile the program:
```bash
anchor build
```

### Step 4: Deploy the Program
Deploy the program to Devnet:
```bash
anchor deploy
```

---

## Testing

### Localnet
After deploying to Localnet, you can test the program with:
```bash
anchor test --skip-local-validator
```

### Devnet
For Devnet execute without `--skip-local-validator` flag
```bash
anchor test
```
---

## Additional Commands

### Check Logs
View logs for transactions:
```bash
solana logs
```

---

## Troubleshooting

### 1. **Error: "Program ID was not as expected"**
Ensure the correct program ID is set in your `Anchor.toml` and matches the deployed program.

### 2. **Error: "Insufficient Funds"**
Request more SOL for deployment:
```bash
solana airdrop 3
```

### 3. **Error: "Program not found"**
Ensure the program is correctly built and deployed to the target cluster.
