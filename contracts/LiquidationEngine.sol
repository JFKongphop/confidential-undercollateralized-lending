// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface ILendingPool {
  function isLiquidatable(uint256 marketId, address user) external returns (ebool);
  function seize(uint256 marketId, address user) external returns (euint64);
  function collateralTokenOf(uint256 marketId) external view returns (address);
}

interface ILiquidationAuction {
  function open(address debtor, euint64 prize, address collToken) external returns (uint256);
}

/// @title LiquidationEngine — reveal-only-at-trigger, anti-MEV, multi-market (contract #6)
/// @notice Reveals liquidation eligibility ONLY at the true trigger via the Form-B
///         request/fulfill flow, per market. On a confirmed liquidation it seizes the debtor's
///         collateral (via the pool) and opens a sealed-bid auction for it.
contract LiquidationEngine is ZamaEthereumConfig {
  struct LiqRequest {
    uint256 marketId;
    address user;
    bytes32 flagHandle;
    bool pending;
  }

  mapping(uint256 => LiqRequest) public pendingLiquidations;
  uint256 private _nextId;

  ILendingPool public pool; // authoritative health + seizure source
  ILiquidationAuction public auction;
  address public admin;

  // ── Epoch batching for metadata (timing) privacy ────────────────────────────
  uint256 public epochLength = 1 hours;
  uint256 public lastProcessedEpoch;

  event LiquidationRequested(uint256 indexed marketId, address indexed user, uint256 id);
  event Liquidated(uint256 indexed marketId, address indexed user, uint256 id, uint256 auctionId);
  event NotLiquidatable(uint256 indexed marketId, address indexed user, uint256 id);
  event EpochProcessed(uint256 indexed epoch, uint256 count);

  constructor() {
    admin = msg.sender;
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  function setAuction(address a) external onlyAdmin {
    auction = ILiquidationAuction(a);
  }

  function setPool(address p) external onlyAdmin {
    pool = ILendingPool(p);
  }

  function setEpochLength(uint256 secondsPerEpoch) external onlyAdmin {
    require(secondsPerEpoch > 0, "zero epoch");
    epochLength = secondsPerEpoch;
  }

  function currentEpoch() public view returns (uint256) {
    return block.timestamp / epochLength;
  }

  /// @notice Batched, epoch-gated liquidation check (the metadata-privacy path). Checks a whole
  ///         set of borrowers in `marketId` uniformly at an epoch boundary — at most one batch per
  ///         epoch — so the timing of any single borrower's near-liquidation does not leak.
  function requestLiquidationBatch(
    uint256 marketId,
    address[] calldata users
  ) external returns (uint256[] memory ids) {
    uint256 epoch = currentEpoch();
    require(epoch > lastProcessedEpoch, "epoch not elapsed");
    lastProcessedEpoch = epoch;

    ids = new uint256[](users.length);
    for (uint256 i = 0; i < users.length; i++) {
      ids[i] = _record(marketId, users[i]);
    }
    emit EpochProcessed(epoch, users.length);
  }

  /// @notice Ask whether `user` is liquidatable in `marketId`; marks the encrypted flag publicly
  ///         decryptable and stores its handle. Nothing is revealed until fulfill.
  function requestLiquidation(uint256 marketId, address user) external returns (uint256 id) {
    return _record(marketId, user);
  }

  function _record(uint256 marketId, address user) internal returns (uint256 id) {
    ebool liq = pool.isLiquidatable(marketId, user); // authoritative health, ACL-granted to engine
    FHE.makePubliclyDecryptable(liq);
    id = _nextId++;
    pendingLiquidations[id] = LiqRequest(marketId, user, ebool.unwrap(liq), true);
    emit LiquidationRequested(marketId, user, id);
  }

  /// @notice Permissionless callback: verify the decrypted flag, then act. On a confirmed
  ///         liquidation, seize collateral and open the sealed-bid auction for it.
  function fulfillLiquidation(uint256 id, bytes calldata cleartexts, bytes calldata proof) external {
    LiqRequest memory r = pendingLiquidations[id];
    require(r.pending, "unknown");

    bytes32[] memory h = new bytes32[](1);
    h[0] = r.flagHandle;
    FHE.checkSignatures(h, cleartexts, proof);
    bool isLiq = abi.decode(cleartexts, (bool));

    delete pendingLiquidations[id];

    if (isLiq) {
      euint64 seized = pool.seize(r.marketId, r.user);
      uint256 auctionId = auction.open(r.user, seized, pool.collateralTokenOf(r.marketId));
      emit Liquidated(r.marketId, r.user, id, auctionId);
    } else {
      emit NotLiquidatable(r.marketId, r.user, id);
    }
  }
}
