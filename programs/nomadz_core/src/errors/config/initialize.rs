use anchor_lang::prelude::*;

#[error_code]
pub enum InitializeErrorCode {
    #[msg("Unknown error has occured during initialization")]
    UnknownError,
}
