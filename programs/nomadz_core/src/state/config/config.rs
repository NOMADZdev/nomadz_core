use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub lvl_percentages: [u8; 2],
}

impl Config {
    pub const LEN: usize = 8 + 32 + 2;
}
