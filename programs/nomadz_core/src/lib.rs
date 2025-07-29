use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("GfyUP9mziko4u381SeLBb4D2ijTH4a9ruzBiA2hQAmwr");

#[program]
pub mod nomadz_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeConfigArgs) -> Result<()> {
        instructions::initialize::initialize_handler(ctx, args)
    }

    pub fn initialize_user_asset_data(
        ctx: Context<InitializeUserAssetData>,
        args: InitializeUserAssetDataArgs
    ) -> Result<()> {
        instructions::initialize_user::initialize_user_asset_data_handler(ctx, args)
    }

    pub fn update_user_asset_data(
        ctx: Context<UpdateUserAssetData>,
        args: UpdateUserAssetDataArgs
    ) -> Result<()> {
        instructions::update_user::update_user_asset_data_handler(ctx, args)
    }

    pub fn update_user_with_referrer(
        ctx: Context<UpdateUserWithReferrer>,
        args: UpdateUserWithReferrerArgs
    ) -> Result<()> {
        instructions::update_user_with_referrer::update_user_with_referrer_handler(ctx, args)
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
