use anchor_lang::prelude::*;

#[error_code]
pub enum UpdateConfigErrorCode {
    #[msg("Invalid admin pubkey was provided. Admin must be the signer")]
    InvalidAdminPubkey,
    #[msg("Unknown error has occured while updating config")]
    UnknownError,
}
