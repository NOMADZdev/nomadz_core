use anchor_lang::prelude::*;

#[error_code]
pub enum UpdateConfigErrorCode {
    #[msg("Invalid admin pubkey was provided. Admin must be the signer")]
    InvalidAdminPubkey,
    #[msg("Unknown error has occured while updating config")]
    UnknownError,
    #[msg("Only the governance authority, or the config admin before governance is set, can update config")]
    Unauthorized,
    #[msg("Governance must be a non-default pubkey that differs from the config admin")]
    InvalidGovernance,
}
