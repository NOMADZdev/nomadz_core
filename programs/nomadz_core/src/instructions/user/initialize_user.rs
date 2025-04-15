use crate::{
    errors::config::InitializeErrorCode, state::config::config::Config,
    state::soulbound::asset_data::UserAssetData,
};
use anchor_lang::prelude::*;

pub fn initialize_user_asset_data_handler(
    ctx: Context<InitializeUserAssetData>,
    _: String,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        InitializeErrorCode::Forbidden
    );

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    user_asset_data.user = ctx.accounts.user.key();
    user_asset_data.asset = Pubkey::default();
    user_asset_data.referral_history = vec![];
    user_asset_data.created_at = Clock::get()?.unix_timestamp;
    user_asset_data.xp = 100;
    user_asset_data.level = 1;
    user_asset_data.luck = 0;

    msg!(
        "UserAssetData initialized for user: {}",
        user_asset_data.user
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(user_id: String)]
pub struct InitializeUserAssetData<'info> {
    #[account(
        init_if_needed,
        payer = admin,
        space = UserAssetData::MAX_SIZE,
        seeds = [b"user_asset_data", user_id.as_bytes(), nomadz_program.key().as_ref()],
        bump,
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(mut)]
    pub user: SystemAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
