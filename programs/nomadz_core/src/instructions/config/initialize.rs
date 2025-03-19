use crate::state::config::config::Config;
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
    #[account(init, payer = creator, seeds = [b"config"], space = Config::LEN, bump)]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: account constraints checked in account trait
    pub admin: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
