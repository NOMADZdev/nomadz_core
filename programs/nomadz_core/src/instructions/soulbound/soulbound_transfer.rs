use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;
use mpl_core::fetch_plugin;
use mpl_core::instructions::{
    ApprovePluginAuthorityV1CpiBuilder,
    TransferV1CpiBuilder,
    UpdatePluginV1CpiBuilder,
};
use mpl_core::types::{ FreezeDelegate, Key as MplKey, Plugin, PluginAuthority, PluginType };

use crate::constants::ASSET_VERSION_PROGRAM_DELEGATED;
use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;
use crate::state::soulbound::asset_data::UserAssetData;
use crate::utils::{ require_admin, set_permanent_freeze, transfer_with_pda };

pub fn soulbound_transfer_handler(
    ctx: Context<SoulboundTransfer>,
    _args: SoulboundTransferArgs
) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.admin.key())?;
    require_keys_neq!(
        ctx.accounts.user_asset_data.asset,
        Pubkey::default(),
        SoulboundErrorCode::AssetNotSet
    );

    let asset_info = ctx.accounts.asset.to_account_info();
    let asset_authority_info = ctx.accounts.asset_authority.to_account_info();
    let payer_info = ctx.accounts.payer.to_account_info();
    let admin_info = ctx.accounts.admin.to_account_info();
    let mpl_core_program_info = ctx.accounts.mpl_core_program.to_account_info();
    let system_program_info = ctx.accounts.system_program.to_account_info();
    let asset_authority_bump = ctx.bumps.asset_authority;

    if ctx.accounts.user_asset_data.asset_version == ASSET_VERSION_PROGRAM_DELEGATED {
        set_permanent_freeze(
            &mpl_core_program_info,
            &asset_info,
            &asset_authority_info,
            &payer_info,
            &system_program_info,
            asset_authority_bump,
            false
        )?;
        transfer_with_pda(
            &mpl_core_program_info,
            &asset_info,
            &asset_authority_info,
            &payer_info,
            &payer_info,
            &system_program_info,
            asset_authority_bump
        )?;
        set_permanent_freeze(
            &mpl_core_program_info,
            &asset_info,
            &asset_authority_info,
            &payer_info,
            &system_program_info,
            asset_authority_bump,
            true
        )?;
    } else {
        let current_owner = ctx.accounts.current_owner
            .as_ref()
            .ok_or(SoulboundErrorCode::OwnerSignatureRequired)?;
        let current_owner_info = current_owner.to_account_info();

        require_keys_eq!(
            *asset_info.owner,
            mpl_core::ID,
            SoulboundErrorCode::InvalidAssetAccount
        );
        let base_asset = BaseAssetV1::from_bytes(&asset_info.try_borrow_data()?).map_err(
            |_| SoulboundErrorCode::InvalidAssetAccount
        )?;
        require!(base_asset.key == MplKey::AssetV1, SoulboundErrorCode::InvalidAssetAccount);
        require_keys_eq!(
            base_asset.owner,
            current_owner.key(),
            SoulboundErrorCode::OwnerMismatch
        );

        UpdatePluginV1CpiBuilder::new(&mpl_core_program_info)
            .asset(&asset_info)
            .payer(&payer_info)
            .authority(Some(&admin_info))
            .system_program(&system_program_info)
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
            .invoke()?;

        TransferV1CpiBuilder::new(&mpl_core_program_info)
            .asset(&asset_info)
            .payer(&payer_info)
            .authority(Some(&current_owner_info))
            .new_owner(&payer_info)
            .system_program(Some(&system_program_info))
            .invoke()?;

        let admin_authority = PluginAuthority::Address { address: ctx.accounts.admin.key() };
        let (freeze_authority, _, _) = fetch_plugin::<BaseAssetV1, FreezeDelegate>(
            &asset_info,
            PluginType::FreezeDelegate
        ).map_err(|_| SoulboundErrorCode::InvalidAssetAccount)?;

        if freeze_authority != admin_authority {
            ApprovePluginAuthorityV1CpiBuilder::new(&mpl_core_program_info)
                .asset(&asset_info)
                .payer(&payer_info)
                .authority(Some(&payer_info))
                .system_program(&system_program_info)
                .plugin_type(PluginType::FreezeDelegate)
                .new_authority(admin_authority)
                .invoke()?;
        }

        UpdatePluginV1CpiBuilder::new(&mpl_core_program_info)
            .asset(&asset_info)
            .payer(&payer_info)
            .authority(Some(&admin_info))
            .system_program(&system_program_info)
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
            .invoke()?;
    }

    ctx.accounts.user_asset_data.user = ctx.accounts.payer.key();

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct SoulboundTransferArgs {
    pub user_id: String,
}

#[derive(Accounts)]
#[instruction(args: SoulboundTransferArgs)]
pub struct SoulboundTransfer<'info> {
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

    pub admin: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub current_owner: Option<Signer<'info>>,

    /// CHECK: address constrained to mpl-core
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
