import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import * as assert from 'assert';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import { NomadzCore } from '../../../target/types/nomadz_core';
import { getAccount, saveAccount } from '../../../utils/account_utils';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import * as dotenv from 'dotenv';

dotenv.config();

describe('initialize', async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // const wallet = provider.wallet.payer as anchor.web3.Keypair;
  const configFeeVault = new PublicKey('CwKJ22GahUScYc5m63gdtfyKLg8Hg8DuzBjwCBdprqv5');
  const configMintSoulboundFee = 0.005 * LAMPORTS_PER_SOL; // 0.2 SOL
  let wallet: Keypair;

  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ''));

    saveAccount('configFeeVault', configFeeVault.toBase58());
    // await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
    // await new Promise(res => setTimeout(res, 1000));
    console.log(await connection.getBalance(new PublicKey(process.env.ADMIN_PUBLIC_KEY || '')));
  });

  const connection = provider.connection;

  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  it('Initializes config', async () => {
    const configFeeVault = getAccount<string>('configFeeVault');

    if (!configFeeVault) {
      throw new Error('Config fee vault was not provided');
    }

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId,
    );

    const configAccountInfo = await connection.getAccountInfo(configPda);

    if (!configAccountInfo?.data?.length) {
      console.log('Config not found, initializing...');
      const tx = await program.methods
        .initialize({
          lvlPercentages: [10, 5],
          mintSoulboundFee: new anchor.BN(configMintSoulboundFee),
        })
        .accounts({
          config: configPda,
          initializer: wallet.publicKey,
          admin: wallet.publicKey,
          feeVault: new PublicKey(configFeeVault),
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('Transaction signature:', sig);
    } else {
      console.log('Config already initialized.');
    }

    const account = await program.account.config.fetch(configPda);
    console.log('Fetched Config:', account);

    saveAccount('config', configPda.toBase58());

    assert.ok(account.admin.equals(wallet.publicKey), 'Admin should match wallet public key');
    assert.ok(
      account.feeVault.toBase58() === configFeeVault,
      'Fee vault should match config fee vault public key',
    );
    assert.strictEqual(
      account.mintSoulboundFee.toNumber(),
      configMintSoulboundFee,
      'Mint soulbound fee must match the config mint soulbound fee',
    );
    assert.strictEqual(account.lvlPercentages.length, 2, 'lvlPercentages should have 2 elements');
    assert.deepStrictEqual(
      account.lvlPercentages,
      [10, 5],
      'Default lvlPercentages should be [0, 0]',
    );
  });
});
