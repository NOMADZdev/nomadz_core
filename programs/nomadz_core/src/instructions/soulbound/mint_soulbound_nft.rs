use anchor_lang::prelude::*;
use anchor_spl::{ metadata::{ mpl_token_metadata::{ self }, Metadata }, token::Token };
use mpl_core::{
    instructions::CreateV2CpiBuilder,
    types::{ FreezeDelegate, Plugin, PluginAuthorityPair },
};

use crate::errors::MintSoulboundNftErrorCode;

pub fn mint_soulbound_nft_handler(
    ctx: Context<MintSoulboundNFT>,
    args: MintSoulboundNFTArgs
) -> Result<()> {
    let MintSoulboundNFTArgs { uri, user_id } = args;

    let asset_account = &ctx.accounts.asset_account;
    let user = &ctx.accounts.user;
    let asset_authority = &ctx.accounts.asset_authority;
    let mpl_core_program = &ctx.accounts.mpl_core_program;
    let system_program = &ctx.accounts.system_program;
    let nomadz_program = &ctx.accounts.nomadz_program;
    // let metadata_account = &ctx.accounts.metadata_account;
    // let master_edition_account = &ctx.accounts.master_edition_account;
    // let mpl_token_metadata_program = &ctx.accounts.mpl_token_metadata_program;
    // let rent = &ctx.accounts.rent;
    // let token_program = &ctx.accounts.token_program;
    // let sysvar_instructions = &ctx.accounts.sysvar_instructions;

    let asset_account_info = asset_account.to_account_info();
    let asset_authority_account_info = asset_authority.to_account_info();
    let user_account_info = user.to_account_info();
    // let metadata_account_info = metadata_account.to_account_info();
    // let master_edition_account_info = master_edition_account.to_account_info();
    // let system_program_account_info = system_program.to_account_info();
    // let rent_account_info = rent.to_account_info();
    // let token_program_account_info = token_program.to_account_info();
    // let sysvar_instructions_account_onfo = sysvar_instructions.to_account_info();

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

    let mut builder = CreateV2CpiBuilder::new(mpl_core_program);
    let builder = builder
        .asset(&asset_account_info)
        .name(String::from("NOMADZ Soulbound"))
        .uri(uri.clone())
        .authority(Some(&asset_authority_account_info))
        .payer(&user_account_info)
        .owner(Some(&user_account_info))
        .update_authority(Some(&asset_authority_account_info))
        .system_program(system_program)
        .plugins(
            vec![PluginAuthorityPair {
                plugin: Plugin::FreezeDelegate(FreezeDelegate { frozen: true }),
                authority: None,
            }]
        );

    builder
        .invoke_signed(&[asset_account_seeds[0], asset_authority_seeds[0]])
        .map_err(|_| MintSoulboundNftErrorCode::AssetCreationError)?;

    // let mut builder = CreateCpiBuilder::new(mpl_token_metadata_program);
    // let builder = builder
    //     .mint(&asset_account_info, false)
    //     .metadata(&metadata_account_info)
    //     .payer(&user_account_info)
    //     .authority(&asset_authority_account_info)
    //     .update_authority(&asset_authority_account_info, true)
    //     .system_program(&system_program_account_info)
    //     .master_edition(Some(&master_edition_account_info))
    //     .spl_token_program(&token_program_account_info)
    //     .system_program(&system_program_account_info)
    //     .sysvar_instructions(&sysvar_instructions_account_onfo)
    //     .create_args(CreateArgs::V1 {
    //         name: String::from("NOMADZ Soulbound"),
    //         symbol: String::from("NOMADZSB"),
    //         uri,
    //         seller_fee_basis_points: 0,
    //         creators: None,
    //         collection: None,
    //         uses: None,
    //         primary_sale_happened: false,
    //         is_mutable: true,
    //         token_standard: mpl_token_metadata::types::TokenStandard::NonFungible,
    //         collection_details: None,
    //         rule_set: None,
    //         decimals: Some(0),
    //         print_supply: Some(PrintSupply::Limited(1)),
    //     });

    // builder
    //     .invoke_signed(asset_authority_seeds)
    //     .map_err(|_| MintSoulboundNftErrorCode::UpdateAssetMetadataError)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(args: MintSoulboundNFTArgs)]
pub struct MintSoulboundNFT<'info> {
    /// CHECK: Validate address by deriving pda
    #[account(
        mut, 
        seeds = [b"soulbound_asset", args.user_id.as_bytes(), nomadz_program.key().as_ref()], 
        bump, 
        seeds::program = nomadz_program.key()
    )]
    pub asset_account: UncheckedAccount<'info>,

    /// CHECK: Validate address by deriving pda
    #[account(
        mut,
        seeds = [b"asset_authority", nomadz_program.key().as_ref(), asset_account.key().as_ref()],
        bump,
        seeds::program = nomadz_program.key()
    )]
    pub asset_authority: UncheckedAccount<'info>,

    /// CHECK: Validate address by deriving pda
    #[account(
        mut,
        seeds = [b"metadata", mpl_token_metadata_program.key().as_ref(), asset_account.key().as_ref()],
        bump,
        seeds::program = mpl_token_metadata_program.key(),
    )]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: Validate address by deriving pda
    #[account(
        mut,
        seeds = [b"metadata", mpl_token_metadata_program.key().as_ref(), asset_account.key().as_ref(), b"edition"],
        bump,
        seeds::program = mpl_token_metadata_program.key(),
    )]
    pub master_edition_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,

    #[account(address = mpl_core::ID)]
    pub mpl_core_program: AccountInfo<'info>,

    #[account(address = mpl_token_metadata::ID)]
    pub mpl_token_metadata_program: Program<'info, Metadata>,

    pub token_program: Program<'info, Token>,

    #[account(address = solana_program::system_program::ID)]
    pub system_program: Program<'info, System>,

    #[account(address = solana_program::sysvar::rent::ID)]
    pub rent: Sysvar<'info, Rent>,

    #[account(address = solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct MintSoulboundNFTArgs {
    uri: String,
    user_id: String,
}
