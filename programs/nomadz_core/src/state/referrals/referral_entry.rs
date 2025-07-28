use anchor_lang::prelude::*;

#[derive(AnchorSerialize, Debug, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct ReferralEntry {
    pub referrer: Pubkey,
    pub level: u8,
    pub padding: [u8; 512],
}

impl ReferralEntry {
    pub const LEN: usize = 32 + 1 + 512;

    pub fn new(referrer: Pubkey, level: u8) -> Self {
        Self { referrer, level, padding: [0; 512] }
    }

    pub fn is_level(&self, target_level: u8) -> bool {
        self.level == target_level
    }

    pub fn incremented(&self) -> Self {
        Self {
            referrer: self.referrer,
            level: self.level + 1,
            padding: [0; 512],
        }
    }
}
