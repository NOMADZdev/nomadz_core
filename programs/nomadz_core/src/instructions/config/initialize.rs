use crate::{constants::*, errors::InitializeErrorCode, state::config::config::Config, utils::*};
use anchor_lang::prelude::*;

pub fn initialize_handler(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let admin = &ctx.accounts.admin;

    config.admin = admin.key();

    msg!("Config initialized with admin: {:?}", config.admin);

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = initializer, seeds = [b"config"], space = Config::LEN, bump)]
    pub config: Account<'info, Config>,

    #[account(mut, constraint = contains_address(&ALLOWED_INITIALIZE_PROGRAM_AUTHORITIES, &initializer.key()) @ InitializeErrorCode::Forbidden)]
    pub initializer: Signer<'info>,

    /// CHECK: account constraints checked in account trait
    pub admin: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
