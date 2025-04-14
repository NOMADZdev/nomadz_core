import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import * as assert from "assert";

import { getAccount } from "../../../utils/account_utils";
import { NomadzCore } from "../../../target/types/nomadz_core";

describe("update config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet.payer as anchor.web3.Keypair;
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  it("Updates the config admin and level percentages", async () => {
    const configPdaStr = getAccount<string>("config");
    if (!configPdaStr) throw new Error("Missing config address");
    const configPda = new PublicKey(configPdaStr);

    const before = await program.account.config.fetch(configPda);
    console.log("Before update:", before);

    const newLvlPercentages: [number, number] = [15, 35];

    const tx = await program.methods
      .updateConfig(wallet.publicKey, newLvlPercentages)
      .accounts({
        config: configPda,
        admin: wallet.publicKey,
        newAdmin: wallet.publicKey,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log("Transaction signature:", sig);

    const after = await program.account.config.fetch(configPda);
    console.log("After update:", after);

    assert.ok(after.admin.equals(wallet.publicKey), "Admin should be updated");
    assert.deepStrictEqual(
      after.lvlPercentages,
      newLvlPercentages,
      "Level percentages should be updated",
    );
  });
});
