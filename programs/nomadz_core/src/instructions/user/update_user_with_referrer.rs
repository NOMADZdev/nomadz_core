use crate::{
    errors::UpdateUserWithReferrerErrorCode,
    state::config::config::Config,
    state::soulbound::asset_data::UserAssetData,
};
use anchor_lang::prelude::*;

pub fn update_user_with_referrer_handler(
    ctx: Context<UpdateUserWithReferrer>,
    args: UpdateUserWithReferrerArgs
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        UpdateUserWithReferrerErrorCode::Forbidden
    );

    let UpdateUserWithReferrerArgs {
        user_id: _,
        referrer_id: _,
        user_xp,
        user_level,
        user_luck,
        referrer_xp,
        referrer_level,
        referrer_luck,
    } = args;

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    let referrer_asset_data = &mut ctx.accounts.referrer_asset_data;

    if let Some(new_user_xp) = user_xp {
        user_asset_data.xp = new_user_xp;
    }

    if let Some(new_user_level) = user_level {
        user_asset_data.level = new_user_level;
    }

    if let Some(new_user_luck) = user_luck {
        user_asset_data.luck = new_user_luck;
    }

    if let Some(new_referrer_xp) = referrer_xp {
        referrer_asset_data.xp = new_referrer_xp;
    }

    if let Some(new_referrer_level) = referrer_level {
        referrer_asset_data.level = new_referrer_level;
    }

    if let Some(new_referrer_luck) = referrer_luck {
        referrer_asset_data.luck = new_referrer_luck;
    }

    msg!(
        "Updated user asset data account info for {}: XP={}, Level={}, Luck={}",
        user_asset_data.user,
        user_asset_data.xp,
        user_asset_data.level,
        user_asset_data.luck
    );

    msg!(
        "Updated referrer asset data account info for {}: XP={}, Level={}, Luck={}",
        referrer_asset_data.user,
        referrer_asset_data.xp,
        referrer_asset_data.level,
        referrer_asset_data.luck
    );

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct UpdateUserWithReferrerArgs {
    user_id: String,
    referrer_id: String,
    user_xp: Option<u64>,
    user_level: Option<u8>,
    user_luck: Option<u8>,
    referrer_xp: Option<u64>,
    referrer_level: Option<u8>,
    referrer_luck: Option<u8>,
}

#[derive(Accounts)]
#[instruction(args: UpdateUserWithReferrerArgs)]
pub struct UpdateUserWithReferrer<'info> {
    #[account(mut,
        seeds = [b"user_asset_data", args.user_id.as_bytes(), nomadz_program.key().as_ref()],
        bump,
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(mut,
        seeds = [b"user_asset_data", args.referrer_id.as_bytes(), nomadz_program.key().as_ref()],
        bump,
    )]
    pub referrer_asset_data: Account<'info, UserAssetData>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,
}
