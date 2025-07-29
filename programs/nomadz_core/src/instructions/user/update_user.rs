use crate::{
    errors::UpdateUserAssetDataErrorCode,
    state::{ config::config::Config, soulbound::asset_data::UserAssetData },
};
use anchor_lang::prelude::*;

pub fn update_user_asset_data_handler(
    ctx: Context<UpdateUserAssetData>,
    args: UpdateUserAssetDataArgs
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        UpdateUserAssetDataErrorCode::Forbidden
    );

    let UpdateUserAssetDataArgs { user_id: _, xp, level, luck, update_referral_xp } = args;

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    let previous_xp = user_asset_data.xp;

    if let Some(new_xp) = xp {
        user_asset_data.xp = new_xp;
    }

    if let Some(new_level) = level {
        user_asset_data.level = new_level;
    }

    if let Some(new_luck) = luck {
        user_asset_data.luck = new_luck;
    }

    msg!(
        "Updated user asset data account info for {}: XP={}, Level={}, Luck={}",
        user_asset_data.user,
        user_asset_data.xp,
        user_asset_data.level,
        user_asset_data.luck
    );

    let gained_xp = user_asset_data.xp.saturating_sub(previous_xp);
    msg!("Gained XP: {}", gained_xp);

    let update_referral_xp = update_referral_xp.unwrap_or(true);

    if gained_xp > 0 && update_referral_xp {
        for entry in user_asset_data.referral_history.iter() {
            msg!("Looking for level 1 referrer: {}", entry.referrer);
            let percentage = match entry.level {
                1 => ctx.accounts.config.lvl_percentages[0],
                2 => ctx.accounts.config.lvl_percentages[1],
                _ => 0,
            };

            let reward = (gained_xp * (percentage as u64)) / 100;

            for acc_info in ctx.remaining_accounts.iter() {
                msg!("Fetching for level 1 referrer: {}", acc_info.key());
                let mut referrer_data = UserAssetData::try_deserialize(
                    &mut &acc_info.data.borrow()[..]
                )?;

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

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct UpdateUserAssetDataArgs {
    user_id: String,
    xp: Option<u64>,
    level: Option<u8>,
    luck: Option<u8>,
    update_referral_xp: Option<bool>,
}

#[derive(Accounts)]
#[instruction(args: UpdateUserAssetDataArgs)]
pub struct UpdateUserAssetData<'info> {
    #[account(mut,
        seeds = [b"user_asset_data", args.user_id.as_bytes(),  nomadz_program.key().as_ref()],
        bump,
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,
}
