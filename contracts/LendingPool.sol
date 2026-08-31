// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, euint32, euint8, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";

interface ICreditOracle {
  function bandOf(address user) external view returns (euint8);
  function hasScore(address user) external view returns (bool);
}

interface IPositionManager {
  function updatePosition(uint256 marketId, address user, euint64 collateral, euint64 debt) external;
}

interface IRepaymentTracker {
  function recordRepayment(address user, ebool onTime) external;
  function reputationOf(address user) external view returns (euint32);
  function hasReputation(address user) external view returns (bool);
}

interface IGuarantorModule {
  function stakeFor(uint256 marketId, address borrower) external view returns (euint64);
  function hasStake(uint256 marketId, address borrower) external view returns (bool);
}

interface IInterestRateModel {
  function rateFor(address user, uint256 utilizationBps) external returns (euint32);
}

interface IPriceOracle {
  function price() external view returns (uint256);
  function PRICE_SCALE() external view returns (uint256);
}

interface IComplianceViewer {
  function grantAuditAccess(euint64 handle, address auditor) external;
}

/// @title LendingPool — multi-market confidential loan loop (contract #4)
/// @notice Isolated markets, each pairing a collateral asset with a debt asset priced by an oracle.
///         Borrow against the encrypted credit band with a dynamic collateral ratio; collateral is
///         valued against debt via the market's price oracle; interest accrues on ciphertext
///         (overflow-clamped); liquidation seizes and auctions the real collateral. The pool never
///         learns the score/band/amounts in plaintext.
contract LendingPool is ZamaEthereumConfig, IERC7984Receiver {
  struct Market {
    IERC7984 collateralToken;
    IERC7984 debtToken;
    IPriceOracle oracle; // price of 1 collateral unit in debt units (scaled by oracle.PRICE_SCALE)
    uint64 lltvBps; // liquidation threshold for this market
    bool exists;
  }

  Market[] public markets;

  mapping(uint256 => mapping(address => euint64)) private _collateral; // market => user => collateral
  mapping(uint256 => mapping(address => euint64)) private _debt;
  mapping(uint256 => mapping(address => euint32)) private _userRate; // encrypted borrow rate (bps)
  mapping(uint256 => mapping(address => uint256)) public lastAccrual;

  ICreditOracle public creditOracle;
  IPositionManager public positions;
  IRepaymentTracker public repTracker;
  IGuarantorModule public guarantor;
  IInterestRateModel public rateModel;
  address public admin;
  address public liquidationEngine;
  address public liquidationAuction;

  uint256 public utilizationBps = 5_000;
  uint64 internal constant SECONDS_PER_YEAR = 365 days;
  // KILLER FEATURE — reputation-unlocked credit line: encrypted reputation becomes an unsecured
  // borrowing allowance (in debt units), so a borrower with a proven private repayment history can
  // borrow BELOW 100% collateral. The line also counts as backing for health, so reputation itself
  // is the collateral — and shrinks (decays) on a missed repayment.
  uint64 internal constant CREDIT_PER_REP = 10;

  // plaintext ratio table (percent), selected by encrypted band:
  uint64 internal constant R1 = 200;
  uint64 internal constant R2 = 160;
  uint64 internal constant R3 = 140;
  uint64 internal constant R4 = 125;
  uint64 internal constant R5 = 110;

  event MarketAdded(uint256 indexed marketId, address collateralToken, address debtToken);
  event Deposited(uint256 indexed marketId, address indexed user);
  event Borrowed(uint256 indexed marketId, address indexed user);
  event Repaid(uint256 indexed marketId, address indexed user);
  event Accrued(uint256 indexed marketId, address indexed user);
  event Seized(uint256 indexed marketId, address indexed user);

  constructor() {
    admin = msg.sender;
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  // ── Configuration ───────────────────────────────────────────────────────────
  function addMarket(
    address collateralToken,
    address debtToken,
    address oracle,
    uint64 lltvBps
  ) external onlyAdmin returns (uint256 marketId) {
    require(collateralToken != address(0) && debtToken != address(0) && oracle != address(0), "zero addr");
    require(lltvBps > 0 && lltvBps < 10_000, "bad lltv");
    markets.push(Market(IERC7984(collateralToken), IERC7984(debtToken), IPriceOracle(oracle), lltvBps, true));
    marketId = markets.length - 1;
    emit MarketAdded(marketId, collateralToken, debtToken);
  }

  function setCreditOracle(address o) external onlyAdmin {
    creditOracle = ICreditOracle(o);
  }

  function setPositions(address p) external onlyAdmin {
    positions = IPositionManager(p);
  }

  function setRepaymentTracker(address r) external onlyAdmin {
    repTracker = IRepaymentTracker(r);
  }

  function setGuarantor(address g) external onlyAdmin {
    guarantor = IGuarantorModule(g);
  }

  function setRateModel(address r) external onlyAdmin {
    rateModel = IInterestRateModel(r);
  }

  function setUtilizationBps(uint256 u) external onlyAdmin {
    utilizationBps = u;
  }

  function setLiquidationEngine(address e) external onlyAdmin {
    liquidationEngine = e;
  }

  function setLiquidationAuction(address a) external onlyAdmin {
    liquidationAuction = a;
  }

  // ── Deposit — collateral-token receiver callback (marketId encoded in `data`) ─
  function onConfidentialTransferReceived(
    address /* operator */,
    address from,
    euint64 amount,
    bytes calldata data
  ) external override returns (ebool) {
    uint256 marketId = abi.decode(data, (uint256));
    require(msg.sender == address(markets[marketId].collateralToken), "only collateral token");

    if (FHE.isInitialized(_collateral[marketId][from])) {
      _collateral[marketId][from] = FHE.add(_collateral[marketId][from], amount);
    } else {
      _collateral[marketId][from] = amount;
    }
    FHE.allowThis(_collateral[marketId][from]);
    FHE.allow(_collateral[marketId][from], from);

    emit Deposited(marketId, from);

    ebool ok = FHE.asEbool(true);
    FHE.allowTransient(ok, msg.sender);
    return ok;
  }

  // ── Borrow — dynamic ratio, oracle-valued, branch-free ──────────────────────
  function borrow(uint256 marketId, externalEuint64 encAmount, bytes calldata proof) external {
    Market storage mk = markets[marketId];
    require(mk.exists, "no market");
    require(creditOracle.hasScore(msg.sender), "no score");
    _accrue(marketId, msg.sender);

    euint64 amount = FHE.fromExternal(encAmount, proof);
    euint64 ratio = _ratioFor(creditOracle.bandOf(msg.sender));

    // required collateral value (debt units) = amount * ratio / 100 (the one ct*ct mul).
    euint64 required = FHE.div(FHE.mul(amount, ratio), 100);
    // effective backing = oracle-valued collateral + reputation-unlocked credit line (debt units).
    // The credit line lets a trusted borrower go BELOW 100% collateral (true undercollateralization).
    euint64 effBacking = FHE.add(_valued(marketId, _backing(marketId, msg.sender)), _creditLine(msg.sender));

    ebool ok = FHE.ge(effBacking, required);
    euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));

    _debt[marketId][msg.sender] = FHE.isInitialized(_debt[marketId][msg.sender])
      ? FHE.add(_debt[marketId][msg.sender], actual)
      : actual;

    if (address(rateModel) != address(0)) {
      euint32 rate = rateModel.rateFor(msg.sender, utilizationBps);
      _userRate[marketId][msg.sender] = rate;
      FHE.allowThis(rate);
      FHE.allow(rate, msg.sender);
    }
    lastAccrual[marketId][msg.sender] = block.timestamp;

    euint64 backing = _backing(marketId, msg.sender);
    FHE.allowThis(backing);
    FHE.allowThis(_debt[marketId][msg.sender]);
    if (address(positions) != address(0)) {
      FHE.allow(backing, address(positions));
      FHE.allow(_debt[marketId][msg.sender], address(positions));
      positions.updatePosition(marketId, msg.sender, backing, _debt[marketId][msg.sender]);
    }

    FHE.allowTransient(actual, address(mk.debtToken));
    mk.debtToken.confidentialTransfer(msg.sender, actual);

    FHE.allow(_debt[marketId][msg.sender], msg.sender);
    emit Borrowed(marketId, msg.sender);
  }

  // ── Repay — updates reputation ──────────────────────────────────────────────
  function repay(uint256 marketId, externalEuint64 encAmount, bytes calldata proof, bool onTimePlaintext) external {
    require(FHE.isInitialized(_debt[marketId][msg.sender]), "no debt");
    _accrue(marketId, msg.sender);

    euint64 amount = FHE.fromExternal(encAmount, proof);
    euint64 pay = FHE.select(FHE.ge(_debt[marketId][msg.sender], amount), amount, _debt[marketId][msg.sender]);

    _debt[marketId][msg.sender] = FHE.sub(_debt[marketId][msg.sender], pay);
    FHE.allowThis(_debt[marketId][msg.sender]);
    FHE.allow(_debt[marketId][msg.sender], msg.sender);

    FHE.allowTransient(pay, address(markets[marketId].debtToken));
    markets[marketId].debtToken.confidentialTransferFrom(msg.sender, address(this), pay);

    ebool onTime = FHE.asEbool(onTimePlaintext);
    if (address(repTracker) != address(0)) {
      FHE.allowTransient(onTime, address(repTracker));
      repTracker.recordRepayment(msg.sender, onTime);
    }
    emit Repaid(marketId, msg.sender);
  }

  // ── Interest accrual — overflow-clamped ─────────────────────────────────────
  /// @notice Accrue simple interest on `user`'s encrypted debt in `marketId` since the last
  ///         checkpoint: interest = debt * rate_bps * elapsed / (10000 * SECONDS_PER_YEAR). If the
  ///         accrued debt would wrap `euint64` below the prior debt, it is clamped to the prior
  ///         debt (never lets an overflow silently erase a loan).
  function accrue(uint256 marketId, address user) public {
    _accrue(marketId, user);
  }

  function _accrue(uint256 marketId, address user) internal {
    if (!FHE.isInitialized(_debt[marketId][user])) {
      lastAccrual[marketId][user] = block.timestamp;
      return;
    }
    uint256 elapsed = block.timestamp - lastAccrual[marketId][user];
    lastAccrual[marketId][user] = block.timestamp;
    if (elapsed == 0 || !FHE.isInitialized(_userRate[marketId][user])) {
      return;
    }

    euint64 debt = _debt[marketId][user];
    euint64 rate64 = FHE.asEuint64(_userRate[marketId][user]);
    euint64 rateTimesTime = FHE.mul(rate64, uint64(elapsed)); // ct*pt
    euint64 interest = FHE.div(FHE.mul(debt, rateTimesTime), uint64(10_000) * SECONDS_PER_YEAR);
    euint64 grown = FHE.add(debt, interest);

    // overflow clamp: a wrapped sum (grown < debt) is rejected, keeping the prior debt.
    ebool overflowed = FHE.lt(grown, debt);
    _debt[marketId][user] = FHE.select(overflowed, debt, grown);
    FHE.allowThis(_debt[marketId][user]);
    FHE.allow(_debt[marketId][user], user);
    emit Accrued(marketId, user);
  }

  // ── Encrypted health (authoritative; live debt incl. accrued interest) ──────
  function _ratioFor(euint8 band) internal returns (euint64) {
    return
      FHE.select(
        FHE.eq(band, FHE.asEuint8(5)),
        FHE.asEuint64(R5),
        FHE.select(
          FHE.eq(band, FHE.asEuint8(4)),
          FHE.asEuint64(R4),
          FHE.select(
            FHE.eq(band, FHE.asEuint8(3)),
            FHE.asEuint64(R3),
            FHE.select(FHE.eq(band, FHE.asEuint8(2)), FHE.asEuint64(R2), FHE.asEuint64(R1))
          )
        )
      );
  }

  function _backing(uint256 marketId, address user) internal returns (euint64) {
    euint64 coll = FHE.isInitialized(_collateral[marketId][user]) ? _collateral[marketId][user] : FHE.asEuint64(0);
    euint64 stake = (address(guarantor) != address(0) && guarantor.hasStake(marketId, user))
      ? guarantor.stakeFor(marketId, user)
      : FHE.asEuint64(0);
    return FHE.add(coll, stake);
  }

  /// @dev Value a collateral-unit amount in debt units via the market oracle (ct*pt, then ct/pt).
  function _valued(uint256 marketId, euint64 collAmount) internal returns (euint64) {
    IPriceOracle o = markets[marketId].oracle;
    uint64 p = uint64(o.price());
    uint64 scale = uint64(o.PRICE_SCALE());
    return FHE.div(FHE.mul(collAmount, p), scale);
  }

  /// @dev Reputation-unlocked credit line (debt units): an unsecured allowance proportional to the
  ///      borrower's encrypted repayment reputation. Zero until they build history.
  function _creditLine(address user) internal returns (euint64) {
    if (address(repTracker) == address(0) || !repTracker.hasReputation(user)) return FHE.asEuint64(0);
    return FHE.mul(FHE.asEuint64(repTracker.reputationOf(user)), CREDIT_PER_REP);
  }

  function _unhealthy(uint256 marketId, address user) internal returns (ebool) {
    // credit line counts as backing: reputation itself is collateral, and decays on a miss.
    euint64 effBacking = FHE.add(_valued(marketId, _backing(marketId, user)), _creditLine(user));
    euint64 debt = FHE.isInitialized(_debt[marketId][user]) ? _debt[marketId][user] : FHE.asEuint64(0);
    uint64 lltv = markets[marketId].lltvBps;
    return FHE.lt(FHE.mul(effBacking, lltv), FHE.mul(debt, uint64(10_000)));
  }

  /// @notice Encrypted liquidation flag from authoritative state (called by the engine).
  function isLiquidatable(uint256 marketId, address user) external returns (ebool) {
    require(msg.sender == liquidationEngine, "only engine");
    _accrue(marketId, user);
    ebool liq = _unhealthy(marketId, user);
    FHE.allowThis(liq);
    FHE.allow(liq, liquidationEngine);
    return liq;
  }

  // ── Liquidation seizure — re-checks current health on ciphertext ────────────
  /// @notice Accrues, then RE-CHECKS current health: the seized amount and the position wipe are
  ///         gated by a fresh health bit via FHE.select, so a borrower who cured between the
  ///         request and this call is seized ZERO and keeps their position (no over-seizure).
  function seize(uint256 marketId, address user) external returns (euint64 seized) {
    require(msg.sender == liquidationEngine, "only engine");
    _accrue(marketId, user);

    ebool unhealthy = _unhealthy(marketId, user);
    euint64 coll = FHE.isInitialized(_collateral[marketId][user]) ? _collateral[marketId][user] : FHE.asEuint64(0);
    euint64 debt = FHE.isInitialized(_debt[marketId][user]) ? _debt[marketId][user] : FHE.asEuint64(0);

    seized = FHE.select(unhealthy, coll, FHE.asEuint64(0));
    _collateral[marketId][user] = FHE.select(unhealthy, FHE.asEuint64(0), coll);
    _debt[marketId][user] = FHE.select(unhealthy, FHE.asEuint64(0), debt);
    FHE.allowThis(_collateral[marketId][user]);
    FHE.allowThis(_debt[marketId][user]);
    FHE.allow(_collateral[marketId][user], user);
    FHE.allow(_debt[marketId][user], user);

    FHE.allowTransient(seized, address(markets[marketId].collateralToken));
    markets[marketId].collateralToken.confidentialTransfer(liquidationAuction, seized);
    FHE.allowThis(seized);
    FHE.allow(seized, liquidationAuction);

    emit Seized(marketId, user);
    return seized;
  }

  // ── Compliance — borrower-consented scoped disclosure ───────────────────────
  function authorizeAudit(uint256 marketId, address viewer, address auditor) external {
    euint64 d = _debt[marketId][msg.sender];
    require(FHE.isInitialized(d), "no debt");
    FHE.allow(d, viewer);
    IComplianceViewer(viewer).grantAuditAccess(d, auditor);
  }

  // ── Views ───────────────────────────────────────────────────────────────────
  function collateralTokenOf(uint256 marketId) external view returns (address) {
    return address(markets[marketId].collateralToken);
  }

  function marketCount() external view returns (uint256) {
    return markets.length;
  }

  function debtOf(uint256 marketId, address user) external view returns (euint64) {
    return _debt[marketId][user];
  }

  function collateralOf(uint256 marketId, address user) external view returns (euint64) {
    return _collateral[marketId][user];
  }

  function rateOf(uint256 marketId, address user) external view returns (euint32) {
    return _userRate[marketId][user];
  }
}
