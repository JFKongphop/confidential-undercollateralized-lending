// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title RepaymentTracker — encrypted, portable reputation accumulator (contract #2)
/// @notice Maintains an encrypted reputation score per borrower that rises on an on-time
///         repayment and decays (floored at 0) on a miss. Consumed by CreditOracle. Nothing
///         is ever decrypted here — the whole history stays private and branch-free.
contract RepaymentTracker is ZamaEthereumConfig {
  // ── Encrypted state ────────────────────────────────────────────────────────
  mapping(address => euint32) private _rep;

  // ── Plaintext wiring / access control ──────────────────────────────────────
  address public admin;
  address public lendingPool; // only the pool may record repayments
  address public creditOracle; // may read the reputation handle

  // ── Plaintext scoring config (public is fine) ──────────────────────────────
  uint32 internal constant INCREMENT = 50;
  uint32 internal constant DECAY = 30;

  event ReputationUpdated(address indexed user);

  constructor() {
    admin = msg.sender;
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  function setLendingPool(address pool) external onlyAdmin {
    lendingPool = pool;
  }

  function setCreditOracle(address oracle) external onlyAdmin {
    creditOracle = oracle;
  }

  /// @notice Record a repayment outcome. `onTime` is an encrypted flag supplied by the pool,
  ///         which must have granted this contract transient ACL access to it.
  function recordRepayment(address user, ebool onTime) external {
    require(msg.sender == lendingPool, "only pool");

    // init-or-add: a ciphertext has no implicit zero.
    euint32 cur = FHE.isInitialized(_rep[user]) ? _rep[user] : FHE.asEuint32(0);

    // up on time; down (floored at 0) on miss — all branch-free.
    euint32 up = FHE.add(cur, FHE.asEuint32(INCREMENT));
    euint32 down = FHE.select(FHE.ge(cur, FHE.asEuint32(DECAY)), FHE.sub(cur, FHE.asEuint32(DECAY)), FHE.asEuint32(0));
    euint32 next = FHE.select(onTime, up, down);

    _rep[user] = next;
    FHE.allowThis(next);
    FHE.allow(next, user); // user can see their own reputation
    if (creditOracle != address(0)) {
      FHE.allow(next, creditOracle); // oracle consumes it next scoring round
    }
    if (lendingPool != address(0)) {
      FHE.allow(next, lendingPool); // pool consumes it as the reputation-unlocked credit line
    }
    emit ReputationUpdated(user);
  }

  /// @notice Encrypted reputation handle for `user` (CreditOracle is ACL-granted; the user too).
  function reputationOf(address user) external view returns (euint32) {
    return _rep[user];
  }

  /// @notice Whether `user` has any reputation handle yet (guards CreditOracle's first read).
  function hasReputation(address user) external view returns (bool) {
    return FHE.isInitialized(_rep[user]);
  }
}
