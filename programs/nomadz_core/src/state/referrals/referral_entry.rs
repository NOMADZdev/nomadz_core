use anchor_lang::prelude::*;

#[derive(AnchorSerialize, Debug, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct ReferralEntry {
    pub referrer: Pubkey,
    pub level: u8,
}

impl ReferralEntry {
    pub const MAX_SIZE: usize = 32 + 1;

    pub fn new(referrer: Pubkey, level: u8) -> Self {
        Self { referrer, level }
    }

    pub fn is_level(&self, target_level: u8) -> bool {
        self.level == target_level
    }

    pub fn incremented(&self) -> Self {
        Self {
            referrer: self.referrer,
            level: self.level + 1,
        }
    }
}
