#![cfg(test)]

use super::*;
use soroban_sdk::{Env, testutils::Address as _, vec, Val};

#[test]
fn test_register_and_get_task() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let args: Vec<Val> = vec![&env]; // Empty args

    let task_config = TaskConfig {
        creator: creator.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "my_func"),
        args: args.clone(),
        interval: 100,
        last_run: 0,
        gas_balance: 1000,
    };

    let task_id = 1;
    client.register(&task_id, &task_config);

    let registered_task = client.get_task(&task_id);
    assert!(registered_task.is_some());
    
    let retrieved_config = registered_task.unwrap();
    assert_eq!(retrieved_config.creator, creator);
    assert_eq!(retrieved_config.target, target);
    assert_eq!(retrieved_config.interval, 100);
    assert_eq!(retrieved_config.gas_balance, 1000);
}

#[test]
fn test_get_non_existent_task() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let task = client.get_task(&999);
    assert!(task.is_none());
}

#[test]
fn test_batch_execute() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let args: Vec<Val> = vec![&env]; // Empty args

    let task_config = TaskConfig {
        creator: creator.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "my_func"),
        args: args.clone(),
        interval: 100,
        last_run: 0,
        gas_balance: 1000,
    };

    let task_id1 = 1;
    let task_id2 = 2;
    client.register(&task_id1, &task_config);
    client.register(&task_id2, &task_config);

    // Execute both tasks in a batch
    let keeper = Address::generate(&env);
    let task_ids = vec![&env, task_id1, task_id2];
    
    // This should succeed
    client.batch_execute(&keeper, &task_ids);

    // Verify both tasks were executed (last_run updated)
    let task1 = client.get_task(&task_id1).unwrap();
    let task2 = client.get_task(&task_id2).unwrap();
    
    assert!(task1.last_run > 0);
    assert!(task2.last_run > 0);
}

#[test]
fn test_reentrancy_guard_transient_storage() {
    let env = Env::default();
    enter_security_guard(&env);

    // Immediate second enter should panic with ReentrantCall (code 300)
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        enter_security_guard(&env);
    }));
    assert!(res.is_err());

    exit_security_guard(&env);
    // After exit, entering again should succeed
    enter_security_guard(&env);
    exit_security_guard(&env);
}

#[test]
fn test_flash_swap_slippage_bounds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let keeper = Address::generate(&env);
    let target = Address::generate(&env);
    let router = Address::generate(&env);
    let token_borrow = Address::generate(&env);
    let token_repay = Address::generate(&env);

    let config = TaskConfig {
        creator: keeper.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "hello"),
        args: vec![&env],
        resolver: None,
        interval: 3600,
        last_run: 0,
        gas_balance: 1000,
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        yield_strategy: None,
        permissions: 15,
    };

    let task_id = client.register(&config);

    // Slippage > 10_000 bps should panic with InvalidSlippage
    let invalid_params = FlashSwapParams {
        dex_router: router.clone(),
        token_borrow: token_borrow.clone(),
        amount_borrow: 10_000,
        token_repay: token_repay.clone(),
        min_profit: 50,
        flash_fee_bps: 12_000, // Invalid: > 100%
    };

    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute_flash_swap_arbitrage(&keeper, &task_id, &invalid_params);
    }));
    assert!(res.is_err());
}

#[test]
fn test_normalized_error_discriminants() {
    assert_eq!(Error::Unauthorized as u32, 100);
    assert_eq!(Error::InvalidInterval as u32, 200);
    assert_eq!(Error::ReentrantCall as u32, 300);
    assert_eq!(Error::OracleNotSet as u32, 400);
    assert_eq!(Error::InsufficientBalance as u32, 500);
}
