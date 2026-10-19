use anchor_lang::prelude::*;

use crate::constants::ASSET_VERSION_PROGRAM_DELEGATED;
use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;
use crate::state::soulbound::asset_data::UserAssetData;
use crate::utils::{ burn_with_pda, require_governance, set_permanent_freeze };

pub fn soulbound_burn_handler(ctx: Context<SoulboundBurn>, _args: SoulboundBurnArgs) -> Result<()> {
    require_governance(&ctx.accounts.config, &ctx.accounts.governance.key())?;
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

    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let asset = ctx.accounts.asset.to_account_info();
    let asset_authority = ctx.accounts.asset_authority.to_account_info();
    let payer = ctx.accounts.payer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let asset_authority_bump = ctx.bumps.asset_authority;

    set_permanent_freeze(
        &mpl_core_program,
        &asset,
        &asset_authority,
        &payer,
        &system_program,
        asset_authority_bump,
        false
    )?;

    burn_with_pda(
        &mpl_core_program,
        &asset,
        &asset_authority,
        &payer,
        &system_program,
        asset_authority_bump
    )?;

    ctx.accounts.user_asset_data.asset = Pubkey::default();

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct SoulboundBurnArgs {
    pub user_id: String,
}

#[derive(Accounts)]
#[instruction(args: SoulboundBurnArgs)]
pub struct SoulboundBurn<'info> {
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

    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: address constrained to mpl-core
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
