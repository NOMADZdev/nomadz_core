use anchor_lang::prelude::*;

#[error_code]
pub enum InitializeConfigErrorCode {
    #[msg("The user is forbidden to initialize the program")]
    Forbidden,
    #[msg("Unknown error has occured during initialization")]
    UnknownError,
}
