use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("4txebCh2gA8ExzDNLY9njfstKbWvr1T4dJ7dBditQsQk");

#[program]
pub mod nomadz_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeConfigArgs) -> Result<()> {
        instructions::initialize::initialize_handler(ctx, args)
    }

    pub fn initialize_user_asset_data(
        ctx: Context<InitializeUserAssetData>,
        user_id: String,
        xp: u64,
        level: u8,
        luck: u8
    ) -> Result<()> {
        initialize_user_asset_data_handler(ctx, user_id, xp, level, luck)
    }

    pub fn update_user_asset_data(
        ctx: Context<UpdateUserStats>,
        user_id: String,
        xp: u64,
        level: u8,
        luck: u8
    ) -> Result<()> {
        update_user_stats_handler(ctx, user_id, xp, level, luck)
    }

    pub fn update_mint(
        ctx: Context<UpdateUserMint>,
        user_id: String,
        referrer_id: String,
        xp: u64,
        level: u8,
        luck: u8,
        rxp: u64,
        rlevel: u8,
        rluck: u8
    ) -> Result<()> {
        update_user_mint(ctx, user_id, referrer_id, xp, level, luck, rxp, rlevel, rluck)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::config::update_config::update_config_handler(ctx, args)
    }

    pub fn apply_referral(ctx: Context<ApplyReferral>) -> Result<()> {
        instructions::apply_referral::apply_referral_handler(ctx)
    }

    pub fn mint_soulbound_nft(
        ctx: Context<MintSoulboundNFT>,
        data: MintSoulboundNFTArgs
    ) -> Result<()> {
        instructions::soulbound::mint_soulbound_nft::mint_soulbound_nft_handler(ctx, data)
    }

    pub fn update_soulbound_nft(
        ctx: Context<UpdateSoulboundNFT>,
        data: UpdateSoulboundNFTArgs
    ) -> Result<()> {
        instructions::soulbound::update_soulbound_nft::update_soulbound_nft_handler(ctx, data)
    }
}
