use crate::{
    errors::InitializeUserAssetDataErrorCode,
    state::{ config::config::Config, soulbound::asset_data::UserAssetData },
};
use anchor_lang::prelude::*;

pub fn initialize_user_asset_data_handler(
    ctx: Context<InitializeUserAssetData>,
    args: InitializeUserAssetDataArgs
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        InitializeUserAssetDataErrorCode::Forbidden
    );

    let InitializeUserAssetDataArgs { user_id: _, xp, level, luck } = args;

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    user_asset_data.user = ctx.accounts.user.key();
    user_asset_data.asset = Pubkey::default();
    user_asset_data.referral_history = vec![];
    user_asset_data.created_at = Clock::get()?.unix_timestamp;
    user_asset_data.xp = xp;
    user_asset_data.level = level;
    user_asset_data.luck = luck;

    msg!("UserAssetData initialized for user: {}", user_asset_data.user);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct InitializeUserAssetDataArgs {
    user_id: String,
    xp: u64,
    level: u8,
    luck: u8,
}

#[derive(Accounts)]
#[instruction(args: InitializeUserAssetDataArgs)]
pub struct InitializeUserAssetData<'info> {
    #[account(
        init_if_needed,
        payer = admin,
        space = UserAssetData::LEN,
        seeds = [b"user_asset_data", args.user_id.as_bytes(), nomadz_program.key().as_ref()],
        bump
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(mut)]
    pub user: SystemAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
