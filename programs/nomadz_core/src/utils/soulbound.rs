use anchor_lang::prelude::*;
use anchor_lang::solana_program::borsh0_10::{ get_instance_packed_len, try_from_slice_unchecked };
use mpl_core::instructions::{
    AddPluginV1InstructionArgs,
    BurnV1CpiBuilder,
    RemovePluginV1InstructionArgs,
    TransferV1CpiBuilder,
    UpdatePluginV1CpiBuilder,
    UpdatePluginV1InstructionArgs,
    UpdateV1InstructionArgs,
};
use mpl_core::types::{
    PermanentBurnDelegate,
    PermanentFreezeDelegate,
    PermanentTransferDelegate,
    Plugin,
    PluginAuthority,
    PluginAuthorityPair,
    PluginType,
};

use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;

pub const PASSTHROUGH_ADD_PLUGIN_V1: u8 = 2;
pub const PASSTHROUGH_REMOVE_PLUGIN_V1: u8 = 4;
pub const PASSTHROUGH_UPDATE_PLUGIN_V1: u8 = 6;
pub const PASSTHROUGH_UPDATE_V1: u8 = 15;

pub const ALLOWED_PLUGIN_TYPES: [PluginType; 4] = [
    PluginType::Attributes,
    PluginType::Royalties,
    PluginType::VerifiedCreators,
    PluginType::Autograph,
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PassthroughOp {
    AddPlugin(AddPluginV1InstructionArgs),
    UpdatePlugin(UpdatePluginV1InstructionArgs),
    RemovePlugin(RemovePluginV1InstructionArgs),
    Update(UpdateV1InstructionArgs),
}

pub fn require_admin(config: &Config, signer: &Pubkey) -> Result<()> {
    require_keys_eq!(*signer, config.admin, SoulboundErrorCode::Unauthorized);
    Ok(())
}

pub fn require_governance(config: &Config, signer: &Pubkey) -> Result<()> {
    require_keys_neq!(config.governance, Pubkey::default(), SoulboundErrorCode::GovernanceNotSet);
    require_keys_eq!(*signer, config.governance, SoulboundErrorCode::Unauthorized);
    Ok(())
}

pub fn nomad_id_plugins(authority: Pubkey) -> Vec<PluginAuthorityPair> {
    vec![
        PluginAuthorityPair {
            plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
            authority: Some(PluginAuthority::Address { address: authority }),
        },
        PluginAuthorityPair {
            plugin: Plugin::PermanentTransferDelegate(PermanentTransferDelegate {}),
            authority: Some(PluginAuthority::Address { address: authority }),
        },
        PluginAuthorityPair {
            plugin: Plugin::PermanentBurnDelegate(PermanentBurnDelegate {}),
            authority: Some(PluginAuthority::Address { address: authority }),
        }
    ]
}

pub fn set_permanent_freeze<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    asset_authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    asset_authority_bump: u8,
    frozen: bool
) -> Result<()> {
    let asset_key = asset.key();
    let asset_authority_seeds: &[&[u8]] = &[
        b"asset_authority",
        crate::ID.as_ref(),
        asset_key.as_ref(),
        &[asset_authority_bump],
    ];

    UpdatePluginV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(asset_authority))
        .system_program(system_program)
        .plugin(Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen }))
        .invoke_signed(&[asset_authority_seeds])?;

    Ok(())
}

pub fn transfer_with_pda<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    asset_authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    asset_authority_bump: u8
) -> Result<()> {
    let asset_key = asset.key();
    let asset_authority_seeds: &[&[u8]] = &[
        b"asset_authority",
        crate::ID.as_ref(),
        asset_key.as_ref(),
        &[asset_authority_bump],
    ];

    TransferV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(asset_authority))
        .new_owner(new_owner)
        .system_program(Some(system_program))
        .invoke_signed(&[asset_authority_seeds])?;

    Ok(())
}

pub fn burn_with_pda<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    asset_authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    asset_authority_bump: u8
) -> Result<()> {
    let asset_key = asset.key();
    let asset_authority_seeds: &[&[u8]] = &[
        b"asset_authority",
        crate::ID.as_ref(),
        asset_key.as_ref(),
        &[asset_authority_bump],
    ];

    BurnV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(asset_authority))
        .system_program(Some(system_program))
        .invoke_signed(&[asset_authority_seeds])?;

    Ok(())
}

