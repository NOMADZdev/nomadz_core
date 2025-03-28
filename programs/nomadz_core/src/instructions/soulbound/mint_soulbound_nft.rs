use anchor_lang::prelude::*;
use anchor_spl::{
    metadata::{
        create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
        Metadata,
    },
    token::{Mint, Token},
};
use mpl_core::{
    instructions::CreateV2CpiBuilder,
    types::{FreezeDelegate, Plugin, PluginAuthorityPair},
};

use crate::errors::MintSoulboundNftErrorCode;

pub fn mint_soulbound_nft_handler(
    ctx: Context<MintSoulboundNFT>,
    args: MintSoulboundNFTArgs,
) -> Result<()> {
    let MintSoulboundNFTArgs { uri, name } = args;

    let asset = &ctx.accounts.asset_account;
    let user = &ctx.accounts.user;
    let mpl_core_program = &ctx.accounts.mpl_core_program;
    let nomadz_program = &ctx.accounts.nomadz_program;

    let asset_account_info = asset.to_account_info();
    let user_account_info = user.to_account_info();
    let nomadz_program_account_info = nomadz_program.to_account_info();

    create_metadata_accounts_v3(
        CpiContext::new(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata_account.to_account_info(),
                mint: ctx.accounts.asset_account.to_account_info(),
                mint_authority: ctx.accounts.user.to_account_info(),
                update_authority: ctx.accounts.user.to_account_info(),
                payer: ctx.accounts.user.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
        ),
        DataV2 {
            name: String::from("Test token"),
            symbol: String::from("TSTTKN"),
            uri: String::from("https://aboba.com"),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        false,
        true,
        None,
    )
    .map_err(|_| MintSoulboundNftErrorCode::UnknownError)?;

    let mut builder = CreateV2CpiBuilder::new(mpl_core_program);
    let builder = builder
        .asset(&asset_account_info)
        .name(name)
        .uri(uri)
        .authority(Some(&nomadz_program_account_info))
        .payer(&user_account_info)
        .owner(Some(&user_account_info))
        .update_authority(Some(&nomadz_program_account_info))
        .plugins(vec![PluginAuthorityPair {
            plugin: Plugin::FreezeDelegate(FreezeDelegate { frozen: true }),
            authority: None,
        }]);

    builder
        .invoke()
        .map_err(|_| MintSoulboundNftErrorCode::UnknownError)?;

    Ok(())
}

#[derive(Accounts)]
pub struct MintSoulboundNFT<'info> {
    #[account(
        init,
        payer = user,
        mint::decimals = 9,
        mint::authority = user.key(),
        mint::freeze_authority = user.key(),
    )]
    pub asset_account: Account<'info, Mint>,

    /// CHECK: Validate address by deriving pda
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), asset_account.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub metadata_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(address = mpl_core::ID)]
    pub mpl_core_program: AccountInfo<'info>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,

    pub token_metadata_program: Program<'info, Metadata>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct MintSoulboundNFTArgs {
    name: String,
    uri: String,
}
