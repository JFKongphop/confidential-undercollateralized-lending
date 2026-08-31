// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface, IPriceOracle} from "./OracleAdapter.sol";

/// @title PairPriceOracle — cross-rate of two Chainlink USD feeds
/// @notice Prices 1 collateral unit in DEBT units by combining two USD feeds:
///         price = (collateral/USD) / (debt/USD). Lets a market pair arbitrary assets (the debt
///         asset need not be USD-pegged), e.g. cWETH -> cWBTC via ETH/USD and BTC/USD.
///         Implements the same IPriceOracle interface the pool consumes — no pool changes needed.
///         Uses a finer PRICE_SCALE (1e6) than the single-feed adapter so small cross-rates
///         (e.g. 1 LINK in ETH units) don't round to zero.
contract PairPriceOracle is IPriceOracle {
  AggregatorV3Interface public immutable collateralFeed; // e.g. ETH/USD
  AggregatorV3Interface public immutable debtFeed; // e.g. BTC/USD

  uint256 public constant override PRICE_SCALE = 1e6; // 6-decimal fixed point
  uint256 public immutable stalenessThreshold;

  constructor(address collateralFeed_, address debtFeed_, uint256 stalenessThreshold_) {
    require(collateralFeed_ != address(0) && debtFeed_ != address(0), "zero feed");
    collateralFeed = AggregatorV3Interface(collateralFeed_);
    debtFeed = AggregatorV3Interface(debtFeed_);
    stalenessThreshold = stalenessThreshold_ == 0 ? 1 hours : stalenessThreshold_;
  }

  function _read(AggregatorV3Interface feed) internal view returns (uint256 answer, uint8 dec) {
    (, int256 a, , uint256 updatedAt, ) = feed.latestRoundData();
    require(a > 0, "Invalid price");
    require(block.timestamp - updatedAt < stalenessThreshold, "Price feed stale");
    return (uint256(a), feed.decimals());
  }

  /// @notice Price of 1 collateral unit in debt units, scaled by PRICE_SCALE.
  function price() external view override returns (uint256) {
    (uint256 c, uint8 cDec) = _read(collateralFeed);
    (uint256 d, uint8 dDec) = _read(debtFeed);
    // (c / 10^cDec) / (d / 10^dDec) * PRICE_SCALE
    return (c * (10 ** dDec) * PRICE_SCALE) / (d * (10 ** cDec));
  }
}
