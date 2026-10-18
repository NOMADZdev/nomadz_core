use anchor_lang::prelude::*;

#[error_code]
pub enum UpdateSoulboundNftErrorCode {
    #[msg("Failed to update soulbound NFT")]
    UpdateAssetError,
    #[msg("Unknown error has occured during updating soulbound NFT")]
    UnknownError,
    #[msg("Only the config admin can update a soulbound NFT")]
    Unauthorized,
}
