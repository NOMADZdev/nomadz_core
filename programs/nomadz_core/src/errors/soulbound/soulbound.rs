use anchor_lang::prelude::*;

#[error_code(offset = 7000)]
pub enum SoulboundErrorCode {
    #[msg("Signer is not authorized to perform this soulbound action")]
    Unauthorized,
    #[msg("Governance authority is not set in the config")]
    GovernanceNotSet,
    #[msg("Asset account does not match the user's current Nomad ID")]
    AssetMismatch,
    #[msg("User has no Nomad ID asset")]
    AssetNotSet,
    #[msg("Nomad ID is not program-delegated")]
    NotProgramDelegated,
    #[msg("Current owner signature is required for a legacy Nomad ID")]
    OwnerSignatureRequired,
    #[msg("Current owner does not own the Nomad ID")]
    OwnerMismatch,
    #[msg("Asset account data is not a valid mpl-core asset")]
    InvalidAssetAccount,
    #[msg("Passthrough instruction data is invalid")]
    InvalidPassthroughData,
    #[msg("Passthrough instruction is not allowed")]
    PassthroughInstructionNotAllowed,
    #[msg("Passthrough plugin type is not allowed")]
    PassthroughPluginNotAllowed,
    #[msg("Passthrough authority change is not allowed")]
    PassthroughAuthorityNotAllowed,
    #[msg("Reissue count overflow")]
    ReissueCountOverflow,
    #[msg("New asset account does not match the next reissue address")]
    InvalidReissueAsset,
}
