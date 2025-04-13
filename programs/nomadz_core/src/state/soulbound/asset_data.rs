use anchor_lang::prelude::*;

#[account]
pub struct UserAssetData {
    pub user: Pubkey,
    pub asset: Pubkey,
    pub referred_users: Vec<Pubkey>,
    pub created_at: i64,
}

impl UserAssetData {
    pub const MAX_REFERRED: usize = 10;
    pub const MAX_SIZE: usize = 8 +  // Discriminator
        32 + // user
        32 + // asset
        4 + Self::MAX_REFERRED * 32 + // referred_users Vec<Pubkey>
        8; // created_at
}
