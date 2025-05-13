use crate::{ errors::UpdateConfigErrorCode, state::config::config::Config };
use anchor_lang::prelude::*;

pub fn update_config_handler(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let admin = &ctx.accounts.admin;

    require!(admin.key() == config.admin, UpdateConfigErrorCode::InvalidAdminPubkey);

    let UpdateConfigArgs {
        admin: new_admin,
        mint_soulbound_fee,
        lvl_percentages,
        fee_vault,
    } = args;

    if let Some(new_admin) = new_admin {
        msg!(
            "Updated config admin account. Old admin: {:?}, new admin: {:?}",
            config.admin,
            new_admin
        );
        config.admin = new_admin;
    }

    if let Some(new_fee_vault) = fee_vault {
        msg!(
            "Updated config fee vault account. Old fee vault: {:?}, new fee vault: {:?}",
            config.fee_vault,
            new_fee_vault
        );
        config.fee_vault = new_fee_vault;
    }

    if let Some(new_lvl_percentages) = lvl_percentages {
        msg!(
            "Updated config level percentages. Old lvl percentages: {:?}, new lvl percentages: {:?}",
            config.lvl_percentages,
            new_lvl_percentages
        );
        config.lvl_percentages = new_lvl_percentages;
    }

    if let Some(new_mint_soulbound_fee) = mint_soulbound_fee {
        msg!(
            "Updated config mint soulbound fee. Old mint soulbound fee: {:?}, new mint soulbound fee: {:?}",
            config.mint_soulbound_fee,
            new_mint_soulbound_fee
        );
        config.mint_soulbound_fee = new_mint_soulbound_fee;
    }

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct UpdateConfigArgs {
    lvl_percentages: Option<[u8; 2]>,
    mint_soulbound_fee: Option<u64>,
    admin: Option<Pubkey>,
    fee_vault: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: UpdateConfigArgs)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,

    /// CHECK: passed explicitly and validated in logic
    pub new_admin: Option<AccountInfo<'info>>,

    /// CHECK: passed explicitly and validated in logic
    pub new_fee_vault: Option<AccountInfo<'info>>,
}
