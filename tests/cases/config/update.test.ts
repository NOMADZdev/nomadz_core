import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
// import { NomadzCore } from "../../../target/types/nomadz_core";
import { getAccount } from "../../../utils/account_utils";

describe("update config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet.payer as anchor.web3.Keypair;
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<any>;

  it("Updates the config admin", async () => {
    const configPdaStr = getAccount<string>("config");
    if (!configPdaStr) throw new Error("Missing config address");
    const configPda = new PublicKey(configPdaStr);

    const tx = await program.methods
      .updateConfig()
      .accounts({
        config: configPda,
        admin: wallet.publicKey,
        newAdmin: wallet.publicKey,
      })
      .transaction();

    await sendAndConfirmTransaction(connection, tx, [wallet]);
    const updated = await program.account.config.fetch(configPda);
    console.log("Updated Config:", updated);
  });
});
