use crate::{errors::UpdateConfigErrorCode, state::config::config::Config};
use anchor_lang::prelude::*;

pub fn update_config_handler(ctx: Context<UpdateConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let admin = &ctx.accounts.admin;
    let new_admin = &ctx.accounts.new_admin;

    require!(
        admin.key() == config.admin.key(),
        UpdateConfigErrorCode::InvalidAdminPubkey
    );

    config.admin = new_admin.key();

    msg!("The config was updated by admin {:?}", config.admin);

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,

    /// CHECK: account constraints checked in account trait
    pub new_admin: AccountInfo<'info>,
}
