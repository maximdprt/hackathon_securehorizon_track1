// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AuthorityRegistry
/// @notice On-chain authority-chain + incident registry for agentic payments.
/// @dev ESSECKATHON Secure Horizons - Track 01. Answers OWASP ASI03 (privilege
///      compromise) and ASI07 (agent/tool misuse). Tamper-evident, revocable,
///      event-logged (DORA incident trail). No external imports: deploy as-is in
///      Remix on Avalanche Fuji (chainId 43113).
contract AuthorityRegistry {
    address public owner;

    // ----- Authority chain: who may order a payment, and up to how much -----
    struct Authority {
        bool active;
        uint256 maxAmount; // per-order cap in smallest unit (0 = no cap when active)
        string role;       // e.g. "treasury-agent"
    }
    mapping(address => Authority) public authorities;

    // ----- Incident / threat registry: flagged issuers or instruction hashes -----
    struct Threat {
        bool flagged;
        uint8 severity; // 1 = info, 2 = warn, 3 = block
        string reason;
        bool disputed;  // due process / revocability
        uint256 flaggedAt;
    }
    mapping(bytes32 => Threat) public threats;

    // verdict codes
    uint8 public constant ALLOW = 0;
    uint8 public constant NEEDS_APPROVAL = 1;
    uint8 public constant BLOCK = 2;

    event AuthorityGranted(address indexed issuer, uint256 maxAmount, string role);
    event AuthorityRevoked(address indexed issuer);
    event ThreatFlagged(bytes32 indexed subject, uint8 severity, string reason);
    event ThreatCleared(bytes32 indexed subject);
    event DecisionRecorded(
        bytes32 indexed instructionId,
        address indexed issuer,
        uint256 amount,
        uint8 verdict,
        string reason
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ----- Admin: authority management -----
    function grantAuthority(address issuer, uint256 maxAmount, string calldata role) external onlyOwner {
        authorities[issuer] = Authority(true, maxAmount, role);
        emit AuthorityGranted(issuer, maxAmount, role);
    }

    function revokeAuthority(address issuer) external onlyOwner {
        authorities[issuer].active = false;
        emit AuthorityRevoked(issuer);
    }

    // ----- Admin: incident / threat management (revocable = AI Act due process) -----
    function flagThreat(bytes32 subject, uint8 severity, string calldata reason) external onlyOwner {
        threats[subject] = Threat(true, severity, reason, false, block.timestamp);
        emit ThreatFlagged(subject, severity, reason);
    }

    function clearThreat(bytes32 subject) external onlyOwner {
        threats[subject].flagged = false;
        threats[subject].disputed = true;
        emit ThreatCleared(subject);
    }

    // ----- Views used by the off-chain policy-check or an on-chain consumer -----
    function isAuthorized(address issuer, uint256 amount) public view returns (bool) {
        Authority memory a = authorities[issuer];
        if (!a.active) return false;
        if (a.maxAmount != 0 && amount > a.maxAmount) return false;
        return true;
    }

    function isFlagged(bytes32 subject) public view returns (bool, uint8) {
        Threat memory t = threats[subject];
        return (t.flagged, t.severity);
    }

    /// @dev helper: turn an address into the bytes32 key used in `threats`.
    function addressKey(address a) public pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @notice Combined verdict: authority chain + incident registry. Pure read.
    /// @return verdict 0 = ALLOW, 1 = NEEDS_APPROVAL, 2 = BLOCK
    function assess(address issuer, bytes32 instructionId, uint256 amount) public view returns (uint8) {
        (bool insFlagged, uint8 insSev) = isFlagged(instructionId);
        if (insFlagged && insSev >= 3) return BLOCK;

        (bool issFlagged, uint8 issSev) = isFlagged(addressKey(issuer));
        if (issFlagged && issSev >= 3) return BLOCK;

        if (!isAuthorized(issuer, amount)) return NEEDS_APPROVAL;
        if (insFlagged || issFlagged) return NEEDS_APPROVAL;
        return ALLOW;
    }

    /// @notice Record a decision on-chain = tamper-evident DORA incident trail.
    /// @dev Open to the policy-check caller; the event is the audit log.
    function recordDecision(
        bytes32 instructionId,
        address issuer,
        uint256 amount,
        uint8 verdict,
        string calldata reason
    ) external {
        emit DecisionRecorded(instructionId, issuer, amount, verdict, reason);
    }
}
