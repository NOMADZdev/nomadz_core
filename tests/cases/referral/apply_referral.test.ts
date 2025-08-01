import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { NomadzCore } from '../../../target/types/nomadz_core';
import { getAccount, saveAccount } from '../../../utils/account_utils';
import * as dotenv from 'dotenv';
import * as assert from 'assert';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

dotenv.config();

describe('referral pipeline with XP from mint', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  const userA = Keypair.fromSecretKey(bs58.decode(process.env.TEST_USER_KEY || ''));
  const userB = Keypair.generate();
  const userC = Keypair.generate();

  const userAId = 'userA';
  const userBId = 'userB';
  const userCId = 'userC';

  let wallet: Keypair;

  let configPda: PublicKey;

  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ''));

    await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
    await connection.requestAirdrop(userA.publicKey, 1_000_000_000);
    await new Promise(res => setTimeout(res, 1000));
    console.log(await connection.getBalance(new PublicKey(process.env.ADMIN_PUBLIC_KEY || '')));
    console.log(await connection.getBalance(userA.publicKey));
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
    saveAccount('config', configPda.toBase58());
  });

  const initUserAssetData = async (user: Keypair, userId: string) => {
    await connection.requestAirdrop(user.publicKey, 1_000_000_000);
    await new Promise(res => setTimeout(res, 1000));

    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_asset_data'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    const newXP = new anchor.BN(100);
    const newLevel = 10;
    const newLuck = 42;

    await program.methods
      // .initializeUserAssetData(userId, newXP, newLevel, newLuck)
      .initializeUserAssetData({
        userId,
        xp: newXP,
        level: newLevel,
        luck: newLuck,
      })
      .accounts({
        userAssetData: userAssetAccount,
        user: user.publicKey,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();

    return userAssetAccount;
  };

  const mintSoulbound = async (
    user: Keypair,
    userId: string,
    remainingAccounts: {
      pubkey: PublicKey;
      isWritable: boolean;
      isSigner: boolean;
    }[] = [],
  ) => {
    const configFeeVault = getAccount<string>('configFeeVault');

    if (!configFeeVault) {
      throw new Error('Config fee vault was not provided');
    }

    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_asset_data'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    const [assetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('soulbound_asset'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    const [assetAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_authority'), program.programId.toBytes(), assetAccount.toBytes()],
      program.programId,
    );

    const tx = await program.methods
      .mintSoulboundNft({ uri: 'ipfs://mock', userId })
      .accounts({
        userAssetData: userAssetAccount,
        assetAccount,
        assetAuthority,
        user: user.publicKey,
        payer: user.publicKey,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
        mplCoreProgram: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'),
        feeVault: configFeeVault,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([user, wallet])
      .rpc();

    console.log(`Minted for ${userId}`, tx);
  };

  it('User C mints, B gets XP (level 1), A gets nothing', async () => {
    const userAAcc = await initUserAssetData(userA, userAId);
    const userBAcc = await initUserAssetData(userB, userBId);
    const userCAcc = await initUserAssetData(userC, userCId);

    saveAccount('userA', userAAcc.toBase58());
    saveAccount('userB', userBAcc.toBase58());
    saveAccount('userC', userCAcc.toBase58());

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 300_000,
    });

    // Instruction for B is referred by A
    const applyReferralB = await program.methods
      .applyReferral()
      .accounts({
        userAssetData: userBAcc,
        referrerAssetData: userAAcc,
        authority: wallet.publicKey,
        config: configPda,
      })
      .instruction();

    // Instruction for C is referred by B
    const applyReferralC = await program.methods
      .applyReferral()
      .accounts({
        userAssetData: userCAcc,
        referrerAssetData: userBAcc,
        authority: wallet.publicKey,
        config: configPda,
      })
      .instruction();

    const txB = new Transaction().add(computeIx, applyReferralB);
    const txC = new Transaction().add(computeIx, applyReferralC);

    await provider.sendAndConfirm(txB, [wallet]);
    await provider.sendAndConfirm(txC, [wallet]);

    // Mint NFT only for userC, pass B as remaining (level 1 referrer)
    await mintSoulbound(userC, userCId, [
      // {
      //   pubkey: userBAcc,
      //   isWritable: true,
      //   isSigner: false,
      // },
    ]);
    const nupdateXP = new anchor.BN(150);

    const tx2 = await program.methods
      .updateUserWithReferrer({
        userId: userCId,
        referrerId: userBId,
        userXp: nupdateXP,
        userLevel: 1,
        userLuck: 0,
        referrerXp: nupdateXP,
        referrerLevel: 1,
        referrerLuck: 0,
      })
      .accounts({
        userAssetData: userCAcc,
        referrerAssetData: userBAcc,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
      })
      .signers([wallet])
      .rpc();

    const dataA = await program.account.userAssetData.fetch(userAAcc);
    const dataB = await program.account.userAssetData.fetch(userBAcc);
    const dataC = await program.account.userAssetData.fetch(userCAcc);

    console.log(
      'Referral History A:',
      dataA.referralHistory.map((r: any) => ({
        referrer: r.referrer.toBase58(),
        level: r.level,
      })),
    );

    console.log(
      'Referral History B:',
      dataB.referralHistory.map((r: any) => ({
        referrer: r.referrer.toBase58(),
        level: r.level,
      })),
    );

    console.log(
      'Referral History C:',
      dataC.referralHistory.map((r: any) => ({
        referrer: r.referrer.toBase58(),
        level: r.level,
      })),
    );

    console.log('XP A:', dataA.xp.toNumber());
    console.log('XP B:', dataB.xp.toNumber());
    console.log('XP C:', dataC.xp.toNumber());

    assert.strictEqual(dataA.xp.toNumber(), 100);
    assert.strictEqual(dataB.xp.toNumber(), 150);
    assert.strictEqual(dataC.xp.toNumber(), 150);

    assert.strictEqual(dataC.referralHistory.length, 2);
    assert.strictEqual(dataC.referralHistory[0].referrer.toBase58(), userAAcc.toBase58());
    assert.strictEqual(dataC.referralHistory[0].level, 2);
    assert.strictEqual(dataC.referralHistory[1].referrer.toBase58(), userBAcc.toBase58());
    assert.strictEqual(dataC.referralHistory[1].level, 1);
  });
});
