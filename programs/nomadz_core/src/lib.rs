use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod constants;
pub mod utils;

use instructions::*;

declare_id!("8yWrExW5JBiiLC9HweTqudzvo4fRDMc4FCNSKChz6tGd");

#[program]
pub mod nomadz_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::config::initialize::initialize_handler(ctx)
    }

    pub fn update_config(ctx: Context<UpdateConfig>) -> Result<()> {
        instructions::config::update_config::update_config_handler(ctx)
    }
}
