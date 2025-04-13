import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
import defaultSoulboundMetadataJson from "../../../metadata/soulbound.metadata.json";
import { PinataSDK } from "pinata-web3";
import { NomadzCore } from "../../../target/types/nomadz_core";
import { getAccount } from "../../../utils/account_utils";
import * as dotenv from "dotenv";

dotenv.config();

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || "",
  pinataGateway: process.env.PINATA_GATEWAY || "",
});

describe("update soulbound", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet.payer as anchor.web3.Keypair;
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  const userId = "aboba1488";

  it("Updates metadata of the soulbound NFT", async () => {
    const assetAccount = new PublicKey(getAccount<string>("assetAccount")!);
    const [assetAuthority] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("asset_authority"),
        program.programId.toBytes(),
        assetAccount.toBytes(),
      ],
      program.programId,
    );

    const newMetadata = {
      ...defaultSoulboundMetadataJson,
      attributes: defaultSoulboundMetadataJson.attributes.map((attribute) =>
        attribute.traitType === "Discount"
          ? { ...attribute, value: "50" }
          : attribute,
      ),
    };

    const metadataUpload = await pinata.upload.json(newMetadata);
    const uri = `https://${metadataUpload.IpfsHash}.ipfs.dweb.link/`;

    const tx = await program.methods
      .updateSoulboundNft({ newUri: uri, userId })
      .accounts({
        assetAccount,
        assetAuthority,
        user: wallet.publicKey,
        nomadzProgram: program.programId,
        mplCoreProgram: new PublicKey(
          "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
        ),
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(sig);
  });
});
