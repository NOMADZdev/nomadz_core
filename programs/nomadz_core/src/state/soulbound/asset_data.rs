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
    pub travel_points: u64,
    pub padding: [[u8; 24]; 21],
}

impl UserAssetData {
    pub const MAX_REFERRED: usize = 2;
    pub const LEN: usize =
        8 + 32 + 32 + 4 + Self::MAX_REFERRED * ReferralEntry::LEN + 8 + 8 + 1 + 1 + 8 + 24 * 21;
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_LEN: usize =
        8 + 32 + 32 + 4 + UserAssetData::MAX_REFERRED * ReferralEntry::LEN + 8 + 8 + 1 + 1 + 512;

    #[test]
    fn account_size_is_unchanged() {
        assert_eq!(UserAssetData::LEN, LEGACY_LEN);
        assert_eq!(UserAssetData::LEN, 1696);
    }

    #[test]
    fn travel_points_fits_into_the_previous_padding() {
        let user_asset_data = UserAssetData {
            user: Pubkey::default(),
            asset: Pubkey::default(),
            referral_history: vec![
                ReferralEntry::new(Pubkey::default(), 1),
                ReferralEntry::new(Pubkey::default(), 2)
            ],
            created_at: 0,
            xp: 0,
            level: 0,
            luck: 0,
            travel_points: 0,
            padding: [[0; 24]; 21],
        };

        let mut serialized: Vec<u8> = Vec::new();
        user_asset_data.serialize(&mut serialized).unwrap();

        assert_eq!(8 + serialized.len(), UserAssetData::LEN);
    }

    #[test]
    fn legacy_account_data_reads_travel_points_as_zero() {
        let mut legacy_data: Vec<u8> = Vec::new();
        Pubkey::default().serialize(&mut legacy_data).unwrap();
        Pubkey::default().serialize(&mut legacy_data).unwrap();
        Vec::<ReferralEntry>::new().serialize(&mut legacy_data).unwrap();
        (0i64).serialize(&mut legacy_data).unwrap();
        (1000u64).serialize(&mut legacy_data).unwrap();
        (5u8).serialize(&mut legacy_data).unwrap();
        (7u8).serialize(&mut legacy_data).unwrap();
        legacy_data.extend_from_slice(&[0u8; 512]);

        let user_asset_data = UserAssetData::deserialize(&mut &legacy_data[..]).unwrap();

        assert_eq!(user_asset_data.xp, 1000);
        assert_eq!(user_asset_data.level, 5);
        assert_eq!(user_asset_data.luck, 7);
        assert_eq!(user_asset_data.travel_points, 0);
    }
}
