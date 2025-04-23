import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { NomadzCore } from "../../../target/types/nomadz_core";
import { getAccount } from "../../../utils/account_utils";
import * as dotenv from "dotenv";
import * as assert from "assert";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

dotenv.config();

describe("update user stats with referral XP rewards", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  let wallet: Keypair;
  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ""));

    await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
    await new Promise((res) => setTimeout(res, 1000));
    console.log(
      await connection.getBalance(
        new PublicKey(process.env.ADMIN_PUBLIC_KEY || ""),
      ),
    );
  });
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  const userId = "userC";
  const level1Id = "userB";
  const level2Id = "userA";

  let userCPubkey: PublicKey;
  let userBPubkey: PublicKey;
  let userAPubkey: PublicKey;
  let configPda: PublicKey;
  let userAssetAccount: PublicKey;
  let level1Account: PublicKey;
  let level2Account: PublicKey;

  before(async () => {
    const userIdstr = getAccount<string>(userId);
    const level1Idstr = getAccount<string>(level1Id);
    const level2Idstr = getAccount<string>(level2Id);
    if (userIdstr && level1Idstr && level2Idstr) {
      userCPubkey = new PublicKey(userIdstr);
      userBPubkey = new PublicKey(level1Idstr);
      userAPubkey = new PublicKey(level2Idstr);
    }

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    [userAssetAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_asset_data"),
        Buffer.from(userId),
        program.programId.toBytes(),
      ],
      program.programId,
    );

    [level1Account] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_asset_data"),
        Buffer.from(level1Id),
        program.programId.toBytes(),
      ],
      program.programId,
    );

    [level2Account] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_asset_data"),
        Buffer.from(level2Id),
        program.programId.toBytes(),
      ],
      program.programId,
    );
  });

  const initUser = async (
    user: Keypair,
    userId: string,
  ): Promise<PublicKey> => {
    await connection.requestAirdrop(user.publicKey, 1_000_000_000);
    await new Promise((res) => setTimeout(res, 1000));

    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_asset_data"),
        Buffer.from(userId),
        program.programId.toBytes(),
      ],
      program.programId,
    );

    await program.methods
      .initializeUserAssetData(userId, new anchor.BN(100000), 1, 0)
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
  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userC = Keypair.generate();
  const userD = Keypair.generate();
  const userF = Keypair.generate();

  const userAId = "userA";
  const userBId = "userB";
  const userCId = "userC";
  const userDId = "userD";
  const userFId = "userF";
  it("builds 2 referral branches and distributes XP", async () => {
    const updateXP = new anchor.BN(175000);
    const newLevel = 10;
    const newLuck = 42;

    const accA = await initUser(userA, userAId);
    const accB = await initUser(userB, userBId);
    const accC = await initUser(userC, userCId);
    const accD = await initUser(userD, userDId);
    const accF = await initUser(userF, userFId);

    // Apply referrals
    await program.methods
      .applyReferral()
      .accounts({
        userAssetData: accB,
        referrerAssetData: accA,
        authority: wallet.publicKey,
        config: configPda,
      })
      .signers([wallet])
      .rpc();

    await program.methods
      .applyReferral()
      .accounts({
        userAssetData: accC,
        referrerAssetData: accB,
        authority: wallet.publicKey,
        config: configPda,
      })
      .signers([wallet])
      .rpc();

    await program.methods
      .applyReferral()
      .accounts({
        userAssetData: accD,
        referrerAssetData: accA,
        authority: wallet.publicKey,
        config: configPda,
      })
      .signers([wallet])
      .rpc();

    await program.methods
      .applyReferral()
      .accounts({
        userAssetData: accF,
        referrerAssetData: accD,
        authority: wallet.publicKey,
        config: configPda,
      })
      .signers([wallet])
      .rpc();

    const beforeA = await program.account.userAssetData.fetch(accA);
    const beforeB = await program.account.userAssetData.fetch(accB);
    const beforeD = await program.account.userAssetData.fetch(accD);

    // Update user C
    const tx = await program.methods
      .updateUserAssetData(userCId, updateXP, newLevel, newLuck)
      .accounts({
        userAssetData: accC,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
      })
      .remainingAccounts([
        { pubkey: accB, isWritable: true, isSigner: false },
        { pubkey: accA, isWritable: true, isSigner: false },
      ])
      .signers([wallet])
      .rpc();

    // Update user F
    const tx2 = await program.methods
      .updateUserAssetData(userFId, updateXP, newLevel, newLuck)
      .accounts({
        userAssetData: accF,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
      })
      .remainingAccounts([
        { pubkey: accD, isWritable: true, isSigner: false },
        { pubkey: accA, isWritable: true, isSigner: false },
      ])
      .signers([wallet])
      .rpc();

    console.log("Link: ", tx);
    console.log("Link: ", tx2);

    const afterA = await program.account.userAssetData.fetch(accA);
    const afterB = await program.account.userAssetData.fetch(accB);
    const afterD = await program.account.userAssetData.fetch(accD);
    const afterC = await program.account.userAssetData.fetch(accC);
    const afterF = await program.account.userAssetData.fetch(accF);

    const deltaA = afterA.xp.toNumber() - beforeA.xp.toNumber(); // +10 (C) +10 (F)
    const deltaB = afterB.xp.toNumber() - beforeB.xp.toNumber(); // +20 from C
    const deltaD = afterD.xp.toNumber() - beforeD.xp.toNumber(); // +20 from F

    console.log("XP A gained:", deltaA); // 20
    console.log("XP B gained:", deltaB); // 20
    console.log("XP D gained:", deltaD); // 20
    console.log("XP C:", afterC.xp.toNumber()); // 200 (100 base + 100 update)
    console.log("XP F:", afterF.xp.toNumber()); // 200

    assert.strictEqual(afterC.xp.toNumber(), 175000); // 100 initial + 100 update
    assert.strictEqual(afterF.xp.toNumber(), 175000); // 100 initial + 100 update
    assert.strictEqual(
      deltaA,
      7500,
      "A should receive 10 from C and 10 from F",
    );
    assert.strictEqual(deltaB, 15000, "B should receive 10 from C");
    assert.strictEqual(deltaD, 15000, "D should receive 10 from F");
  });
});
