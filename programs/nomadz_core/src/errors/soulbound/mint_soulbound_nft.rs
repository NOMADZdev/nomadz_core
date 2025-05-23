use anchor_lang::prelude::*;

#[error_code]
pub enum MintSoulboundNftErrorCode {
    #[msg("Failed to mint soulbound NFT due to fee vault account pubkey mismatch")]
    FeeVaultMismatch,
    #[msg("Failed to mint soulbound NFT due to user insufficient balance")]
    InsufficientBalance,
    #[msg("Failed to create asset during minting soulbound NFT")]
    AssetCreationError,
    #[msg("Failed to update asset metadata during minting soulbound NFT")]
    UpdateAssetMetadataError,
    #[msg("Unknown error has occured during minting soulbound NFT")]
    UnknownError,
    #[msg("Unauthorized")]
    Unauthorized,
}
