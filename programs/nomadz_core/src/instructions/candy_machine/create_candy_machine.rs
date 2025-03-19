// use crate::state::config::config::Config;
// use anchor_lang::{prelude::*, solana_program::sysvar};
// use mpl_candy_machine_core::{accounts::Initialize, candy_machine_core::*};

// pub fn create_candy_machine_handler(ctx: Context<CreateCandyMachine>) -> Result<()> {
//     let creator = &ctx.accounts.creator;
//     let candy_machine = &ctx.accounts.candy_machine;
//     let collection_mint = &ctx.accounts.candy_machine;
//     let authority = &ctx.accounts.authority;
//     let authority_pda = &ctx.accounts.authority_pda;
//     let collection_update_authority = &ctx.accounts.collection_update_authority;
//     let system_program = &ctx.accounts.system_program;
//     let mpl_core_program = &ctx.accounts.mpl_core_program;

//     let context = CpiContext::new(

//     )
//     .with_signer(manager_seeds);

//     mpl_candy_machine_core::candy_machine_core::initialize(context, data)?;

//     msg!(
//         "Candy machine with address {:?} was successfully created",
//         candy_machine
//     );

//     Ok(())
// }

// #[derive(Accounts)]
// pub struct CreateCandyMachine<'info> {
//     #[account(mut)]
//     pub creator: Signer<'info>,

//     pub candy_machine: AccountInfo<'info>,

//     pub collection_mint: AccountInfo<'info>,

//     pub authority: AccountInfo<'info>,

//     pub authority_pda: AccountInfo<'info>,

//     pub collection_update_authority: AccountInfo<'info>,

//     pub system_program: Program<'info, System>,

//     // #[account(address = mpl_core::ID)]
//     // pub mpl_core_program: Program<'info, >,
// }
