use anchor_lang::prelude::*;

#[error_code]
pub enum InitializeUserAssetDataErrorCode {
    #[msg("The user is forbidden to initialize the user asset data")]
    Forbidden,
    #[msg("Unknown error has occured during initialization")]
    UnknownError,
}
