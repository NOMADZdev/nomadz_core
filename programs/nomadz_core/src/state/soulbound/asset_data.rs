use crate::state::referrals::ReferralEntry;
use anchor_lang::prelude::*;

#[account]
pub struct UserAssetData {
    pub user: Pubkey,
    pub asset: Pubkey,
    pub referral_history: Vec<ReferralEntry>,
    pub created_at: i64,
    pub xp: u64,
    pub level: u8,
    pub luck: u8,
}

impl UserAssetData {
    pub const MAX_REFERRED: usize = 2;
    pub const MAX_SIZE: usize = 8  // discriminator
        + 32                      // user
        + 32                      // asset
        + 4 + Self::MAX_REFERRED * (32 + 1) // referral_history: Vec<ReferralEntry>
        + 8                       // created_at
        + 8                       // xp
        + 1                       // level
        + 1; // luck
}
