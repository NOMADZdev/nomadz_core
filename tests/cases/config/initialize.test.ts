import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as assert from "assert";

import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";

import { NomadzCore } from "../../../target/types/nomadz_core";
import { saveAccount } from "../../../utils/account_utils";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import * as dotenv from "dotenv";

dotenv.config();
describe("initialize", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // const wallet = provider.wallet.payer as anchor.web3.Keypair;
  let wallet: Keypair;
  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ""));

    console.log(
      await connection.getBalance(
        new PublicKey(process.env.ADMIN_PUBLIC_KEY || ""),
      ),
    );
  });

  const connection = provider.connection;

  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  it("Initializes config", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const configAccountInfo = await connection.getAccountInfo(configPda);

    if (!configAccountInfo?.data?.length) {
      console.log("Config not found, initializing...");
      const tx = await program.methods
        .initialize([20, 10])
        .accounts({
          config: configPda,
          initializer: wallet.publicKey,
          admin: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log("Transaction signature:", sig);
    } else {
      console.log("Config already initialized.");
    }

    const account = await program.account.config.fetch(configPda);
    console.log("Fetched Config:", account);

    saveAccount("config", configPda.toBase58());

    assert.ok(
      account.admin.equals(wallet.publicKey),
      "Admin should match wallet public key",
    );
    assert.strictEqual(
      account.lvlPercentages.length,
      2,
      "lvlPercentages should have 2 elements",
    );
    assert.deepStrictEqual(
      account.lvlPercentages,
      [20, 10],
      "Default lvlPercentages should be [0, 0]",
    );
  });
});
