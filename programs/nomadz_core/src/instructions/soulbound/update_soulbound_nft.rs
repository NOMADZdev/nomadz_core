use anchor_lang::prelude::*;
use mpl_core::instructions::UpdateV2CpiBuilder;

use crate::errors::UpdateSoulboundNftErrorCode;
use crate::state::config::config::Config;

pub fn update_soulbound_nft_handler(
    ctx: Context<UpdateSoulboundNFT>,
    args: UpdateSoulboundNFTArgs
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        UpdateSoulboundNftErrorCode::Unauthorized
    );

    let UpdateSoulboundNFTArgs { new_uri, user_id } = args;

    let asset_account = &ctx.accounts.asset_account;
    let asset_authority = &ctx.accounts.asset_authority;
    let admin = &ctx.accounts.admin;
    let mpl_core_program = &ctx.accounts.mpl_core_program;
    let system_program = &ctx.accounts.system_program;
    let nomadz_program = &ctx.accounts.nomadz_program;

    let asset_account_info = asset_account.to_account_info();
    let asset_authority_info = asset_authority.to_account_info();
    let admin_info = admin.to_account_info();

    let asset_account_seeds: &[&[&[u8]]] = &[
        &[
            b"soulbound_asset",
            &user_id.as_bytes(),
            &nomadz_program.key().to_bytes(),
            &[ctx.bumps.asset_account],
        ],
    ];

    let asset_authority_seeds: &[&[&[u8]]] = &[
        &[
            b"asset_authority",
            &nomadz_program.key().to_bytes(),
            &asset_account.key().to_bytes(),
            &[ctx.bumps.asset_authority],
        ],
    ];

    let mut builder = UpdateV2CpiBuilder::new(mpl_core_program);
    let mut builder = builder
        .asset(&asset_account_info)
        .authority(Some(&asset_authority_info))
        .payer(&admin_info)
        .system_program(system_program);

    if let Some(uri) = new_uri {
        builder = builder.new_uri(uri);
    }

    builder
        .invoke_signed(&[asset_account_seeds[0], asset_authority_seeds[0]])
        .map_err(|_| UpdateSoulboundNftErrorCode::UpdateAssetError)?;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct UpdateSoulboundNFTArgs {
    new_uri: Option<String>,
    user_id: String,
}

#[derive(Accounts)]
#[instruction(args: UpdateSoulboundNFTArgs)]
pub struct UpdateSoulboundNFT<'info> {
    /// CHECK: PDA derived
    #[account(
        mut,
        seeds = [b"soulbound_asset", args.user_id.as_bytes(), nomadz_program.key().as_ref()],
        bump,
        seeds::program = nomadz_program.key()
    )]
    pub asset_account: UncheckedAccount<'info>,

    /// CHECK: PDA derived
    #[account(
        mut,
        seeds = [b"asset_authority", nomadz_program.key().as_ref(), asset_account.key().as_ref()],
        bump,
        seeds::program = nomadz_program.key()
    )]
    pub asset_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>, // changed from user to admin

    #[account(address = crate::ID)]
    pub nomadz_program: AccountInfo<'info>,

    #[account(address = mpl_core::ID)]
    pub mpl_core_program: AccountInfo<'info>,

    #[account(address = solana_program::system_program::ID)]
    pub system_program: Program<'info, System>,

    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
}
