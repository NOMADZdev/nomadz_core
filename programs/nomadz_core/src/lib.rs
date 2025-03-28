use anchor_lang::prelude::*;
// use anchor_spl:

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("818jhPG7nGagquKwx1cfpiX3M68TxnGwgw2KP3rE3Rd8");

#[program]
pub mod nomadz_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::config::initialize::initialize_handler(ctx)
    }

    pub fn update_config(ctx: Context<UpdateConfig>) -> Result<()> {
        instructions::config::update_config::update_config_handler(ctx)
    }

    pub fn mint_soulbound_nft(
        ctx: Context<MintSoulboundNFT>,
        data: MintSoulboundNFTArgs,
    ) -> Result<()> {
        instructions::soulbound::mint_soulbound_nft::mint_soulbound_nft_handler(ctx, data)
    }
}