pub fn plugin_type_of(plugin: &Plugin) -> PluginType {
    match plugin {
        Plugin::Royalties(_) => PluginType::Royalties,
        Plugin::FreezeDelegate(_) => PluginType::FreezeDelegate,
        Plugin::BurnDelegate(_) => PluginType::BurnDelegate,
        Plugin::TransferDelegate(_) => PluginType::TransferDelegate,
        Plugin::UpdateDelegate(_) => PluginType::UpdateDelegate,
        Plugin::PermanentFreezeDelegate(_) => PluginType::PermanentFreezeDelegate,
        Plugin::Attributes(_) => PluginType::Attributes,
        Plugin::PermanentTransferDelegate(_) => PluginType::PermanentTransferDelegate,
        Plugin::PermanentBurnDelegate(_) => PluginType::PermanentBurnDelegate,
        Plugin::Edition(_) => PluginType::Edition,
        Plugin::MasterEdition(_) => PluginType::MasterEdition,
        Plugin::AddBlocker(_) => PluginType::AddBlocker,
        Plugin::ImmutableMetadata(_) => PluginType::ImmutableMetadata,
        Plugin::VerifiedCreators(_) => PluginType::VerifiedCreators,
        Plugin::Autograph(_) => PluginType::Autograph,
    }
}

fn require_allowed_plugin_type(plugin_type: &PluginType) -> Result<()> {
    require!(
        ALLOWED_PLUGIN_TYPES.contains(plugin_type),
        SoulboundErrorCode::PassthroughPluginNotAllowed
    );
    Ok(())
}

fn invalid_passthrough_data<E>(_: E) -> Error {
    error!(SoulboundErrorCode::InvalidPassthroughData)
}

fn require_fully_consumed(
    packed_len: std::result::Result<usize, std::io::Error>,
    data_len: usize
) -> Result<()> {
    let packed_len = packed_len.map_err(invalid_passthrough_data)?;
    require_eq!(packed_len, data_len, SoulboundErrorCode::InvalidPassthroughData);
    Ok(())
}

