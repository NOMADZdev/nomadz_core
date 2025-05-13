use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub lvl_percentages: [u8; 2],
    pub mint_soulbound_fee: u64,
    pub admin: Pubkey,
    pub fee_vault: Pubkey,
}

impl Config {
    pub const LEN: usize = 8 + 2 + 8 + 32 + 32;
}
