// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, eaddress, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title LiquidationAuction — sealed-bid auction on ciphertext, multi-asset (contract #7)
/// @notice Liquidators submit ENCRYPTED bids; the winner is selected on ciphertext (running max
///         via FHE.select); only the outcome is revealed at settle, when the seized collateral
///         (held here as the market's collateral token) is transferred to the winning liquidator.
///         A losing bidder is NEVER granted decrypt on the running max.
contract LiquidationAuction is ZamaEthereumConfig {
  struct Auction {
    euint64 highest;
    eaddress winner;
    euint64 prize; // seized collateral, held here as `collToken`
    address collToken; // which asset the prize is denominated in
    bool open;
    bool settled;
    bytes32 winnerHandle;
    bytes32 highestHandle;
  }

  mapping(uint256 => Auction) private _auctions;
  uint256 private _nextAuction;

  address public admin;
  address public liquidationEngine;

  event AuctionOpened(uint256 id);
  event BidPlaced(uint256 id);
  event AuctionSettleRequested(uint256 id, bytes32 highestHandle, bytes32 winnerHandle);
  event AuctionSettled(uint256 id, address winner, uint64 amount);

  constructor() {
    admin = msg.sender;
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  modifier onlyEngineOrAdmin() {
    require(msg.sender == liquidationEngine || msg.sender == admin, "only engine");
    _;
  }

  function setLiquidationEngine(address engine) external onlyAdmin {
    liquidationEngine = engine;
  }

  /// @notice Open a sealed-bid auction with a seized-collateral `prize` (ACL'd to this contract),
  ///         denominated in `collToken`.
  function open(address /* debtor */, euint64 prize, address collToken) external onlyEngineOrAdmin returns (uint256 id) {
    id = _openInternal(collToken);
    _auctions[id].prize = prize;
    FHE.allowThis(_auctions[id].prize);
  }

  /// @notice Open a prize-less auction (focused tests). Prize defaults to encrypted 0.
  function open(address /* debtor */, address collToken) external onlyEngineOrAdmin returns (uint256 id) {
    id = _openInternal(collToken);
    _auctions[id].prize = FHE.asEuint64(0);
    FHE.allowThis(_auctions[id].prize);
  }

  function _openInternal(address collToken) internal returns (uint256 id) {
    id = _nextAuction++;
    Auction storage a = _auctions[id];
    a.highest = FHE.asEuint64(0);
    a.winner = FHE.asEaddress(address(0));
    a.collToken = collToken;
    a.open = true;
    FHE.allowThis(a.highest);
    FHE.allowThis(a.winner);
    emit AuctionOpened(id);
  }

  /// @notice Submit an encrypted bid. Updates the encrypted running max + encrypted winner.
  ///         The bidder may decrypt only their OWN bid — never the standing high bid.
  function bid(uint256 id, externalEuint64 encBid, bytes calldata proof) external {
    Auction storage a = _auctions[id];
    require(a.open, "closed");
    euint64 b = FHE.fromExternal(encBid, proof);

    ebool higher = FHE.gt(b, a.highest);
    a.highest = FHE.select(higher, b, a.highest); // running max
    a.winner = FHE.select(higher, FHE.asEaddress(msg.sender), a.winner); // encrypted winner

    FHE.allowThis(a.highest);
    FHE.allowThis(a.winner);
    FHE.allow(b, msg.sender); // bidder sees their OWN bid only — never others'
    emit BidPlaced(id);
  }

  /// @notice Close bidding and mark the winner + amount publicly decryptable (Form-B reveal).
  function settle(uint256 id) external onlyEngineOrAdmin returns (uint256) {
    Auction storage a = _auctions[id];
    require(a.open, "closed");
    a.open = false;

    FHE.makePubliclyDecryptable(a.highest);
    FHE.makePubliclyDecryptable(a.winner);
    a.highestHandle = euint64.unwrap(a.highest);
    a.winnerHandle = eaddress.unwrap(a.winner);

    emit AuctionSettleRequested(id, a.highestHandle, a.winnerHandle);
    return id;
  }

  /// @notice Form-B fulfill: verify the revealed winner + amount, then transfer the seized
  ///         collateral to the winning liquidator.
  function fulfillSettle(uint256 id, bytes calldata cleartexts, bytes calldata proof) external {
    Auction storage a = _auctions[id];
    require(!a.open && a.winnerHandle != bytes32(0), "not settling");
    require(!a.settled, "settled");

    bytes32[] memory h = new bytes32[](2);
    h[0] = a.highestHandle;
    h[1] = a.winnerHandle;
    FHE.checkSignatures(h, cleartexts, proof);
    (uint64 amount, address winner) = abi.decode(cleartexts, (uint64, address));

    a.settled = true;

    if (winner != address(0)) {
      FHE.allowTransient(a.prize, a.collToken);
      IERC7984(a.collToken).confidentialTransfer(winner, a.prize); // seized collateral -> winner
    }
    emit AuctionSettled(id, winner, amount);
  }

  function auctionInfo(uint256 id) external view returns (bool isOpen, bytes32 highestHandle, bytes32 winnerHandle) {
    Auction storage a = _auctions[id];
    return (a.open, a.highestHandle, a.winnerHandle);
  }
}
