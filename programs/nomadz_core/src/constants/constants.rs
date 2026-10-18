use anchor_lang::prelude::Pubkey;

pub const ALLOWED_INITIALIZE_PROGRAM_AUTHORITIES: [Pubkey; 1] = [
    Pubkey::new_from_array([
        174, 97, 150, 139, 136, 66, 147, 20, 214, 207, 91, 3, 116, 19, 43, 72, 200, 154, 168, 9,
        210, 28, 105, 133, 216, 36, 169, 30, 13, 95, 72, 103,
    ]),
];

pub const ASSET_VERSION_LEGACY: u8 = 0;
pub const ASSET_VERSION_PROGRAM_DELEGATED: u8 = 1;

pub const NOMAD_ID_NAME: &str = "Nomad ID";

pub const REVOKED_STATUS_KEY: &str = "status";
pub const REVOKED_STATUS_VALUE: &str = "revoked";
pub const REPLACED_BY_KEY: &str = "replaced_by";
