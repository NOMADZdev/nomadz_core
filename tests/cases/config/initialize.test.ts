import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";

// import { NomadzCore } from "../../../target/types/nomadz_core";
import { saveAccount } from "../../../utils/account_utils";

describe("initialize", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet.payer as anchor.web3.Keypair;
  const connection = provider.connection;

  const program = anchor.workspace.nomadzCore as Program<any>;

  it("Initializes config", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const configAccountInfo = await connection.getAccountInfo(configPda);
    if (!configAccountInfo?.data?.length) {
      const tx = await program.methods
        .initialize()
        .accounts({
          config: configPda,
          initializer: wallet.publicKey,
          admin: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      await sendAndConfirmTransaction(connection, tx, [wallet]);
    }

    saveAccount("config", configPda.toBase58());
    const accountInfo = await program.account.config.fetch(configPda);
    console.log("Config Account:", accountInfo);
  });
});
