// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAuthorityRegistry {
    function useVisa(bytes32 paymentId, address issuer, address recipient, uint256 amount) external returns (bool);
}

/// @title GuardedVault
/// @notice Holds an agent's funds (native SEC). A payment only executes if a valid VISA exists in
///         the AuthorityRegistry for that exact (paymentId, issuer, recipient, amount). No visa = revert.
/// @dev This is THE enforcement: an agent cannot pay without passing the off-chain authority check
///      first (which grants the visa). Even a prompt-injected / compromised agent is blocked here,
///      because the gate is in the EVM, not in the agent's logic. Native-token version for SentinelL1.
contract GuardedVault {
    IAuthorityRegistry public immutable registry;
    mapping(address => uint256) public balances; // per-agent deposited balance

    event Deposited(address indexed agent, uint256 amount);
    event Paid(bytes32 indexed paymentId, address indexed issuer, address recipient, uint256 amount);
    event Blocked(bytes32 indexed paymentId, address indexed issuer, address recipient, uint256 amount);

    constructor(address _registry) { registry = IAuthorityRegistry(_registry); }

    /// @notice An agent deposits funds it will later spend through the guard.
    function deposit() external payable { balances[msg.sender] += msg.value; emit Deposited(msg.sender, msg.value); }

    /// @notice Agent pays a recipient. Reverts unless a matching visa exists (and consumes it).
    ///         `paymentId` must match the visa granted by the API after the brain approved.
    function pay(bytes32 paymentId, address payable recipient, uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient balance");

        // THE GATE: consume a valid visa or revert. useVisa reverts if invalid/expired/mismatch.
        bool ok = registry.useVisa(paymentId, msg.sender, recipient, amount);
        require(ok, "no valid visa");

        balances[msg.sender] -= amount;
        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "transfer failed");
        emit Paid(paymentId, msg.sender, recipient, amount);
    }
}
