import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import * as assert from 'assert';
import { saveAccount } from '../../../utils/account_utils';
import { NomadzCore } from '../../../target/types/nomadz_core';
import { BN } from 'bn.js';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import * as dotenv from 'dotenv';

dotenv.config();

describe('update config', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  const newConfigFeeVault = new PublicKey('CwKJ22GahUScYc5m63gdtfyKLg8Hg8DuzBjwCBdprqv5');
  const newConfigMintSoulboundFee = 0.005 * LAMPORTS_PER_SOL; // 0.2 SOL

  let wallet: Keypair;

  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ''));

    await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
    await new Promise(res => setTimeout(res, 1000));
    console.log(await connection.getBalance(new PublicKey(process.env.ADMIN_PUBLIC_KEY || '')));
  });

  it('Updates the config data', async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId,
    );

    const before = await program.account.config.fetch(configPda);
    console.log('Before update:', before);

    const newLvlPercentages: [number, number] = [10, 5];

    const tx = await program.methods
      .updateConfig({
        lvlPercentages: null,
        mintSoulboundFee: new BN(newConfigMintSoulboundFee),
        admin: null,
        feeVault: newConfigFeeVault,
      })
      .accounts({
        config: configPda,
        admin: wallet.publicKey,
        newAdmin: wallet.publicKey,
        newFeeVault: newConfigFeeVault,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('Transaction signature:', sig);

    const after = await program.account.config.fetch(configPda);
    console.log('After update:', after);

    assert.ok(after.admin.equals(wallet.publicKey), 'Admin should be updated');
    assert.ok(after.feeVault.equals(newConfigFeeVault), 'Fee vault should be updated');
    assert.strictEqual(
      after.mintSoulboundFee.toNumber(),
      newConfigMintSoulboundFee,
      'Mint soulbound fee should be updated',
    );
    assert.deepStrictEqual(
      after.lvlPercentages,
      newLvlPercentages,
      'Level percentages should be updated',
    );

    saveAccount('configFeeVault', after.feeVault.toBase58());
  });
});
