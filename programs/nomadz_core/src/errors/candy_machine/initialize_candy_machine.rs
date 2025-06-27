use anchor_lang::prelude::*;

#[error_code]
pub enum InitializeCandyMachineErrorCode {
    #[msg("The user is forbidden to initialize the candy machine")]
    Forbidden,
    #[msg("Unknown error has occured during initialization")]
    UnknownError,
}
