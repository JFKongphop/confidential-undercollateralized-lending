// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title MockConfidentialUSDT — ERC-7984 confidential token for lending tests
/// @notice Direct-mint (no underlying wrapper) so tests can fund wallets without an inputProof.
contract MockConfidentialUSDT is ZamaEthereumConfig, ERC7984 {
  constructor() ERC7984("Mock Confidential USDT", "cUSDT", "") {}

  /// @notice Mint `amount` tokens to `to`. Test helper only.
  function mint(address to, uint64 amount) external {
    _mint(to, FHE.asEuint64(amount));
  }
}
