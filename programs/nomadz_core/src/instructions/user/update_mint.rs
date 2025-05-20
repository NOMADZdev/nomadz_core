use crate::{
    errors::config::InitializeErrorCode,
    state::config::config::Config,
    state::soulbound::asset_data::UserAssetData,
};
use anchor_lang::prelude::*;

pub fn update_user_mint(
    ctx: Context<UpdateUserMint>,
    _: String,
    _: String,
    xp: u64,
    level: u8,
    luck: u8,
    rxp: u64,
    rlevel: u8,
    rluck: u8
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        InitializeErrorCode::Forbidden
    );

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    let referrer_asset = &mut ctx.accounts.referrer_asset;

    user_asset_data.xp = xp;
    user_asset_data.level = level;
    user_asset_data.luck = luck;

    referrer_asset.xp = rxp;
    referrer_asset.level = rlevel;
    referrer_asset.luck = rluck;

    msg!("Updated stats for {}: XP={}, Level={}, Luck={}", user_asset_data.user, xp, level, luck);

    Ok(())
}

#[derive(Accounts)]
#[instruction(user_id: String, referrer_id: String)]
pub struct UpdateUserMint<'info> {
    #[account(mut,
        seeds = [b"user_asset_data", user_id.as_bytes(),  nomadz_program.key().as_ref()],
        bump,
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(mut,
        seeds = [b"user_asset_data", referrer_id.as_bytes(),  nomadz_program.key().as_ref()],
        bump,
    )]
    pub referrer_asset: Account<'info, UserAssetData>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [b"config_v2"], bump)]
    pub config: Account<'info, Config>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,
}
