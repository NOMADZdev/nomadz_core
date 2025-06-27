use anchor_lang::prelude::*;

#[error_code]
pub enum UpdateUserAssetDataErrorCode {
    #[msg("The user is forbidden to update the user asset data")]
    Forbidden,
    #[msg("Unknown error has occured during initialization")]
    UnknownError,
}
