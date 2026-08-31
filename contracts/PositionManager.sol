// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title PositionManager — encrypted per-market position record / mirror (contract #5)
/// @notice Holds each borrower's encrypted collateral & debt per market as a decryptable position
///         record (UX / history). Authoritative liquidation health lives in LendingPool (which
///         owns the live debt incl. accrued interest); this contract is the position mirror.
contract PositionManager is ZamaEthereumConfig {
  struct Position {
    euint64 collateral;
    euint64 debt;
    bool exists;
  }

  mapping(uint256 => mapping(address => Position)) private _pos; // market => user => position
  address public admin;
  address public lendingPool;

  event PositionUpdated(uint256 indexed marketId, address indexed user);

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

  /// @notice Record a position's encrypted collateral + debt. The pool must have granted this
  ///         contract ACL access to both handles before calling (else it reverts here).
  function updatePosition(uint256 marketId, address user, euint64 collateral, euint64 debt) external {
    require(msg.sender == lendingPool, "only pool");
    _pos[marketId][user] = Position(collateral, debt, true);
    FHE.allowThis(collateral);
    FHE.allowThis(debt);
    FHE.allow(collateral, user);
    FHE.allow(debt, user);
    emit PositionUpdated(marketId, user);
  }

  function getPosition(
    uint256 marketId,
    address user
  ) external view returns (euint64 collateral, euint64 debt, bool exists) {
    Position memory p = _pos[marketId][user];
    return (p.collateral, p.debt, p.exists);
  }
}
