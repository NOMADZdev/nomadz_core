use anchor_lang::prelude::Pubkey;

pub fn contains_address(addresses: &[Pubkey], address: &Pubkey) -> bool {
    addresses.contains(address)
}
