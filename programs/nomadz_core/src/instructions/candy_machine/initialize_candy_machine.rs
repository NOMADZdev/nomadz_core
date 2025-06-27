// use anchor_lang::{ prelude::* };
// use anchor_spl::metadata::mpl_token_metadata::types::TokenStandard;
// use mpl_candy_machine_core::{ accounts::InitializeV2, CandyMachineData };

// use crate::{ errors::InitializeCandyMachineErrorCode, state::config::config::Config };

// pub fn initialize_candy_machine_handler(ctx: Context<CreateCandyMachine>) -> Result<()> {
//     require_keys_eq!(
//         ctx.accounts.admin.key(),
//         ctx.accounts.config.admin,
//         InitializeCandyMachineErrorCode::Forbidden
//     );

//     let admin = &ctx.accounts.admin;
//     let candy_machine = &ctx.accounts.candy_machine;
//     let collection_mint = &ctx.accounts.collection_mint;
//     let authority = &ctx.accounts.authority;
//     let authority_pda = &ctx.accounts.authority_pda;
//     let collection_update_authority = &ctx.accounts.collection_update_authority;
//     let system_program = &ctx.accounts.system_program;
//     let mpl_core_program = &ctx.accounts.mpl_core_program;

//     let context = CpiContext::new(mpl_core_program, InitializeV2 {
//         candy_machine: todo!(),
//         authority_pda: todo!(),
//         authority: todo!(),
//         payer: todo!(),
//         rule_set: todo!(),
//         collection_metadata: todo!(),
//         collection_mint: todo!(),
//         collection_master_edition: todo!(),
//         collection_update_authority: todo!(),
//         collection_delegate_record: todo!(),
//         token_metadata_program: todo!(),
//         system_program: todo!(),
//         sysvar_instructions: todo!(),
//         authorization_rules_program: todo!(),
//         authorization_rules: todo!(),
//     }).with_signer(manager_seeds);

//     mpl_candy_machine_core::candy_machine_core::initialize_v2(
//         context,
//         CandyMachineData {
//             items_available: todo!(),
//             symbol: todo!(),
//             seller_fee_basis_points: todo!(),
//             max_supply: todo!(),
//             is_mutable: todo!(),
//             creators: todo!(),
//             config_line_settings: todo!(),
//             hidden_settings: todo!(),
//         },
//         TokenStandard::NonFungible
//     )?;

//     msg!("Candy machine with address {:?} was successfully created", candy_machine);

//     Ok(())
// }

// #[derive(Accounts)]
// pub struct CreateCandyMachine<'info> {
//     /// CHECK: account constraints checked in account trait
//     pub candy_machine: UncheckedAccount<'info>,

//     #[account(mut)]
//     pub admin: Signer<'info>,

//     #[account(seeds = [b"config_v2"], bump)]
//     pub config: Account<'info, Config>,

//     pub collection_mint: AccountInfo<'info>,

//     pub authority: AccountInfo<'info>,

//     pub authority_pda: AccountInfo<'info>,

//     pub collection_update_authority: AccountInfo<'info>,

//     pub system_program: Program<'info, System>,

//     #[account(address = mpl_core::ID)]
//     pub mpl_core_program: AccountInfo<'info>,
// }
