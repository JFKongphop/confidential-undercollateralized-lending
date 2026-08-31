// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title GuarantorModule — encrypted per-market third-party backing (contract #8)
/// @notice A third party posts encrypted collateral-equivalent backing for a borrower in a
///         specific market, lifting their effective limit, without revealing who backed whom or
///         for how much. Compute is trivial (`FHE.add`); the difficulty is ACL scoping.
///
/// Confidentiality invariants:
///  - The per-market AGGREGATE is granted to the pool ONLY — not the borrower, not other guarantors.
///  - Each guarantor is granted decrypt on THEIR OWN contribution only.
///  - Events carry no amounts and no guarantor<->borrower linkage.
contract GuarantorModule is ZamaEthereumConfig {
  mapping(uint256 => mapping(address => euint64)) private _stake; // market => borrower => aggregate
  mapping(uint256 => mapping(address => bool)) public hasStake;

  address public admin;
  address public lendingPool;

  event Guaranteed(uint256 indexed marketId, address indexed borrower);

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

  /// @notice Back `borrower` in `marketId` with an encrypted amount (in that market's collateral
  ///         units). The aggregate is readable by the pool only; the caller decrypts only their own.
  function guarantee(uint256 marketId, address borrower, externalEuint64 encAmount, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(encAmount, proof);

    if (hasStake[marketId][borrower]) {
      _stake[marketId][borrower] = FHE.add(_stake[marketId][borrower], amount);
    } else {
      _stake[marketId][borrower] = amount;
    }
    hasStake[marketId][borrower] = true;

    FHE.allowThis(_stake[marketId][borrower]);
    if (lendingPool != address(0)) {
      FHE.allow(_stake[marketId][borrower], lendingPool); // pool reads the AGGREGATE only
    }
    FHE.allow(amount, msg.sender); // guarantor sees ONLY their own contribution
    emit Guaranteed(marketId, borrower);
  }

  /// @notice Aggregate backing handle for `borrower` in `marketId` (pool is ACL-granted only).
  function stakeFor(uint256 marketId, address borrower) external view returns (euint64) {
    return _stake[marketId][borrower];
  }
}