pub fn parse_passthrough(data: &[u8]) -> Result<PassthroughOp> {
    let (discriminator, rest) = data
        .split_first()
        .ok_or_else(|| error!(SoulboundErrorCode::InvalidPassthroughData))?;

    match *discriminator {
        PASSTHROUGH_ADD_PLUGIN_V1 => {
            let args: AddPluginV1InstructionArgs = try_from_slice_unchecked(rest).map_err(
                invalid_passthrough_data
            )?;
            require_fully_consumed(get_instance_packed_len(&args), rest.len())?;
            require_allowed_plugin_type(&plugin_type_of(&args.plugin))?;
            require!(
                matches!(args.init_authority, None | Some(PluginAuthority::UpdateAuthority)),
                SoulboundErrorCode::PassthroughAuthorityNotAllowed
            );
            Ok(PassthroughOp::AddPlugin(args))
        }
        PASSTHROUGH_UPDATE_PLUGIN_V1 => {
            let args: UpdatePluginV1InstructionArgs = try_from_slice_unchecked(rest).map_err(
                invalid_passthrough_data
            )?;
            require_fully_consumed(get_instance_packed_len(&args), rest.len())?;
            require_allowed_plugin_type(&plugin_type_of(&args.plugin))?;
            Ok(PassthroughOp::UpdatePlugin(args))
        }
        PASSTHROUGH_REMOVE_PLUGIN_V1 => {
            let args: RemovePluginV1InstructionArgs = try_from_slice_unchecked(rest).map_err(
                invalid_passthrough_data
            )?;
            require_fully_consumed(get_instance_packed_len(&args), rest.len())?;
            require_allowed_plugin_type(&args.plugin_type)?;
            Ok(PassthroughOp::RemovePlugin(args))
        }
        PASSTHROUGH_UPDATE_V1 => {
            let args: UpdateV1InstructionArgs = try_from_slice_unchecked(rest).map_err(
                invalid_passthrough_data
            )?;
            require_fully_consumed(get_instance_packed_len(&args), rest.len())?;
            require!(
                args.new_update_authority.is_none(),
                SoulboundErrorCode::PassthroughAuthorityNotAllowed
            );
            Ok(PassthroughOp::Update(args))
        }
        _ => err!(SoulboundErrorCode::PassthroughInstructionNotAllowed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mpl_core::instructions::{ AddPluginV1, RemovePluginV1, UpdatePluginV1, UpdateV1 };
    use mpl_core::types::{
        AddBlocker,
        Attribute,
        Attributes,
        Autograph,
        BurnDelegate,
        Creator,
        FreezeDelegate,
        ImmutableMetadata,
        Royalties,
        RuleSet,
        TransferDelegate,
        UpdateAuthority,
        UpdateDelegate,
        VerifiedCreators,
    };

    fn error_code_of(result: Result<PassthroughOp>) -> u32 {
        match result.unwrap_err() {
            Error::AnchorError(error) => error.error_code_number,
            Error::ProgramError(error) => panic!("unexpected program error: {:?}", error),
        }
    }

    fn code(error: SoulboundErrorCode) -> u32 {
        error.into()
    }

    fn add_plugin_data(args: AddPluginV1InstructionArgs) -> Vec<u8> {
        AddPluginV1 {
            asset: Pubkey::new_unique(),
            collection: None,
            payer: Pubkey::new_unique(),
            authority: None,
            system_program: Pubkey::default(),
            log_wrapper: None,
        }
            .instruction(args).data
    }

    fn update_plugin_data(args: UpdatePluginV1InstructionArgs) -> Vec<u8> {
        UpdatePluginV1 {
            asset: Pubkey::new_unique(),
            collection: None,
            payer: Pubkey::new_unique(),
            authority: None,
            system_program: Pubkey::default(),
            log_wrapper: None,
        }
            .instruction(args).data
    }

    fn remove_plugin_data(args: RemovePluginV1InstructionArgs) -> Vec<u8> {
        RemovePluginV1 {
            asset: Pubkey::new_unique(),
            collection: None,
            payer: Pubkey::new_unique(),
            authority: None,
            system_program: Pubkey::default(),
            log_wrapper: None,
        }
            .instruction(args).data
    }

    fn update_data(args: UpdateV1InstructionArgs) -> Vec<u8> {
        UpdateV1 {
            asset: Pubkey::new_unique(),
            collection: None,
            payer: Pubkey::new_unique(),
            authority: None,
            system_program: Pubkey::default(),
            log_wrapper: None,
        }
            .instruction(args).data
    }

    fn attributes() -> Plugin {
        Plugin::Attributes(Attributes {
            attribute_list: vec![Attribute {
                key: String::from("status"),
                value: String::from("active"),
            }],
        })
    }

    fn allowed_plugins() -> Vec<Plugin> {
        vec![
            attributes(),
            Plugin::Royalties(Royalties {
                basis_points: 500,
                creators: vec![Creator { address: Pubkey::new_unique(), percentage: 100 }],
                rule_set: RuleSet::None,
            }),
            Plugin::VerifiedCreators(VerifiedCreators { signatures: vec![] }),
            Plugin::Autograph(Autograph { signatures: vec![] })
        ]
    }

    fn rejected_plugins() -> Vec<Plugin> {
        vec![
            Plugin::FreezeDelegate(FreezeDelegate { frozen: false }),
            Plugin::BurnDelegate(BurnDelegate {}),
            Plugin::TransferDelegate(TransferDelegate {}),
            Plugin::UpdateDelegate(UpdateDelegate { additional_delegates: vec![] }),
            Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: false }),
            Plugin::PermanentTransferDelegate(PermanentTransferDelegate {}),
            Plugin::PermanentBurnDelegate(PermanentBurnDelegate {}),
            Plugin::AddBlocker(AddBlocker {}),
            Plugin::ImmutableMetadata(ImmutableMetadata {})
        ]
    }

    fn rejected_plugin_types() -> Vec<PluginType> {
        vec![
            PluginType::FreezeDelegate,
            PluginType::BurnDelegate,
            PluginType::TransferDelegate,
            PluginType::UpdateDelegate,
            PluginType::PermanentFreezeDelegate,
            PluginType::PermanentTransferDelegate,
            PluginType::PermanentBurnDelegate,
            PluginType::Edition,
            PluginType::MasterEdition,
            PluginType::AddBlocker,
            PluginType::ImmutableMetadata
        ]
    }

    #[test]
    fn admin_check_accepts_only_the_config_admin() {
        let admin = Pubkey::new_unique();
        let config = Config {
            lvl_percentages: [0, 0],
            mint_soulbound_fee: 0,
            admin,
            fee_vault: Pubkey::new_unique(),
            governance: Pubkey::new_unique(),
            padding: [[0; 32]; 15],
        };

        assert!(require_admin(&config, &admin).is_ok());
        assert!(require_admin(&config, &config.governance).is_err());
        assert!(require_admin(&config, &Pubkey::new_unique()).is_err());
    }

    #[test]
    fn governance_check_fails_closed_while_governance_is_unset() {
        let admin = Pubkey::new_unique();
        let mut config = Config {
            lvl_percentages: [0, 0],
            mint_soulbound_fee: 0,
            admin,
            fee_vault: Pubkey::new_unique(),
            governance: Pubkey::default(),
            padding: [[0; 32]; 15],
        };

        let unset = require_governance(&config, &admin).unwrap_err();
        assert_eq!(unset, error!(SoulboundErrorCode::GovernanceNotSet));
        assert!(require_governance(&config, &Pubkey::default()).is_err());

        let governance = Pubkey::new_unique();
        config.governance = governance;

        assert!(require_governance(&config, &governance).is_ok());
        assert_eq!(
            require_governance(&config, &admin).unwrap_err(),
            error!(SoulboundErrorCode::Unauthorized)
        );
    }

    #[test]
    fn nomad_id_plugins_are_the_three_permanent_delegates_held_by_the_authority() {
        let authority = Pubkey::new_unique();
        let plugins = nomad_id_plugins(authority);

        assert_eq!(plugins.len(), 3);
        assert_eq!(
            plugins
                .iter()
                .map(|pair| plugin_type_of(&pair.plugin))
                .collect::<Vec<_>>(),
            vec![
                PluginType::PermanentFreezeDelegate,
                PluginType::PermanentTransferDelegate,
                PluginType::PermanentBurnDelegate
            ]
        );
        assert_eq!(
            plugins[0].plugin,
            Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true })
        );
        for pair in plugins.iter() {
            assert_eq!(pair.authority, Some(PluginAuthority::Address { address: authority }));
        }
    }

    #[test]
    fn add_plugin_accepts_allowed_plugin_types() {
        for plugin in allowed_plugins() {
            for init_authority in [None, Some(PluginAuthority::UpdateAuthority)] {
                let args = AddPluginV1InstructionArgs { plugin: plugin.clone(), init_authority };
                let parsed = parse_passthrough(&add_plugin_data(args.clone())).unwrap();
                assert_eq!(parsed, PassthroughOp::AddPlugin(args));
            }
        }
    }

    #[test]
    fn add_plugin_rejects_delegate_and_blocking_plugin_types() {
        for plugin in rejected_plugins() {
            let args = AddPluginV1InstructionArgs { plugin, init_authority: None };
            assert_eq!(
                error_code_of(parse_passthrough(&add_plugin_data(args.clone()))),
                code(SoulboundErrorCode::PassthroughPluginNotAllowed)
            );
        }
    }

    #[test]
    fn add_plugin_rejects_foreign_init_authorities() {
        for init_authority in [
            PluginAuthority::None,
            PluginAuthority::Owner,
            PluginAuthority::Address { address: Pubkey::new_unique() },
        ] {
            let args = AddPluginV1InstructionArgs {
                plugin: attributes(),
                init_authority: Some(init_authority),
            };
            assert_eq!(
                error_code_of(parse_passthrough(&add_plugin_data(args.clone()))),
                code(SoulboundErrorCode::PassthroughAuthorityNotAllowed)
            );
        }
    }

    #[test]
    fn update_plugin_accepts_allowed_plugin_types() {
        for plugin in allowed_plugins() {
            let args = UpdatePluginV1InstructionArgs { plugin };
            let parsed = parse_passthrough(&update_plugin_data(args.clone())).unwrap();
            assert_eq!(parsed, PassthroughOp::UpdatePlugin(args));
        }
    }

    #[test]
    fn update_plugin_rejects_delegate_and_blocking_plugin_types() {
        for plugin in rejected_plugins() {
            let args = UpdatePluginV1InstructionArgs { plugin };
            assert_eq!(
                error_code_of(parse_passthrough(&update_plugin_data(args.clone()))),
                code(SoulboundErrorCode::PassthroughPluginNotAllowed)
            );
        }
    }

    #[test]
    fn remove_plugin_accepts_allowed_plugin_types() {
        for plugin_type in ALLOWED_PLUGIN_TYPES {
            let args = RemovePluginV1InstructionArgs { plugin_type };
            let parsed = parse_passthrough(&remove_plugin_data(args.clone())).unwrap();
            assert_eq!(parsed, PassthroughOp::RemovePlugin(args));
        }
    }

    #[test]
    fn remove_plugin_rejects_delegate_and_blocking_plugin_types() {
        for plugin_type in rejected_plugin_types() {
            let args = RemovePluginV1InstructionArgs { plugin_type };
            assert_eq!(
                error_code_of(parse_passthrough(&remove_plugin_data(args.clone()))),
                code(SoulboundErrorCode::PassthroughPluginNotAllowed)
            );
        }
    }

    #[test]
    fn update_accepts_name_and_uri_changes() {
        let args = UpdateV1InstructionArgs {
            new_name: Some(String::from("Nomad ID")),
            new_uri: Some(String::from("https://example.com/nomad-id.json")),
            new_update_authority: None,
        };
        let parsed = parse_passthrough(&update_data(args.clone())).unwrap();
        assert_eq!(parsed, PassthroughOp::Update(args));
    }

    #[test]
    fn update_rejects_update_authority_changes() {
        for new_update_authority in [
            UpdateAuthority::None,
            UpdateAuthority::Address(Pubkey::new_unique()),
            UpdateAuthority::Collection(Pubkey::new_unique()),
        ] {
            let args = UpdateV1InstructionArgs {
                new_name: None,
                new_uri: None,
                new_update_authority: Some(new_update_authority),
            };
            assert_eq!(
                error_code_of(parse_passthrough(&update_data(args.clone()))),
                code(SoulboundErrorCode::PassthroughAuthorityNotAllowed)
            );
        }
    }

    #[test]
    fn rejects_instructions_outside_the_allowlist() {
        for discriminator in [0u8, 1, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 30, 31, 255] {
            assert_eq!(
                error_code_of(parse_passthrough(&[discriminator, 0, 0, 0, 0])),
                code(SoulboundErrorCode::PassthroughInstructionNotAllowed)
            );
        }
    }

    #[test]
    fn rejects_empty_data() {
        assert_eq!(
            error_code_of(parse_passthrough(&[])),
            code(SoulboundErrorCode::InvalidPassthroughData)
        );
    }

    #[test]
    fn rejects_truncated_data() {
        let args = AddPluginV1InstructionArgs { plugin: attributes(), init_authority: None };
        let mut data = add_plugin_data(args);
        data.pop();
        assert_eq!(
            error_code_of(parse_passthrough(&data)),
            code(SoulboundErrorCode::InvalidPassthroughData)
        );

        for discriminator in [
            PASSTHROUGH_ADD_PLUGIN_V1,
            PASSTHROUGH_UPDATE_PLUGIN_V1,
            PASSTHROUGH_REMOVE_PLUGIN_V1,
            PASSTHROUGH_UPDATE_V1,
        ] {
            assert_eq!(
                error_code_of(parse_passthrough(&[discriminator])),
                code(SoulboundErrorCode::InvalidPassthroughData)
            );
        }
    }

    #[test]
    fn rejects_trailing_bytes() {
        let args = UpdateV1InstructionArgs {
            new_name: Some(String::from("Nomad ID")),
            new_uri: None,
            new_update_authority: None,
        };
        let mut data = update_data(args);
        data.push(0);
        assert_eq!(
            error_code_of(parse_passthrough(&data)),
            code(SoulboundErrorCode::InvalidPassthroughData)
        );
    }

    #[test]
    fn rejects_unknown_plugin_variants() {
        assert_eq!(
            error_code_of(parse_passthrough(&[PASSTHROUGH_ADD_PLUGIN_V1, 200, 0])),
            code(SoulboundErrorCode::InvalidPassthroughData)
        );
        assert_eq!(
            error_code_of(parse_passthrough(&[PASSTHROUGH_REMOVE_PLUGIN_V1, 200])),
            code(SoulboundErrorCode::InvalidPassthroughData)
        );
    }
}
