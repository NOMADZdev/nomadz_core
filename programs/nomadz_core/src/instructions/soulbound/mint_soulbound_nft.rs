use crate::state::soulbound::asset_data::UserAssetData;
use crate::{ errors::MintSoulboundNftErrorCode, state::config::config::Config };
use anchor_lang::prelude::*;
use anchor_lang::system_program::{ transfer, Transfer };
use mpl_core::types::PluginAuthority;
use mpl_core::{
    instructions::CreateV2CpiBuilder,
    types::{ FreezeDelegate, Plugin, PluginAuthorityPair },
};

pub fn mint_soulbound_nft_handler(
    ctx: Context<MintSoulboundNFT>,
    args: MintSoulboundNFTArgs
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        MintSoulboundNftErrorCode::Unauthorized
    );

    let MintSoulboundNFTArgs { uri, user_id } = args;

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    let asset_account = &ctx.accounts.asset_account;
    let user = &ctx.accounts.user;
    let payer = &ctx.accounts.payer;
    let asset_authority = &ctx.accounts.asset_authority;
    let mpl_core_program = &ctx.accounts.mpl_core_program;
    let system_program = &ctx.accounts.system_program;
    let nomadz_program = &ctx.accounts.nomadz_program;
    let config = &ctx.accounts.config;
    let fee_vault = &ctx.accounts.fee_vault;

    user_asset_data.asset = asset_account.key();

    let asset_account_info = asset_account.to_account_info();
    let asset_authority_account_info = asset_authority.to_account_info();
    let user_account_info = user.to_account_info();
    let payer_account_info = payer.to_account_info();

    let asset_account_seeds: &[&[&[u8]]] = &[
        &[
            b"soulbound_asset",
            &user_id.as_bytes(),
            &nomadz_program.key().to_bytes(),
            &[ctx.bumps.asset_account],
        ],
    ];

    let asset_authority_seeds: &[&[&[u8]]] = &[
        &[
            b"asset_authority",
            &nomadz_program.key().to_bytes(),
            &asset_account.key().to_bytes(),
            &[ctx.bumps.asset_authority],
        ],
    ];

    let transfer_cpi_context = CpiContext::new(system_program.to_account_info(), Transfer {
        from: payer_account_info.clone(),
        to: fee_vault.to_account_info(),
    });

    msg!(
        "Payer account balance: {:?}, required mint soulbound fee: {:?}",
        payer.lamports(),
        config.mint_soulbound_fee
    );
    require_gt!(
        payer.lamports(),
        config.mint_soulbound_fee,
        MintSoulboundNftErrorCode::InsufficientBalance
    );

    transfer(transfer_cpi_context, config.mint_soulbound_fee)?;

    let mut builder = CreateV2CpiBuilder::new(mpl_core_program);
    let builder = builder
        .asset(&asset_account_info)
        .name(String::from("NOMADZ Soulbound"))
        .uri(uri.clone())
        .authority(Some(&asset_authority_account_info))
        .payer(&payer_account_info)
        .owner(Some(&user_account_info))
        .update_authority(Some(&asset_authority_account_info))
        .system_program(system_program)
        .plugins(
            vec![PluginAuthorityPair {
                plugin: Plugin::FreezeDelegate(FreezeDelegate { frozen: true }),
                authority: Some(PluginAuthority::Address { address: ctx.accounts.admin.key() }),
            }]
        );

    builder
        .invoke_signed(&[asset_account_seeds[0], asset_authority_seeds[0]])
        .map_err(|_| MintSoulboundNftErrorCode::AssetCreationError)?;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct MintSoulboundNFTArgs {
    uri: String,
    user_id: String,
}

#[derive(Accounts)]
#[instruction(args: MintSoulboundNFTArgs)]
pub struct MintSoulboundNFT<'info> {
    #[account(mut,
        seeds = [b"user_asset_data", args.user_id.as_bytes(), nomadz_program.key().as_ref()],
        bump,
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(
        mut,
        seeds = [b"soulbound_asset", args.user_id.as_bytes(), nomadz_program.key().as_ref()],
        bump,
        seeds::program = nomadz_program.key()
    )]
    pub asset_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"asset_authority", nomadz_program.key().as_ref(), asset_account.key().as_ref()],
        bump,
        seeds::program = nomadz_program.key()
    )]
    pub asset_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub user: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    #[account(mut, constraint = fee_vault.key() == config.fee_vault @ MintSoulboundNftErrorCode::FeeVaultMismatch)]
    pub fee_vault: AccountInfo<'info>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,

    #[account(address = mpl_core::ID)]
    pub mpl_core_program: AccountInfo<'info>,

    #[account(address = solana_program::system_program::ID)]
    pub system_program: Program<'info, System>,
}
