use anchor_lang::prelude::*;
use mpl_core::instructions::{ AddPluginV1CpiBuilder, CreateV2CpiBuilder };
use mpl_core::types::{ Attribute, Attributes, Plugin };

use crate::constants::{
    ASSET_VERSION_PROGRAM_DELEGATED,
    NOMAD_ID_NAME,
    REPLACED_BY_KEY,
    REVOKED_STATUS_KEY,
    REVOKED_STATUS_VALUE,
};
use crate::errors::SoulboundErrorCode;
use crate::state::config::config::Config;
use crate::state::soulbound::asset_data::UserAssetData;
use crate::utils::{ burn_with_pda, nomad_id_plugins, require_governance, set_permanent_freeze };

pub fn soulbound_reissue_handler(
    ctx: Context<SoulboundReissue>,
    args: SoulboundReissueArgs
) -> Result<()> {
    require_governance(&ctx.accounts.config, &ctx.accounts.governance.key())?;
    require_keys_neq!(
        ctx.accounts.user_asset_data.asset,
        Pubkey::default(),
        SoulboundErrorCode::AssetNotSet
    );

    let SoulboundReissueArgs { user_id, uri } = args;

    let new_count = ctx.accounts.user_asset_data.reissue_count
        .checked_add(1)
        .ok_or_else(|| error!(SoulboundErrorCode::ReissueCountOverflow))?;

    let (expected_new_asset, new_asset_bump) = Pubkey::try_find_program_address(
        &[b"soulbound_asset", user_id.as_bytes(), crate::ID.as_ref(), &[new_count]],
        &crate::ID
    ).ok_or_else(|| error!(SoulboundErrorCode::InvalidReissueAsset))?;

    require_keys_eq!(
        ctx.accounts.new_asset.key(),
        expected_new_asset,
        SoulboundErrorCode::InvalidReissueAsset
    );

    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let asset = ctx.accounts.asset.to_account_info();
    let asset_authority = ctx.accounts.asset_authority.to_account_info();
    let new_asset = ctx.accounts.new_asset.to_account_info();
    let new_asset_authority = ctx.accounts.new_asset_authority.to_account_info();
    let payer = ctx.accounts.payer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let asset_authority_bump = ctx.bumps.asset_authority;

    if ctx.accounts.user_asset_data.asset_version == ASSET_VERSION_PROGRAM_DELEGATED {
        set_permanent_freeze(
            &mpl_core_program,
            &asset,
            &asset_authority,
            &payer,
            &system_program,
            asset_authority_bump,
            false
        )?;

        burn_with_pda(
            &mpl_core_program,
            &asset,
            &asset_authority,
            &payer,
            &system_program,
            asset_authority_bump
        )?;
    } else {
        let asset_key = asset.key();
        let asset_authority_seeds: &[&[u8]] = &[
            b"asset_authority",
            crate::ID.as_ref(),
            asset_key.as_ref(),
            &[asset_authority_bump],
        ];

        AddPluginV1CpiBuilder::new(&mpl_core_program)
            .asset(&asset)
            .collection(None)
            .payer(&payer)
            .authority(Some(&asset_authority))
            .system_program(&system_program)
            .log_wrapper(None)
            .plugin(
                Plugin::Attributes(Attributes {
                    attribute_list: vec![
                        Attribute {
                            key: String::from(REVOKED_STATUS_KEY),
                            value: String::from(REVOKED_STATUS_VALUE),
                        },
                        Attribute {
                            key: String::from(REPLACED_BY_KEY),
                            value: expected_new_asset.to_string(),
                        }
                    ],
                })
            )
            .invoke_signed(&[asset_authority_seeds])?;
    }

    let new_asset_seeds: &[&[u8]] = &[
        b"soulbound_asset",
        user_id.as_bytes(),
        crate::ID.as_ref(),
        &[new_count],
        &[new_asset_bump],
    ];
    let new_asset_authority_seeds: &[&[u8]] = &[
        b"asset_authority",
        crate::ID.as_ref(),
        expected_new_asset.as_ref(),
        &[ctx.bumps.new_asset_authority],
    ];

    CreateV2CpiBuilder::new(&mpl_core_program)
        .asset(&new_asset)
        .collection(None)
        .authority(Some(&new_asset_authority))
        .payer(&payer)
        .owner(Some(&payer))
        .update_authority(Some(&new_asset_authority))
        .system_program(&system_program)
        .log_wrapper(None)
        .name(String::from(NOMAD_ID_NAME))
        .uri(uri)
        .plugins(nomad_id_plugins(new_asset_authority.key()))
        .invoke_signed(&[new_asset_seeds, new_asset_authority_seeds])?;

    let user_asset_data = &mut ctx.accounts.user_asset_data;
    user_asset_data.asset = expected_new_asset;
    user_asset_data.user = payer.key();
    user_asset_data.reissue_count = new_count;
    user_asset_data.asset_version = ASSET_VERSION_PROGRAM_DELEGATED;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct SoulboundReissueArgs {
    pub user_id: String,
    pub uri: String,
}

#[derive(Accounts)]
#[instruction(args: SoulboundReissueArgs)]
pub struct SoulboundReissue<'info> {
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

    /// CHECK: verified in the handler against the next reissue address
    #[account(mut)]
    pub new_asset: UncheckedAccount<'info>,

    /// CHECK: PDA derived
    #[account(seeds = [b"asset_authority", crate::ID.as_ref(), new_asset.key().as_ref()], bump)]
    pub new_asset_authority: UncheckedAccount<'info>,

    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: address constrained to mpl-core
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
