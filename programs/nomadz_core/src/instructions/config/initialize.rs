use crate::{ state::config::config::Config };
use anchor_lang::prelude::*;

pub fn initialize_handler(ctx: Context<Initialize>, args: InitializeConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let admin = &ctx.accounts.admin;
    let fee_vault = &ctx.accounts.fee_vault;

    let InitializeConfigArgs { mint_soulbound_fee, lvl_percentages } = args;

    config.admin = admin.key();
    config.fee_vault = fee_vault.key();
    config.lvl_percentages = lvl_percentages;
    config.mint_soulbound_fee = mint_soulbound_fee;

    msg!(
        "Config initialized with admin: {:?}, fee_vault: {:?}, mint_soulbound_fee: {:?}, lvl_percentages: {:?}",
        config.admin,
        config.fee_vault,
        config.mint_soulbound_fee,
        config.lvl_percentages
    );

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct InitializeConfigArgs {
    lvl_percentages: [u8; 2],
    mint_soulbound_fee: u64,
}

#[derive(Accounts)]
#[instruction(args: InitializeConfigArgs)]
pub struct Initialize<'info> {
    #[account(init, payer = initializer, seeds = [b"config"], space = Config::LEN, bump)]
    pub config: Account<'info, Config>,

    // #[account(mut, constraint = contains_address(&ALLOWED_INITIALIZE_PROGRAM_AUTHORITIES, &initializer.key()) @ InitializeErrorCode::Forbidden)]
    #[account(mut)]
    pub initializer: Signer<'info>,

    /// CHECK: account constraints checked in account trait
    pub admin: AccountInfo<'info>,

    /// CHECK: account constraints checked in account trait
    pub fee_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
