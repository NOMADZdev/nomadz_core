use crate::errors::ApplyReferralErrorCode;
use crate::state::config::config::Config;
use crate::state::referrals::ReferralEntry;
use crate::state::soulbound::asset_data::UserAssetData;
use anchor_lang::prelude::*;

pub fn apply_referral_handler(ctx: Context<ApplyReferral>) -> Result<()> {
    let user_asset_data = &mut ctx.accounts.user_asset_data;
    let referrer_asset_data = &ctx.accounts.referrer_asset_data;

    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.config.admin,
        ApplyReferralErrorCode::Unauthorized
    );

    if user_asset_data
        .referral_history
        .iter()
        .any(|entry| entry.referrer == referrer_asset_data.user)
    {
        msg!("User already referred by this account");
        return Ok(());
    }

    let mut updated_referrals: Vec<ReferralEntry> = referrer_asset_data
        .referral_history
        .iter()
        .map(|entry| entry.incremented())
        .collect();

    updated_referrals.push(ReferralEntry::new(referrer_asset_data.user, 1));

    if updated_referrals.len() > UserAssetData::MAX_REFERRED {
        updated_referrals =
            updated_referrals[updated_referrals.len() - UserAssetData::MAX_REFERRED..].to_vec();
    }

    user_asset_data.referral_history = updated_referrals;

    msg!(
        "User {} updated referral history: {:?}",
        user_asset_data.user,
        user_asset_data.referral_history
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ApplyReferral<'info> {
    #[account(mut)]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account()]
    pub referrer_asset_data: Account<'info, UserAssetData>,

    #[account(address = config.admin)]
    pub authority: Signer<'info>,

    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
}
