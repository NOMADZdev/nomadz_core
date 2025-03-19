use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct MintSoulboundNFT<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub authority: Option<AccountInfo<'info>>,
}

pub fn mint_soulbound_NFT_handler(ctx: Context<MintSoulboundNFT>) -> Result<()> {
    // msg!("Config initialized with admin: {:?}", config.admin);

    Ok(())
}
