use anchor_lang::prelude::*;

#[error_code]
pub enum UpdateUserWithReferrerErrorCode {
    #[msg("The user is forbidden to update the user or referrer asset data")]
    Forbidden,
    #[msg("Unknown error has occured during initialization")]
    UnknownError,
}
