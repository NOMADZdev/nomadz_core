import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { NomadzCore } from '../target/types/nomadz_core';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

describe('nomadz_core', () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const connection = anchor.getProvider().connection;

  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  let wallet: Keypair;

  before(async () => {
    wallet = Keypair.fromSecretKey(
      bs58.decode(
        '4vXbs1ktxg1N6UPQGCkR9u7fLiagsSJEK9eaYyJ4rMGP8UNvsjuhtfDuChCGYo8u2gu1SZfREniX2BGhCZv9HFxp',
      ),
    );

    const tx = await connection.requestAirdrop(wallet.publicKey, 5 * LAMPORTS_PER_SOL);

    while (!(await connection.getBalance(wallet.publicKey)));

    console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`Requested airdrop tx successfull: ${tx}`);
    console.log(await connection.getBalance(wallet.publicKey));

    const tx2 = await connection.requestAirdrop(
      new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw'),
      5 * LAMPORTS_PER_SOL,
    );

    while (
      !(await connection.getBalance(new PublicKey('EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw')))
    );

    console.log(`Wallet: EDFVK31PPpHM7nnv6NUSMTGko46v1u5j8TXnXje1CMPw`);
    console.log(`Requested airdrop tx successfull: ${tx}`);
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
          creator: wallet.publicKey,
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
});
