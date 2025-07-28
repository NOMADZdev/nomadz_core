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
    pub padding: [u8; 512],
}

impl UserAssetData {
    pub const MAX_REFERRED: usize = 2;
    pub const LEN: usize =
        8 + 32 + 32 + 4 + Self::MAX_REFERRED * ReferralEntry::LEN + 8 + 8 + 1 + 1 + 512;
}
