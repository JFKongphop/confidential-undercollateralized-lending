// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink aggregator interface (subset used here).
interface AggregatorV3Interface {
  function decimals() external view returns (uint8);

  function latestRoundData()
    external
    view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

  function getRoundData(
    uint80 _roundId
  ) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Price feed consumed by LendingPool. `price()` is normalized to `PRICE_SCALE` (small
///         fixed-point) so it can be used directly as a plaintext scalar in the encrypted health
///         check; `getCurrentPrice()` exposes the raw Chainlink answer for display/other consumers.
interface IPriceOracle {
  function price() external view returns (uint256);

  function PRICE_SCALE() external view returns (uint256);
}

/// @title OracleAdapter — Chainlink ETH/USD wrapper with a staleness guard
/// @notice Wraps a Chainlink AggregatorV3Interface. Exposes the raw 8-decimal answer
///         (`getCurrentPrice`, `getPriceAtRound`) AND a normalized `price()` the pool uses as a
///         plaintext scalar. The feed defaults to the canonical Sepolia ETH/USD feed but is
///         injectable so local/mock networks (no feed at the canonical address) stay testable.
contract OracleAdapter is IPriceOracle {
  /// @dev Canonical Chainlink ETH/USD feed on Sepolia (used when the constructor gets address(0)).
  address public constant SEPOLIA_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

  AggregatorV3Interface public immutable priceFeed;

  uint256 public constant override PRICE_SCALE = 100; // 2-decimal fixed point (pool scalar)
  uint256 public immutable stalenessThreshold; // max age before a price is rejected

  /// @param feed_ the aggregator address; pass address(0) to use the canonical Sepolia ETH/USD feed.
  /// @param stalenessThreshold_ max price age in seconds; pass 0 to default to 1 hour. Set higher
  ///        for slow-updating testnet feeds so a demo doesn't revert on a lagging heartbeat.
  constructor(address feed_, uint256 stalenessThreshold_) {
    priceFeed = AggregatorV3Interface(feed_ == address(0) ? SEPOLIA_ETH_USD : feed_);
    stalenessThreshold = stalenessThreshold_ == 0 ? 1 hours : stalenessThreshold_;
  }

  /// @notice Latest price at the feed's native precision (Chainlink ETH/USD = 8 decimals).
  ///         Reverts on a non-positive or stale answer.
  function getCurrentPrice() public view returns (uint256) {
    (, int256 answer, , uint256 updatedAt, ) = priceFeed.latestRoundData();
    require(answer > 0, "Invalid price");
    require(block.timestamp - updatedAt < stalenessThreshold, "Price feed stale");
    return uint256(answer);
  }

  /// @notice Price recorded at a specific Chainlink round (native precision).
  function getPriceAtRound(uint80 roundId) external view returns (uint256) {
    (, int256 answer, , , ) = priceFeed.getRoundData(roundId);
    require(answer > 0, "Invalid price");
    return uint256(answer);
  }

  /// @notice Latest price normalized to PRICE_SCALE — the FHE-safe scalar the pool consumes.
  function price() external view override returns (uint256) {
    uint8 dec = priceFeed.decimals();
    return (getCurrentPrice() * PRICE_SCALE) / (10 ** dec);
  }
}
