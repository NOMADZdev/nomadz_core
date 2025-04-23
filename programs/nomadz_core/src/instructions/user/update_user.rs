use crate::{
    errors::config::InitializeErrorCode, state::config::config::Config,
    state::soulbound::asset_data::UserAssetData,
};
use anchor_lang::prelude::*;

pub fn update_user_stats_handler(
    ctx: Context<UpdateUserStats>,
    _: String,
    xp: u64,
    level: u8,
    luck: u8,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        InitializeErrorCode::Forbidden
    );

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    let previous_xp = user_asset_data.xp;

    user_asset_data.xp = xp;
    user_asset_data.level = level;
    user_asset_data.luck = luck;

    msg!(
        "Updated stats for {}: XP={}, Level={}, Luck={}",
        user_asset_data.user,
        xp,
        level,
        luck
    );

    let gained_xp = xp.saturating_sub(previous_xp);
    msg!("Gained XP: {}", gained_xp);

    if gained_xp > 0 {
        for entry in user_asset_data.referral_history.iter() {
            msg!("Looking for level 1 referrer: {}", entry.referrer);
            let percentage = match entry.level {
                1 => ctx.accounts.config.lvl_percentages[0],
                2 => ctx.accounts.config.lvl_percentages[1],
                _ => 0,
            };

            let reward = gained_xp * percentage as u64 / 100;
            for acc_info in ctx.remaining_accounts.iter() {
                msg!("Fetching for level 1 referrer: {}", acc_info.key());
                let mut referrer_data =
                    UserAssetData::try_deserialize(&mut &acc_info.data.borrow()[..])?;
                if entry.referrer.key() == acc_info.key() {
                    msg!(
                        "Rewarding referrer {} (level {}) with {} XP",
                        referrer_data.user,
                        entry.level,
                        reward
                    );
                    referrer_data.xp += reward;
                    referrer_data.try_serialize(&mut &mut acc_info.data.borrow_mut()[..])?;
                    break;
                }
            }
        }
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(user_id: String)]
pub struct UpdateUserStats<'info> {
    #[account(mut,
        seeds = [b"user_asset_data", user_id.as_bytes(),  nomadz_program.key().as_ref()],
        bump,
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,
}
