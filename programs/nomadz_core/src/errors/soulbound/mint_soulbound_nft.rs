use anchor_lang::prelude::*;

#[error_code]
pub enum MintSoulboundNftErrorCode {
    #[msg("Unknown error has occured during minting soulbound NFT")]
    UnknownError,
}
