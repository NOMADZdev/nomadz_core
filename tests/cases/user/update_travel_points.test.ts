import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { NomadzCore } from '../../../target/types/nomadz_core';
import * as dotenv from 'dotenv';
import * as assert from 'assert';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

dotenv.config();

const USER_ASSET_DATA_LEN = 1696;

describe('update user travel points', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  let wallet: Keypair;
  let configPda: PublicKey;

  const user = Keypair.generate();
  const userId = 'userTravelPoints';

  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ''));
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  });

  const initUser = async (): Promise<PublicKey> => {
    await connection.requestAirdrop(user.publicKey, 1_000_000_000);
    await new Promise(res => setTimeout(res, 1000));

    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_asset_data'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    await program.methods
      .initializeUserAssetData({
        userId,
        xp: new anchor.BN(100000),
        level: 1,
        luck: 0,
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

  const updateTravelPoints = async (
    userAssetAccount: PublicKey,
    travelPoints: anchor.BN | null,
  ): Promise<void> => {
    await program.methods
      .updateUserAssetData({
        userId,
        xp: null,
        level: null,
        luck: null,
        travelPoints,
        updateReferralXp: null,
      })
      .accounts({
        userAssetData: userAssetAccount,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
      })
      .signers([wallet])
      .rpc();
  };

  it('keeps the account size unchanged and starts at zero travel points', async () => {
    const userAssetAccount = await initUser();

    const accountInfo = await connection.getAccountInfo(userAssetAccount);
    assert.strictEqual(accountInfo?.data.length, USER_ASSET_DATA_LEN);

    const userAssetData = await program.account.userAssetData.fetch(userAssetAccount);
    assert.strictEqual(userAssetData.travelPoints.toNumber(), 0);
  });

  it('sets travel points when the argument is provided', async () => {
    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_asset_data'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    const before = await program.account.userAssetData.fetch(userAssetAccount);

    await updateTravelPoints(userAssetAccount, new anchor.BN(25000));

    const after = await program.account.userAssetData.fetch(userAssetAccount);
    assert.strictEqual(after.travelPoints.toNumber(), 25000);
    assert.strictEqual(after.xp.toNumber(), before.xp.toNumber());
    assert.strictEqual(after.level, before.level);
    assert.strictEqual(after.luck, before.luck);
  });

  it('leaves travel points unchanged when the argument is omitted', async () => {
    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_asset_data'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    await updateTravelPoints(userAssetAccount, null);

    const userAssetData = await program.account.userAssetData.fetch(userAssetAccount);
    assert.strictEqual(userAssetData.travelPoints.toNumber(), 25000);

    const accountInfo = await connection.getAccountInfo(userAssetAccount);
    assert.strictEqual(accountInfo?.data.length, USER_ASSET_DATA_LEN);
  });
});
