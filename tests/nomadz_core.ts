import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NomadzCore } from "../target/types/nomadz_core";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import defaultSoulboundMetadataJson from "../metadata/soulbound.metadata.json";
import { PinataSDK } from "pinata-web3";

const umi = createUmi("http://127.0.0.1:8899");

describe("nomadz_core", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  const connection = anchor.getProvider().connection;
  anchor.setProvider(provider);
  // const wallet = provider.wallet;
  const wallet = provider.wallet.payer as Keypair;

  const mplTokenMetadataProgramId = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const mplCoreProgramId = new PublicKey(
    "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
  );

  const pinata = new PinataSDK({
    pinataJwt: process.env.PINATA_JWT || "",
    pinataGateway: process.env.PINATA_GATEWAY || "",
  });

  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  it("Is initialized!", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const configAccountInfo = await connection.getAccountInfo(configPda);
    console.log(configAccountInfo);
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

      const signature = await sendAndConfirmTransaction(connection, tx, [
        wallet,
      ]);

      console.log("Your transaction signature", signature);
    }

    const accountInfo = await program.account.config.fetch(configPda);

    console.log(accountInfo);
  });

  it("Config was updated!", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const tx = await program.methods
      .updateConfig()
      .accounts({
        config: configPda,
        admin: wallet.publicKey,
        newAdmin: wallet.publicKey,
      })
      .transaction();

    const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

    // console.log("Your transaction signature", signature);

    const accountInfo = await program.account.config.fetch(configPda);

    console.log("Admin: ", accountInfo);
  });

  it("Soulbound NFT was minted!", async () => {
    const [assetAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("soulbound_asset"),
        Buffer.from("aboba1488"),
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

    console.log({
      assetAccount: assetAccount,
      assetAuthority: assetAuthority,
      metadataAccount: metadataAccount,
      user: wallet.publicKey,
      nomadzProgram: program.programId,
      mplCoreProgram: mplCoreProgramId,
      tokenProgram: TOKEN_PROGRAM_ID,
      mplTokenMetadataProgramId: mplTokenMetadataProgramId,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    });

    const metadataUpload = await pinata.upload.json(
      defaultSoulboundMetadataJson,
    );
    const uri = `https://${metadataUpload.IpfsHash}.ipfs.dweb.link/`;

    const tx = await program.methods
      .mintSoulboundNft({ uri, userId: "aboba1488" })
      .accounts({
        assetAccount: assetAccount,
        assetAuthority: assetAuthority,
        metadataAccount: metadataAccount,
        user: wallet.publicKey,
        nomadzProgram: program.programId,
        mplCoreProgram: mplCoreProgramId,
        tokenProgram: TOKEN_PROGRAM_ID,
        masterEditionAccount: masterEditionAccount,
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
    console.log(tx.serializeMessage().toString("base64"));
    const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

    console.log("Your transaction signature", signature);
  });

  it("Soulbound NFT was updated!", async () => {
    const [assetAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("soulbound_asset"),
        Buffer.from("aboba1488"),
        program.programId.toBytes(),
      ],
      program.programId,
    );

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
      .updateSoulboundNft({ newUri: uri, userId: "aboba1488" })
      .accounts({
        assetAccount: assetAccount,
        assetAuthority: assetAuthority,
        user: wallet.publicKey,
        nomadzProgram: program.programId,
        mplCoreProgram: mplCoreProgramId,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    console.log(tx.serializeMessage().toString("base64"));
    const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

    console.log("Your transaction signature", signature);
  });
});
