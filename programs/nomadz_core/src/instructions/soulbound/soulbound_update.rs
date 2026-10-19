use anchor_lang::prelude::*;
use mpl_core::instructions::UpdateV2CpiBuilder;

use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;
use crate::state::soulbound::asset_data::UserAssetData;
use crate::utils::require_admin;

pub fn soulbound_update_handler(
    ctx: Context<SoulboundUpdate>,
    args: SoulboundUpdateArgs
) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.admin.key())?;
    require_keys_neq!(
        ctx.accounts.user_asset_data.asset,
        Pubkey::default(),
        SoulboundErrorCode::AssetNotSet
    );

    let SoulboundUpdateArgs { new_name, new_uri, .. } = args;

    let asset_info = ctx.accounts.asset.to_account_info();
    let asset_authority_info = ctx.accounts.asset_authority.to_account_info();
    let admin_info = ctx.accounts.admin.to_account_info();
    let mpl_core_program_info = ctx.accounts.mpl_core_program.to_account_info();
    let system_program_info = ctx.accounts.system_program.to_account_info();

    let asset_key = asset_info.key();
    let asset_authority_seeds: &[&[u8]] = &[
        b"asset_authority",
        crate::ID.as_ref(),
        asset_key.as_ref(),
        &[ctx.bumps.asset_authority],
    ];

    let mut builder = UpdateV2CpiBuilder::new(&mpl_core_program_info);
    builder
        .asset(&asset_info)
        .authority(Some(&asset_authority_info))
        .payer(&admin_info)
        .system_program(&system_program_info);

    if let Some(name) = new_name {
        builder.new_name(name);
    }

    if let Some(uri) = new_uri {
        builder.new_uri(uri);
    }

    builder.invoke_signed(&[asset_authority_seeds])?;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct SoulboundUpdateArgs {
    pub user_id: String,
    pub new_name: Option<String>,
    pub new_uri: Option<String>,
}

#[derive(Accounts)]
#[instruction(args: SoulboundUpdateArgs)]
pub struct SoulboundUpdate<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"user_asset_data", args.user_id.as_bytes(), crate::ID.as_ref()],
        bump
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    /// CHECK: must equal user_asset_data.asset, validated by mpl-core
    #[account(
        mut,
        constraint = asset.key() == user_asset_data.asset @ SoulboundErrorCode::AssetMismatch
    )]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: PDA derived
    #[account(seeds = [b"asset_authority", crate::ID.as_ref(), asset.key().as_ref()], bump)]
    pub asset_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: address constrained to mpl-core
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
