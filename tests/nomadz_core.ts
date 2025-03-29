import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { NomadzCore } from '../target/types/nomadz_core';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { TOKEN_PROGRAM_ID } from '@coral-xyz/anchor/dist/cjs/utils/token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import defaultSoulboundMetadataJson from './metadata/soulbound.metadata.json';
import { PinataSDK } from 'pinata-web3';

const umi = createUmi('http://127.0.0.1:8899');

describe('nomadz_core', () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const connection = anchor.getProvider().connection;
  const mplTokenMetadataProgramId = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  const mplCoreProgramId = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

  const pinata = new PinataSDK({
    pinataJwt:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI2ZThlNjQzYi1hMWY5LTRmYzUtOTNjZS1mMWY1MTg1ZmNiYmYiLCJlbWFpbCI6InNoYXJvdmlraW1hZ0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiMTFlZDI3MzQ1NDQxYTY5ZmU2MzMiLCJzY29wZWRLZXlTZWNyZXQiOiJkOWM4YTM1Mjg0ZDgyYTQ3ZTUyMTI3N2QyNTY5YTFjZTEzOGVkMTZiMDgwZmQ3NTQ4ZTE1ZjM1Yzg1YzU5ZjE3IiwiZXhwIjoxNzcwMDYyODYxfQ.Ly-YAu1zKKgC8utJnN3jvqYHtB0yDWVFCEwblAuZ8Ec',
    pinataGateway: 'amaranth-payable-horse-854.mypinata.cloud',
  });

  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  let wallet: Keypair;

  before(async () => {
    wallet = Keypair.fromSecretKey(
      bs58.decode(
        '4vXbs1ktxg1N6UPQGCkR9u7fLiagsSJEK9eaYyJ4rMGP8UNvsjuhtfDuChCGYo8u2gu1SZfREniX2BGhCZv9HFxp',
      ),
    );

    // const tx = await connection.requestAirdrop(wallet.publicKey, 5 * LAMPORTS_PER_SOL);

    // while (!(await connection.getBalance(wallet.publicKey)));

    // console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
    // console.log(`Requested airdrop tx successfull: ${tx}`);
    // console.log(await connection.getBalance(wallet.publicKey));

    // const tx2 = await connection.requestAirdrop(
    //   new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw'),
    //   5 * LAMPORTS_PER_SOL,
    // );

    // while (
    //   !(await connection.getBalance(new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw')))
    // );

    // console.log(`Wallet: EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw`);
    // console.log(`Requested airdrop tx successfull: ${tx}`);
    console.log(
      await connection.getBalance(new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw')),
    );
  });

  it('Is initialized!', async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId,
    );

    const configAccountInfo = await connection.getAccountInfo(configPda);

    if (!configAccountInfo?.data?.length) {
      const tx = await program.methods
        .initialize()
        .accounts({
          config: configPda,
          initializer: wallet.publicKey,
          admin: new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw'),
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

      console.log('Your transaction signature', signature);
    }

    const accountInfo = await program.account.config.fetch(configPda);

    console.log(accountInfo);
  });

  it('Config was updated!', async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId,
    );

    const tx = await program.methods
      .updateConfig()
      .accounts({
        config: configPda,
        admin: new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw'),
        newAdmin: wallet.publicKey,
      })
      .transaction();

    const signer = Keypair.fromSecretKey(
      bs58.decode(
        '4NodMZEtDcQrYKzzJzaFtATZK6yqmZnNbGvESfBdZkSTKvME44xEikda35k8WerLgxqKS9AE72neLZqWEf3A5kyo',
      ),
    );

    const signature = await sendAndConfirmTransaction(connection, tx, [signer]);

    console.log('Your transaction signature', signature);

    const accountInfo = await program.account.config.fetch(configPda);

    console.log(accountInfo);
  });

  it('Soulbound NFT was minted!', async () => {
    const [assetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('soulbound_asset'), Buffer.from('aboba1488'), program.programId.toBytes()],
      program.programId,
    );

    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), mplTokenMetadataProgramId.toBytes(), assetAccount.toBytes()],
      mplTokenMetadataProgramId,
    );

    const [assetAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_authority'), program.programId.toBytes(), assetAccount.toBytes()],
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

    const metadataUpload = await pinata.upload.json(defaultSoulboundMetadataJson);
    const uri = `https://${metadataUpload.IpfsHash}.ipfs.dweb.link/`;

    const tx = await program.methods
      .mintSoulboundNft({ uri, userId: 'aboba1488' })
      .accounts({
        assetAccount: assetAccount,
        assetAuthority: assetAuthority,
        metadataAccount: metadataAccount,
        user: wallet.publicKey,
        nomadzProgram: program.programId,
        mplCoreProgram: mplCoreProgramId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mplTokenMetadataProgram: mplTokenMetadataProgramId,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .transaction();

    // const signer = Keypair.fromSecretKey(
    //   bs58.decode(
    //     '4NodMZEtDcQrYKzzJzaFtATZK6yqmZnNbGvESfBdZkSTKvME44xEikda35k8WerLgxqKS9AE72neLZqWEf3A5kyo',
    //   ),
    // );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    console.log(tx.serializeMessage().toString('base64'));
    // const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

    // console.log('Your transaction signature', signature);
  });
});
