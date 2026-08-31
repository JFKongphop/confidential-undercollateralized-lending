// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAggregator — Chainlink-compatible price feed for local/tests
/// @notice Lets tests set the answer and the `updatedAt` timestamp (to exercise the staleness
///         guard in OracleAdapter). Not for production.
contract MockAggregator {
  int256 public answer;
  uint8 public decimals;
  uint256 public updatedAt;

  constructor(int256 answer_, uint8 decimals_) {
    answer = answer_;
    decimals = decimals_;
    updatedAt = block.timestamp;
  }

  function setAnswer(int256 answer_) external {
    answer = answer_;
    updatedAt = block.timestamp;
  }

  function setUpdatedAt(uint256 updatedAt_) external {
    updatedAt = updatedAt_;
  }

  function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
    return (1, answer, updatedAt, updatedAt, 1);
  }

  function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
    return (roundId, answer, updatedAt, updatedAt, roundId);
  }
}
