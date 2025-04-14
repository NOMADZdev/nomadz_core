use anchor_lang::prelude::*;

#[error_code]
pub enum ApplyReferralErrorCode {
    #[msg("Unauthoried")]
    Unauthorized,
}
