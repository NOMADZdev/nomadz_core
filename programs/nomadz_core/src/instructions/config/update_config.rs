use crate::{errors::UpdateConfigErrorCode, state::config::config::Config};
use anchor_lang::prelude::*;

pub fn update_config_handler(
    ctx: Context<UpdateConfig>,
    new_admin: Pubkey,
    lvl_percentages: [u8; 2],
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let admin = &ctx.accounts.admin;

    require!(
        admin.key() == config.admin,
        UpdateConfigErrorCode::InvalidAdminPubkey
    );

    config.admin = new_admin;
    config.lvl_percentages = lvl_percentages;

    msg!(
        "The config was updated by admin: {:?}, new_admin: {:?}, new lvl_percentages: {:?}",
        admin.key(),
        config.admin,
        config.lvl_percentages
    );

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,

    /// CHECK: passed explicitly and validated in logic
    pub new_admin: AccountInfo<'info>,
}
