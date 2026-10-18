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
    pub asset_version: u8,
    pub reissue_count: u8,
    pub reserved: [u8; 22],
    pub padding: [[u8; 24]; 20],
}

impl UserAssetData {
    pub const MAX_REFERRED: usize = 2;
    pub const LEN: usize =
        8 + 32 + 32 + 4 + Self::MAX_REFERRED * ReferralEntry::LEN + 8 + 8 + 1 + 1 + 8 + 1 + 1 + 22 + 24 * 20;
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    const LEGACY_LEN: usize =
        8 + 32 + 32 + 4 + UserAssetData::MAX_REFERRED * ReferralEntry::LEN + 8 + 8 + 1 + 1 + 512;

    struct LegacyFields {
        user: Pubkey,
        asset: Pubkey,
        referral_history: Vec<ReferralEntry>,
    }

    fn legacy_fields(referrals: usize) -> LegacyFields {
        LegacyFields {
            user: Pubkey::new_unique(),
            asset: Pubkey::new_unique(),
            referral_history: (0..referrals)
                .map(|index| ReferralEntry::new(Pubkey::new_unique(), (index as u8) + 1))
                .collect(),
        }
    }

    fn legacy_account_data(fields: &LegacyFields) -> Vec<u8> {
        let mut data: Vec<u8> = UserAssetData::DISCRIMINATOR.to_vec();
        fields.user.serialize(&mut data).unwrap();
        fields.asset.serialize(&mut data).unwrap();
        fields.referral_history.serialize(&mut data).unwrap();
        (1_700_000_000i64).serialize(&mut data).unwrap();
        (1000u64).serialize(&mut data).unwrap();
        (5u8).serialize(&mut data).unwrap();
        (7u8).serialize(&mut data).unwrap();
        (4200u64).serialize(&mut data).unwrap();
        data.extend_from_slice(&[0u8; 24 * 21]);
        data.resize(UserAssetData::LEN, 0);
        data
    }

    fn assert_legacy_account_decodes(referrals: usize) {
        let fields = legacy_fields(referrals);
        let account_data = legacy_account_data(&fields);

        assert_eq!(account_data.len(), LEGACY_LEN);

        let user_asset_data = UserAssetData::try_deserialize(&mut &account_data[..]).unwrap();

        assert_eq!(user_asset_data.user, fields.user);
        assert_eq!(user_asset_data.asset, fields.asset);
        assert_eq!(user_asset_data.referral_history, fields.referral_history);
        assert_eq!(user_asset_data.created_at, 1_700_000_000);
        assert_eq!(user_asset_data.xp, 1000);
        assert_eq!(user_asset_data.level, 5);
        assert_eq!(user_asset_data.luck, 7);
        assert_eq!(user_asset_data.travel_points, 4200);
        assert_eq!(user_asset_data.asset_version, 0);
        assert_eq!(user_asset_data.reissue_count, 0);
        assert_eq!(user_asset_data.reserved, [0u8; 22]);
        assert_eq!(user_asset_data.padding, [[0u8; 24]; 20]);
    }

    #[test]
    fn account_size_is_unchanged() {
        assert_eq!(UserAssetData::LEN, LEGACY_LEN);
        assert_eq!(UserAssetData::LEN, 1696);
    }

    #[test]
    fn new_fields_fit_into_the_previous_padding() {
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
            asset_version: 1,
            reissue_count: 255,
            reserved: [0; 22],
            padding: [[0; 24]; 20],
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
        assert_eq!(user_asset_data.asset_version, 0);
        assert_eq!(user_asset_data.reissue_count, 0);
    }

    #[test]
    fn legacy_account_without_referrals_reads_new_fields_as_zero() {
        assert_legacy_account_decodes(0);
    }

    #[test]
    fn legacy_account_with_one_referral_reads_new_fields_as_zero() {
        assert_legacy_account_decodes(1);
    }

    #[test]
    fn legacy_account_with_two_referrals_reads_new_fields_as_zero() {
        assert_legacy_account_decodes(2);
    }
}
