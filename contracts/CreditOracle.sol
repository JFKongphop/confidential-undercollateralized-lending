// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, euint32, euint8, externalEuint64, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IRepaymentTracker {
  function reputationOf(address user) external view returns (euint32);
  function hasReputation(address user) external view returns (bool);
}

/// @title CreditOracle — encrypted credit scoring, the heavy-compute centerpiece (contract #1)
/// @notice Turns a borrower's encrypted financial inputs into an encrypted credit score and an
///         encrypted risk band (1 worst .. 5 best), consumed by LendingPool and InterestRateModel.
///         Nothing is ever decrypted here. Every weight/threshold is a plaintext scalar.
contract CreditOracle is ZamaEthereumConfig {
  // ── Encrypted state ────────────────────────────────────────────────────────
  mapping(address => euint32) private _score; // raw weighted score
  mapping(address => euint8) private _band; // 1 (worst) .. 5 (best)
  mapping(address => bool) public hasScore;

  // private credit-report breakdown — per-component contributions to the score, ACL'd to the
  // borrower ONLY. Lets the borrower decrypt "balance +X, age +Y, history +Z" as a private credit
  // report that nobody else (not the pool, not the rate model, not an onlooker) can read.
  mapping(address => euint32) private _balContribution;
  mapping(address => euint32) private _ageContribution;
  mapping(address => euint32) private _repContribution;

  // ── Plaintext wiring ───────────────────────────────────────────────────────
  IRepaymentTracker public repTracker; // source of encrypted reputation
  address public admin;
  address public lendingPool;
  address public rateModel;

  // ── Plaintext scoring config (governance-set, fully public — this is fine) ──
  uint32 internal constant W_BALANCE = 40;
  uint32 internal constant W_AGE = 20;
  uint32 internal constant W_REP = 40;
  uint32 internal constant NORM = 100; // plaintext divisor
  uint32 internal constant T2 = 200;
  uint32 internal constant T3 = 400;
  uint32 internal constant T4 = 600;
  uint32 internal constant T5 = 800;

  event ScoreUpdated(address indexed user);

  constructor(address repTracker_) {
    admin = msg.sender;
    repTracker = IRepaymentTracker(repTracker_);
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  function setLendingPool(address pool) external onlyAdmin {
    lendingPool = pool;
  }

  function setRateModel(address model) external onlyAdmin {
    rateModel = model;
  }

  /// @notice Submit encrypted proof-of-funds + pre-bucketed account age; compute score + band.
  /// @param encBalances aggregate balance proof-of-funds (encrypted)
  /// @param encAgeScore position/account age, pre-bucketed client-side (encrypted)
  /// @param inputProof  single proof binding both external handles
  function submitInputs(
    externalEuint64 encBalances,
    externalEuint32 encAgeScore,
    bytes calldata inputProof
  ) external {
    euint64 balances = FHE.fromExternal(encBalances, inputProof);
    euint32 age = FHE.fromExternal(encAgeScore, inputProof);

    // rep handle (oracle must be ACL-granted by RepaymentTracker); zero on cold-start.
    euint32 rep = repTracker.hasReputation(msg.sender) ? repTracker.reputationOf(msg.sender) : FHE.asEuint32(0);

    // scale balances into a comparable band — plaintext divisor OK.
    euint32 balScore = FHE.asEuint32(FHE.div(balances, uint64(1e6)));

    // weighted sum — every weight is a PLAINTEXT scalar (cheap ct*pt muls).
    euint32 raw = FHE.add(FHE.add(FHE.mul(balScore, W_BALANCE), FHE.mul(age, W_AGE)), FHE.mul(rep, W_REP));
    euint32 score = FHE.div(raw, NORM); // plaintext divisor OK

    // private credit-report breakdown: normalized per-component contributions (sum ~= score,
    // modulo integer-division rounding). Stored + ACL'd to the borrower ONLY.
    euint32 balC = FHE.div(FHE.mul(balScore, W_BALANCE), NORM);
    euint32 ageC = FHE.div(FHE.mul(age, W_AGE), NORM);
    euint32 repC = FHE.div(FHE.mul(rep, W_REP), NORM);
    _balContribution[msg.sender] = balC;
    _ageContribution[msg.sender] = ageC;
    _repContribution[msg.sender] = repC;
    FHE.allowThis(balC);
    FHE.allow(balC, msg.sender);
    FHE.allowThis(ageC);
    FHE.allow(ageC, msg.sender);
    FHE.allowThis(repC);
    FHE.allow(repC, msg.sender);

    // band via nested select against PLAINTEXT thresholds (no branching on ciphertext).
    euint8 band = FHE.select(
      FHE.ge(score, FHE.asEuint32(T5)),
      FHE.asEuint8(5),
      FHE.select(
        FHE.ge(score, FHE.asEuint32(T4)),
        FHE.asEuint8(4),
        FHE.select(
          FHE.ge(score, FHE.asEuint32(T3)),
          FHE.asEuint8(3),
          FHE.select(FHE.ge(score, FHE.asEuint32(T2)), FHE.asEuint8(2), FHE.asEuint8(1))
        )
      )
    );

    _score[msg.sender] = score;
    _band[msg.sender] = band;
    hasScore[msg.sender] = true;

    // ACL: self + this + the two consumers. Score stays user-only (breakdown UX);
    // pool + rate model work off the band handle.
    FHE.allowThis(score);
    FHE.allowThis(band);
    FHE.allow(score, msg.sender);
    FHE.allow(band, msg.sender);
    if (lendingPool != address(0)) {
      FHE.allow(band, lendingPool); // pool needs the band for the ratio select
    }
    if (rateModel != address(0)) {
      FHE.allow(band, rateModel); // rate model needs it for the premium
    }
    emit ScoreUpdated(msg.sender); // no values in event — nothing to leak
  }

  /// @notice Encrypted risk band handle (consumers must be ACL-granted from submitInputs).
  function bandOf(address user) external view returns (euint8) {
    return _band[user];
  }

  /// @notice Encrypted raw score handle (user-only; for a private credit-report breakdown UX).
  function scoreOf(address user) external view returns (euint32) {
    return _score[user];
  }

  /// @notice Private credit-report breakdown — the three encrypted score contributions
  ///         (balance, age, history). ACL'd to the borrower only; a private credit report.
  function scoreBreakdown(
    address user
  ) external view returns (euint32 balance, euint32 age, euint32 history) {
    return (_balContribution[user], _ageContribution[user], _repContribution[user]);
  }
}
