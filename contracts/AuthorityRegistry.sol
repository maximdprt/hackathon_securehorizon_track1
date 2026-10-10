// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AuthorityRegistry
/// @notice On-chain authority + incident + VISA registry for agentic payments (Track 01).
/// @dev Walid's lane = on-chain ENFORCEMENT + MEMORY. The decision (allow/block/human) is made
///      OFF-CHAIN by the brain (agents + scoring, Corentin/Bruno). This contract only RECORDS
///      that decision and ENFORCES it: an "allow" becomes a one-time VISA that the GuardedVault
///      checks in-EVM before any payment. OWASP ASI03 (privilege compromise) / ASI07 (tool misuse).
///      Deploy on SentinelL1. No external imports (Remix / forge-ready).
contract AuthorityRegistry {
    address public owner;
    address public vault;                         // the GuardedVault allowed to consume visas
    mapping(address => bool) public authorizers;  // API keys allowed to grant visas / flag threats

    // ----- Authority chain: who may order a payment, up to what amount (read-signal for the brain) -----
    struct Authority { bool active; uint256 maxAmount; string role; }
    mapping(address => Authority) public authorities;

    // ----- Incident / threat registry: flagged recipients or issuers -----
    struct Threat { bool flagged; uint8 severity; string reason; bool disputed; uint256 flaggedAt; }
    mapping(bytes32 => Threat) public threats;

    // ----- Visas: one-time authorizations for a specific payment -----
    struct Visa { bool granted; bool used; address issuer; address recipient; uint256 amount; uint256 expiry; }
    mapping(bytes32 => Visa) public visas; // key = paymentId

    event AuthorizerSet(address indexed who, bool ok);
    event VaultSet(address indexed vault);
    event AuthorityGranted(address indexed issuer, uint256 maxAmount, string role);
    event AuthorityRevoked(address indexed issuer);
    event ThreatFlagged(bytes32 indexed subject, uint8 severity, string reason);
    event ThreatCleared(bytes32 indexed subject);
    event VisaGranted(bytes32 indexed paymentId, address indexed issuer, address recipient, uint256 amount, uint256 expiry);
    event VisaUsed(bytes32 indexed paymentId);
    event VisaRevoked(bytes32 indexed paymentId);
    event DecisionRecorded(bytes32 indexed paymentId, address indexed issuer, string verdict, string reason);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyAuthorizer() { require(authorizers[msg.sender] || msg.sender == owner, "not authorizer"); _; }
    modifier onlyVault() { require(msg.sender == vault, "not vault"); _; }

    constructor() { owner = msg.sender; authorizers[msg.sender] = true; }

    // ---- admin ----
    function setAuthorizer(address who, bool ok) external onlyOwner { authorizers[who] = ok; emit AuthorizerSet(who, ok); }
    function setVault(address v) external onlyOwner { vault = v; emit VaultSet(v); }
    function grantAuthority(address issuer, uint256 maxAmount, string calldata role) external onlyOwner {
        authorities[issuer] = Authority(true, maxAmount, role);
        emit AuthorityGranted(issuer, maxAmount, role);
    }
    function revokeAuthority(address issuer) external onlyOwner { authorities[issuer].active = false; emit AuthorityRevoked(issuer); }

    // ---- flags: the API records a blocked recipient/issuer (next time = instant block) ----
    function flagThreat(bytes32 subject, uint8 severity, string calldata reason) external onlyAuthorizer {
        threats[subject] = Threat(true, severity, reason, false, block.timestamp);
        emit ThreatFlagged(subject, severity, reason);
    }
    function clearThreat(bytes32 subject) external onlyOwner { // revocable = AI Act due process
        threats[subject].flagged = false; threats[subject].disputed = true; emit ThreatCleared(subject);
    }

    // ---- visas: the API grants one after the brain says "allow" ----
    function grantVisa(bytes32 paymentId, address issuer, address recipient, uint256 amount, uint256 ttlSeconds)
        external onlyAuthorizer
    {
        uint256 exp = block.timestamp + ttlSeconds;
        visas[paymentId] = Visa(true, false, issuer, recipient, amount, exp);
        emit VisaGranted(paymentId, issuer, recipient, amount, exp);
    }
    function revokeVisa(bytes32 paymentId) external onlyAuthorizer { visas[paymentId].granted = false; emit VisaRevoked(paymentId); }

    /// @notice Called by the GuardedVault during pay(): verifies the visa matches this exact payment
    ///         and consumes it (one-time). Reverts if no valid visa = payment blocked in-EVM.
    function useVisa(bytes32 paymentId, address issuer, address recipient, uint256 amount)
        external onlyVault returns (bool)
    {
        Visa storage v = visas[paymentId];
        require(v.granted && !v.used, "visa invalid");
        require(block.timestamp <= v.expiry, "visa expired");
        require(v.issuer == issuer && v.recipient == recipient && v.amount == amount, "visa mismatch");
        v.used = true;
        emit VisaUsed(paymentId);
        return true;
    }

    // ---- reads (the brain uses these as signals) ----
    function isAuthorized(address issuer, uint256 amount) external view returns (bool) {
        Authority memory a = authorities[issuer];
        if (!a.active) return false;
        if (a.maxAmount != 0 && amount > a.maxAmount) return false;
        return true;
    }
    function isFlagged(bytes32 subject) external view returns (bool, uint8) {
        Threat memory t = threats[subject]; return (t.flagged, t.severity);
    }
    function isVisaValid(bytes32 paymentId) external view returns (bool) {
        Visa memory v = visas[paymentId];
        return v.granted && !v.used && block.timestamp <= v.expiry;
    }
    /// @dev address -> bytes32 key used in `threats` (left-padded address, not a hash).
    function addressKey(address a) external pure returns (bytes32) { return bytes32(uint256(uint160(a))); }

    // ---- audit trail (DORA): every decision recorded as an event ----
    function recordDecision(bytes32 paymentId, address issuer, string calldata verdict, string calldata reason)
        external onlyAuthorizer
    {
        emit DecisionRecorded(paymentId, issuer, verdict, reason);
    }
}
