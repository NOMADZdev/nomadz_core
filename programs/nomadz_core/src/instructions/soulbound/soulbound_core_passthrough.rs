use anchor_lang::prelude::*;

use crate::constants::ASSET_VERSION_PROGRAM_DELEGATED;
use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;
use crate::state::soulbound::asset_data::UserAssetData;
use crate::utils::{ parse_passthrough, require_governance, set_permanent_freeze, PassthroughOp };
use mpl_core::accounts::BaseAssetV1;
use mpl_core::fetch_plugin;
use mpl_core::types::{ PermanentFreezeDelegate, PluginType };
use mpl_core::instructions::{
    AddPluginV1CpiBuilder,
    RemovePluginV1CpiBuilder,
    UpdatePluginV1CpiBuilder,
    UpdateV1CpiBuilder,
};

pub fn soulbound_core_passthrough_handler(
    ctx: Context<SoulboundCorePassthrough>,
    args: SoulboundCorePassthroughArgs
) -> Result<()> {
    require_governance(&ctx.accounts.config, &ctx.accounts.governance.key())?;
    require_keys_neq!(
        ctx.accounts.user_asset_data.asset,
        Pubkey::default(),
        SoulboundErrorCode::AssetNotSet
    );
    require_eq!(
        ctx.accounts.user_asset_data.asset_version,
        ASSET_VERSION_PROGRAM_DELEGATED,
        SoulboundErrorCode::NotProgramDelegated
    );

    let operation = parse_passthrough(&args.data)?;

    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let asset = ctx.accounts.asset.to_account_info();
    let asset_authority = ctx.accounts.asset_authority.to_account_info();
    let payer = ctx.accounts.payer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    let asset_key = asset.key();
    let asset_authority_seeds: &[&[u8]] = &[
        b"asset_authority",
        crate::ID.as_ref(),
        asset_key.as_ref(),
        &[ctx.bumps.asset_authority],
    ];

    let (_, permanent_freeze, _) = fetch_plugin::<BaseAssetV1, PermanentFreezeDelegate>(
        &asset,
        PluginType::PermanentFreezeDelegate
    ).map_err(|_| error!(SoulboundErrorCode::InvalidAssetAccount))?;
    let was_frozen = permanent_freeze.frozen;

    if was_frozen {
        set_permanent_freeze(
            &mpl_core_program,
            &asset,
            &asset_authority,
            &payer,
            &system_program,
            ctx.bumps.asset_authority,
            false
        )?;
    }

    match operation {
        PassthroughOp::AddPlugin(add_plugin_args) => {
            let mut builder = AddPluginV1CpiBuilder::new(&mpl_core_program);
            builder
                .asset(&asset)
                .collection(None)
                .payer(&payer)
                .authority(Some(&asset_authority))
                .system_program(&system_program)
                .log_wrapper(None)
                .plugin(add_plugin_args.plugin);
            if let Some(init_authority) = add_plugin_args.init_authority {
                builder.init_authority(init_authority);
            }
            builder.invoke_signed(&[asset_authority_seeds])?;
        }
        PassthroughOp::UpdatePlugin(update_plugin_args) => {
            UpdatePluginV1CpiBuilder::new(&mpl_core_program)
                .asset(&asset)
                .collection(None)
                .payer(&payer)
                .authority(Some(&asset_authority))
                .system_program(&system_program)
                .log_wrapper(None)
                .plugin(update_plugin_args.plugin)
                .invoke_signed(&[asset_authority_seeds])?;
        }
        PassthroughOp::RemovePlugin(remove_plugin_args) => {
            RemovePluginV1CpiBuilder::new(&mpl_core_program)
                .asset(&asset)
                .collection(None)
                .payer(&payer)
                .authority(Some(&asset_authority))
                .system_program(&system_program)
                .log_wrapper(None)
                .plugin_type(remove_plugin_args.plugin_type)
                .invoke_signed(&[asset_authority_seeds])?;
        }
        PassthroughOp::Update(update_args) => {
            let mut builder = UpdateV1CpiBuilder::new(&mpl_core_program);
            builder
                .asset(&asset)
                .collection(None)
                .payer(&payer)
                .authority(Some(&asset_authority))
                .system_program(&system_program)
                .log_wrapper(None);
            if let Some(new_name) = update_args.new_name {
                builder.new_name(new_name);
            }
            if let Some(new_uri) = update_args.new_uri {
                builder.new_uri(new_uri);
            }
            builder.invoke_signed(&[asset_authority_seeds])?;
        }
    }

    if was_frozen {
        set_permanent_freeze(
            &mpl_core_program,
            &asset,
            &asset_authority,
            &payer,
            &system_program,
            ctx.bumps.asset_authority,
            true
        )?;
    }

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct SoulboundCorePassthroughArgs {
    pub user_id: String,
    pub data: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(args: SoulboundCorePassthroughArgs)]
pub struct SoulboundCorePassthrough<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"user_asset_data", args.user_id.as_bytes(), crate::ID.as_ref()],
        bump
    )]
    pub user_asset_data: Account<'info, UserAssetData>,

    /// CHECK: must equal user_asset_data.asset, validated by mpl-core
    #[account(
        mut,
        constraint = asset.key() == user_asset_data.asset @ SoulboundErrorCode::AssetMismatch
    )]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: PDA derived
    #[account(seeds = [b"asset_authority", crate::ID.as_ref(), asset.key().as_ref()], bump)]
    pub asset_authority: UncheckedAccount<'info>,

    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: address constrained to mpl-core
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
