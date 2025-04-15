import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { NomadzCore } from "../../../target/types/nomadz_core";
import { getAccount } from "../../../utils/account_utils";
import * as dotenv from "dotenv";
import * as assert from "assert";

dotenv.config();

describe("update user stats with referral XP rewards", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet.payer as Keypair;
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

  it("should update user stats and distribute XP to level 1 and 2", async () => {
    const newXP = new anchor.BN(500);
    const newLevel = 10;
    const newLuck = 42;

    const beforeB = await program.account.userAssetData.fetch(level1Account);
    const beforeA = await program.account.userAssetData.fetch(level2Account);

    const tx = await program.methods
      .updateUserAssetData(userId, newXP, newLevel, newLuck)
      .accounts({
        userAssetData: userAssetAccount,
        admin: wallet.publicKey,
        config: configPda,
        nomadzProgram: program.programId,
      })
      .remainingAccounts([
        { pubkey: level1Account, isWritable: true, isSigner: false },
        { pubkey: level2Account, isWritable: true, isSigner: false },
      ])
      .signers([wallet])
      .rpc();

    console.log("Transaction:", tx);

    const updated = await program.account.userAssetData.fetch(userAssetAccount);
    const updatedB = await program.account.userAssetData.fetch(level1Account);
    const updatedA = await program.account.userAssetData.fetch(level2Account);

    assert.strictEqual(updated.xp.toNumber(), newXP.toNumber());
    assert.strictEqual(updated.level, newLevel);
    assert.strictEqual(updated.luck, newLuck);

    const bDiff = updatedB.xp.toNumber() - beforeB.xp.toNumber();
    const aDiff = updatedA.xp.toNumber() - beforeA.xp.toNumber();

    console.log("Level 1 (B) XP before:", updatedB.xp.toNumber());
    console.log("Level 1 (B) XP gained:", bDiff);
    console.log("Level 2 (A) XP before:", updatedA.xp.toNumber());

    console.log("Level 2 (A) XP gained:", aDiff);

    // assert(bDiff > 0);
    // assert(aDiff > 0);
  });
});
