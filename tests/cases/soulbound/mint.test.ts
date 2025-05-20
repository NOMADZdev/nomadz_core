import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@coral-xyz/anchor/dist/cjs/utils/token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import defaultSoulboundMetadataJson from '../../../metadata/soulbound.metadata.json';
import { PinataSDK } from 'pinata-web3';
import { NomadzCore } from '../../../target/types/nomadz_core';
import { getAccount, saveAccount } from '../../../utils/account_utils';

import * as dotenv from 'dotenv';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

dotenv.config();
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || '',
  pinataGateway: process.env.PINATA_GATEWAY || '',
});

const umi = createUmi('http://127.0.0.1:8899');

describe('mint soulbound', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.nomadzCore as Program<NomadzCore>;

  const userId = 'userA';
  const mplCoreProgramId = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

  let wallet: Keypair;
  let user = Keypair.fromSecretKey(bs58.decode(process.env.TEST_USER_KEY || ''));

  before(async () => {
    wallet = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY || ''));

    await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
    await connection.requestAirdrop(user.publicKey, 1_000_000_000);
    await new Promise(res => setTimeout(res, 1000));
    console.log(await connection.getBalance(user.publicKey));
    console.log(await connection.getBalance(new PublicKey(process.env.ADMIN_PUBLIC_KEY || '')));
  });

  it('Mints a soulbound NFT', async () => {
    const configPdaStr = getAccount<string>('config_v2');
    if (!configPdaStr) throw new Error('Missing config address');
    const configPda = new PublicKey(configPdaStr);

    const [assetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('soulbound_asset'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    const [userAssetAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_asset_data'), Buffer.from(userId), program.programId.toBytes()],
      program.programId,
    );

    const [assetAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_authority'), program.programId.toBytes(), assetAccount.toBytes()],
      program.programId,
    );

    const metadataUpload = await pinata.upload.json(defaultSoulboundMetadataJson);
    const uri = `https://${metadataUpload.IpfsHash}.ipfs.dweb.link/`;

    const configFeeVault = getAccount<string>('configFeeVault');

    if (!configFeeVault) {
      throw new Error('Config fee vault was not provided');
    }

    const tx = await program.methods
      .mintSoulboundNft({ uri, userId })
      .accounts({
        userAssetData: userAssetAccount,
        assetAccount,
        assetAuthority,
        config: configPda,
        admin: wallet.publicKey,
        user: user.publicKey,
        nomadzProgram: program.programId,
        mplCoreProgram: mplCoreProgramId,
        feeVault: configFeeVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([user, wallet])
      .transaction();

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = user.publicKey;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    const sig = await sendAndConfirmTransaction(connection, tx, [user, wallet]);
    saveAccount('assetAccount', assetAccount.toBase58());
    saveAccount('userAssetAccount', userAssetAccount.toBase58());
    console.log(sig);
  });
});
