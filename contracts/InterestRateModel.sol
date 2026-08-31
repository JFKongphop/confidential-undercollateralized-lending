// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, euint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface ICreditOracle {
  function bandOf(address user) external view returns (euint8);
  function hasScore(address user) external view returns (bool);
}

/// @title InterestRateModel — encrypted borrow rate from encrypted band (contract #3)
/// @notice Computes an ENCRYPTED borrow rate from the encrypted band + plaintext utilization.
///         The rate stays encrypted end-to-end so it cannot be inverted (rate -> premium ->
///         band -> score). Light compute; the design is the point.
contract InterestRateModel is ZamaEthereumConfig {
  ICreditOracle public creditOracle;
  address public admin;
  address public lendingPool;

  // last computed encrypted rate per user (production path), for later retrieval by the pool/user.
  mapping(address => euint32) private _rate;
  // last revealed rate per user (ATTACK DEMO path only) — its handle is publicly decryptable.
  mapping(address => euint32) private _revealedRate;

  uint32 internal constant BASE_BPS = 200; // 2%
  uint32 internal constant SLOPE_BPS = 1000; // utilization slope, applied to plaintext util
  // risk premium per band (plaintext table), selected by encrypted band:
  uint32 internal constant P1 = 1200;
  uint32 internal constant P2 = 800;
  uint32 internal constant P3 = 500;
  uint32 internal constant P4 = 250;
  uint32 internal constant P5 = 100;

  event RateComputed(address indexed user);

  constructor(address oracle) {
    admin = msg.sender;
    creditOracle = ICreditOracle(oracle);
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  function setLendingPool(address pool) external onlyAdmin {
    lendingPool = pool;
  }

  /// @notice Encrypted borrow rate (bps) for `user`. The result is ACL'd to the pool + user only,
  ///         and is NEVER made publicly decryptable — that is the leak.
  function rateFor(address user, uint256 utilizationBps) external returns (euint32) {
    require(creditOracle.hasScore(user), "no score");
    euint8 band = creditOracle.bandOf(user); // handle; this contract is ACL-granted from #1

    // plaintext part: base + slope*utilization (folded to one scalar).
    uint32 plainPart = BASE_BPS + uint32((SLOPE_BPS * utilizationBps) / 10000);

    // encrypted risk premium selected by band (nested select on plaintext premiums).
    euint32 premium = _premiumFor(band);

    euint32 rate = FHE.add(FHE.asEuint32(plainPart), premium); // rate is ENCRYPTED
    _rate[user] = rate;
    FHE.allowThis(rate);
    if (lendingPool != address(0)) {
      FHE.allow(rate, lendingPool);
    }
    FHE.allow(rate, user);
    emit RateComputed(user);
    return rate; // NEVER makePubliclyDecryptable — that is the leak
  }

  /// @notice Encrypted rate handle from the last `rateFor` call (ACL'd to pool + user only).
  function rateOf(address user) external view returns (euint32) {
    return _rate[user];
  }

  /// @notice Publicly-decryptable handle from the last `rateForRevealed` call (ATTACK DEMO only).
  function revealedRateHandleOf(address user) external view returns (bytes32) {
    return euint32.unwrap(_revealedRate[user]);
  }

  /// @notice ATTACK DEMO ONLY — identical rate but made publicly decryptable. A companion script
  ///         inverts the public rate back to premium -> band -> score. Proves why the production
  ///         path (`rateFor`) must keep the rate encrypted. Do not use in production.
  function rateForRevealed(address user, uint256 utilizationBps) external returns (euint32) {
    require(creditOracle.hasScore(user), "no score");
    euint8 band = creditOracle.bandOf(user);
    uint32 plainPart = BASE_BPS + uint32((SLOPE_BPS * utilizationBps) / 10000);
    euint32 rate = FHE.add(FHE.asEuint32(plainPart), _premiumFor(band));
    _revealedRate[user] = rate;
    FHE.allowThis(rate);
    FHE.makePubliclyDecryptable(rate); // THE LEAK — intentional, for the demo
    return rate;
  }

  function _premiumFor(euint8 band) internal returns (euint32) {
    return
      FHE.select(
        FHE.eq(band, FHE.asEuint8(5)),
        FHE.asEuint32(P5),
        FHE.select(
          FHE.eq(band, FHE.asEuint8(4)),
          FHE.asEuint32(P4),
          FHE.select(
            FHE.eq(band, FHE.asEuint8(3)),
            FHE.asEuint32(P3),
            FHE.select(FHE.eq(band, FHE.asEuint8(2)), FHE.asEuint32(P2), FHE.asEuint32(P1))
          )
        )
      );
  }
}
