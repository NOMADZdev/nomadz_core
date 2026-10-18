use anchor_lang::prelude::*;

use crate::constants::ASSET_VERSION_PROGRAM_DELEGATED;
use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;
use crate::state::soulbound::asset_data::UserAssetData;
use crate::utils::{ require_admin, set_permanent_freeze };

pub fn soulbound_set_frozen_handler(
    ctx: Context<SoulboundSetFrozen>,
    args: SoulboundSetFrozenArgs
) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.admin.key())?;
    require_keys_neq!(
        ctx.accounts.user_asset_data.asset,
        Pubkey::default(),
        SoulboundErrorCode::AssetNotSet
    );
    require_eq!(
        ctx.accounts.user_asset_data.asset_version,
        ASSET_VERSION_PROGRAM_DELEGATED,
        SoulboundErrorCode::NotProgramDelegated
    );

    set_permanent_freeze(
        &ctx.accounts.mpl_core_program.to_account_info(),
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.asset_authority.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.bumps.asset_authority,
        args.frozen
    )?;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct SoulboundSetFrozenArgs {
    pub user_id: String,
    pub frozen: bool,
}

#[derive(Accounts)]
#[instruction(args: SoulboundSetFrozenArgs)]
pub struct SoulboundSetFrozen<'info> {
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

    pub admin: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: address constrained to mpl-core
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
