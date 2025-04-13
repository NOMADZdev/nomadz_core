import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import defaultSoulboundMetadataJson from "../../../metadata/soulbound.metadata.json";
import { PinataSDK } from "pinata-web3";
import { NomadzCore } from "../../../target/types/nomadz_core";
import { saveAccount } from "../../../utils/account_utils";

import * as dotenv from "dotenv";

dotenv.config();
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || "",
  pinataGateway: process.env.PINATA_GATEWAY || "",
});

const umi = createUmi("http://127.0.0.1:8899");

describe("mint soulbound", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet.payer as anchor.web3.Keypair;
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  const userId = "aboba1488";
  const mplTokenMetadataProgramId = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const mplCoreProgramId = new PublicKey(
    "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
  );

  it("Mints a soulbound NFT", async () => {
    const [assetAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("soulbound_asset"),
        Buffer.from(userId),
        program.programId.toBytes(),
      ],
      program.programId,
    );

    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_asset_data"),
        Buffer.from(userId),
        program.programId.toBytes(),
      ],
      program.programId,
    );

    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        mplTokenMetadataProgramId.toBytes(),
        assetAccount.toBytes(),
      ],
      mplTokenMetadataProgramId,
    );

    const [masterEditionAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        mplTokenMetadataProgramId.toBytes(),
        assetAccount.toBytes(),
        Buffer.from("edition"),
      ],
      mplTokenMetadataProgramId,
    );

    const [assetAuthority] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("asset_authority"),
        program.programId.toBytes(),
        assetAccount.toBytes(),
      ],
      program.programId,
    );

    const metadataUpload = await pinata.upload.json(
      defaultSoulboundMetadataJson,
    );
    const uri = `https://${metadataUpload.IpfsHash}.ipfs.dweb.link/`;

    const tx = await program.methods
      .mintSoulboundNft({ uri, userId })
      .accounts({
        userAssetData: userAssetAccount,
        assetAccount,
        assetAuthority,
        metadataAccount,
        user: wallet.publicKey,
        nomadzProgram: program.programId,
        mplCoreProgram: mplCoreProgramId,
        tokenProgram: TOKEN_PROGRAM_ID,
        masterEditionAccount,
        mplTokenMetadataProgram: mplTokenMetadataProgramId,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    saveAccount("assetAccount", assetAccount.toBase58());
    saveAccount("userAssetAccount", userAssetAccount.toBase58());
    console.log(sig);
  });
});
