use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub lvl_percentages: [u8; 2],
    pub mint_soulbound_fee: u64,
    pub admin: Pubkey,
    pub fee_vault: Pubkey,
    pub governance: Pubkey,
    pub padding: [[u8; 32]; 15],
}

impl Config {
    pub const LEN: usize = 8 + 2 + 8 + 32 + 32 + 32 + 32 * 15;
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    const LEGACY_LEN: usize = 8 + 2 + 8 + 32 + 32 + 512;

    fn legacy_config_data(admin: Pubkey, fee_vault: Pubkey) -> Vec<u8> {
        let mut data: Vec<u8> = Vec::new();
        [30u8, 10u8].serialize(&mut data).unwrap();
        (5_000_000u64).serialize(&mut data).unwrap();
        admin.serialize(&mut data).unwrap();
        fee_vault.serialize(&mut data).unwrap();
        data.extend_from_slice(&[0u8; 512]);
        data
    }

    #[test]
    fn account_size_is_unchanged() {
        assert_eq!(Config::LEN, LEGACY_LEN);
        assert_eq!(Config::LEN, 594);
    }

    #[test]
    fn serialized_config_fills_the_account() {
        let config = Config {
            lvl_percentages: [30, 10],
            mint_soulbound_fee: 1,
            admin: Pubkey::new_unique(),
            fee_vault: Pubkey::new_unique(),
            governance: Pubkey::new_unique(),
            padding: [[0; 32]; 15],
        };

        let mut serialized: Vec<u8> = Vec::new();
        config.serialize(&mut serialized).unwrap();

        assert_eq!(8 + serialized.len(), Config::LEN);
    }

    #[test]
    fn legacy_config_data_reads_governance_as_default() {
        let admin = Pubkey::new_unique();
        let fee_vault = Pubkey::new_unique();
        let legacy_data = legacy_config_data(admin, fee_vault);

        let config = Config::deserialize(&mut &legacy_data[..]).unwrap();

        assert_eq!(config.lvl_percentages, [30, 10]);
        assert_eq!(config.mint_soulbound_fee, 5_000_000);
        assert_eq!(config.admin, admin);
        assert_eq!(config.fee_vault, fee_vault);
        assert_eq!(config.governance, Pubkey::default());
        assert_eq!(config.padding, [[0u8; 32]; 15]);
    }

    #[test]
    fn legacy_config_account_deserializes_with_discriminator() {
        let admin = Pubkey::new_unique();
        let fee_vault = Pubkey::new_unique();
        let mut account_data: Vec<u8> = Config::DISCRIMINATOR.to_vec();
        account_data.extend_from_slice(&legacy_config_data(admin, fee_vault));

        assert_eq!(account_data.len(), Config::LEN);

        let config = Config::try_deserialize(&mut &account_data[..]).unwrap();

        assert_eq!(config.admin, admin);
        assert_eq!(config.fee_vault, fee_vault);
        assert_eq!(config.governance, Pubkey::default());
    }
}
