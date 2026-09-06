// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";

interface ILendingPool {
  function supply(euint64 amount) external;
  function redeem(euint64 amount) external returns (euint64 paid);
  function recognizeYield() external returns (euint64 yield);
}

interface IConfidentialToken is IERC7984 {
  function setOperator(address operator, uint48 until) external;
}

/// @title PrizePool — Confidential no-loss prize savings (PoolTogether on Zama FHEVM)
/// @notice Depositors put ERC-7984 confidential tokens into a shared pool. Individual balances and
///         the pool shares are stored as `euint64` ciphertexts — no observer sees who saved how
///         much. At each draw the accrued prize (a mock, admin-funded yield reserve) is awarded to
///         ONE depositor, selected on-chain by FHE randomness weighted by deposit size, computed
///         over the encrypted balances. Only the winner's own encrypted balance grows, so only the
///         winner learns the outcome (via the EIP-712 user-decryption flow). Principal is
///         withdrawable at any time — no loss.
///
///         Confidentiality design (documented leakage):
///           - ENCRYPTED: every individual deposit/balance, every prize award, the target ticket.
///           - PUBLIC: the SET of depositor addresses (needed to iterate the draw) and, at a draw,
///             the AGGREGATE pool total (revealed once so the random ticket can be bounded to
///             [0, total) — `FHE.rem` only accepts a plaintext modulus). No individual balance is
///             ever revealed. Winner selection uses on-chain `FHE.randEuint64` — no off-chain RNG.
contract PrizePool is ZamaEthereumConfig, IERC7984Receiver {
  IERC7984 public immutable asset; // the ERC-7984 confidential token deposited into the pool
  address public admin;

  // Yield integration: when set, savers' deposits are supplied into a LendingPool as borrowable
  // liquidity, and the prize is the REAL interest harvested from it. When unset, the pool holds the
  // tokens itself and prizes come only from seedPrize (standalone mode).
  ILendingPool public lending;

  // encrypted per-depositor principal (+ any winnings), and the encrypted pool total
  mapping(address => euint64) private _balance;
  euint64 private _totalDeposits;
  // encrypted, admin-funded prize reserve (the "mock yield"); awarded in full at each draw
  euint64 private _prizeReserve;

  // enumerable depositor set (addresses are public; amounts are not)
  address[] public depositors;
  mapping(address => bool) public isDepositor;

  // draw lifecycle: requestDraw() reveals the total and freezes deposits/withdrawals until
  // fulfillDraw() runs the weighted selection against that snapshot.
  uint256 public drawId;
  bool public drawPending;
  bytes32 private _pendingTotalHandle;

  event Deposited(address indexed from);
  event Withdrawn(address indexed from);
  event PrizeFunded();
  event DrawRequested(uint256 indexed drawId, bytes32 totalHandle);
  event DrawCompleted(uint256 indexed drawId);

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  constructor(address asset_) {
    asset = IERC7984(asset_);
    admin = msg.sender;
  }

  function setAdmin(address a) external onlyAdmin {
    admin = a;
  }

  /// @notice Wire this pool to a LendingPool as its yield source. Approves the LendingPool to pull
  ///         supplied liquidity from this pool's asset balance. Pass address(0) to run standalone.
  function setLending(address lendingPool) external onlyAdmin {
    lending = ILendingPool(lendingPool);
    if (lendingPool != address(0)) {
      IConfidentialToken(address(asset)).setOperator(lendingPool, type(uint48).max);
    }
  }

  /// @notice Harvest the realized lending interest and book it as the prize reserve. The interest was
  ///         paid (encrypted) by borrowers; here it becomes the pool's next prize. Admin/keeper.
  function harvest() external onlyAdmin {
    require(address(lending) != address(0), "no lending");
    euint64 y = lending.recognizeYield();
    _prizeReserve = FHE.isInitialized(_prizeReserve) ? FHE.add(_prizeReserve, y) : y;
    FHE.allowThis(_prizeReserve);
    emit PrizeFunded();
  }

  // ── Deposit / prize funding — ERC-7984 receiver callback ─────────────────────
  /// @notice Called by the token during `confidentialTransferAndCall`. Empty `data` = a depositor
  ///         deposit; `data == abi.encode(true)` = an admin prize-reserve top-up (the mock yield).
  function onConfidentialTransferReceived(
    address /* operator */,
    address from,
    euint64 amount,
    bytes calldata data
  ) external override returns (ebool) {
    require(msg.sender == address(asset), "only asset token");
    require(!drawPending, "draw in progress");

    bool isPrize = data.length > 0 && abi.decode(data, (bool));

    if (isPrize) {
      _prizeReserve = FHE.isInitialized(_prizeReserve) ? FHE.add(_prizeReserve, amount) : amount;
      FHE.allowThis(_prizeReserve);
      emit PrizeFunded();
    } else {
      _balance[from] = FHE.isInitialized(_balance[from]) ? FHE.add(_balance[from], amount) : amount;
      FHE.allowThis(_balance[from]);
      FHE.allow(_balance[from], from);

      _totalDeposits = FHE.isInitialized(_totalDeposits) ? FHE.add(_totalDeposits, amount) : amount;
      FHE.allowThis(_totalDeposits);

      if (!isDepositor[from]) {
        isDepositor[from] = true;
        depositors.push(from);
      }

      // route the liquidity into the lending market so it earns real yield (if wired)
      if (address(lending) != address(0)) {
        FHE.allowTransient(amount, address(lending));
        lending.supply(amount);
      }
      emit Deposited(from);
    }

    ebool ok = FHE.asEbool(true);
    FHE.allowTransient(ok, msg.sender);
    return ok;
  }

  // ── Prize funding (mock yield) — plaintext admin seed ────────────────────────
  /// @notice Admin tops up the prize reserve (the mock yield) with a plaintext amount. The matching
  ///         tokens must be present in this pool (e.g. `token.mint(pool, amount)`) so winnings are
  ///         backed on withdrawal. The encrypted alternative is a prize-flagged
  ///         `confidentialTransferAndCall` (see the receiver callback). A real yield source would
  ///         replace this by routing accrued interest into the reserve.
  function seedPrize(uint64 amount) external onlyAdmin {
    _prizeReserve = FHE.isInitialized(_prizeReserve)
      ? FHE.add(_prizeReserve, FHE.asEuint64(amount))
      : FHE.asEuint64(amount);
    FHE.allowThis(_prizeReserve);
    emit PrizeFunded();
  }

  // ── Withdraw — no-loss, principal (+ any winnings) at any time ───────────────
  /// @notice Withdraw up to your full encrypted balance. Clamped on ciphertext, so an over-request
  ///         never reverts and never reveals your balance.
  function withdraw(externalEuint64 encAmount, bytes calldata proof) external {
    require(!drawPending, "draw in progress");
    require(isDepositor[msg.sender], "no balance");

    euint64 req = FHE.fromExternal(encAmount, proof);
    euint64 bal = _balance[msg.sender];
    euint64 amt = FHE.select(FHE.le(req, bal), req, bal); // clamp to balance → no-loss, no revert

    // pull the principal back from the lending market first (if wired); redeem returns the exact
    // amount paid (clamped to live liquidity), which is what we settle the saver's accounting against.
    euint64 paid;
    if (address(lending) != address(0)) {
      FHE.allowTransient(amt, address(lending));
      paid = lending.redeem(amt);
    } else {
      paid = amt;
    }

    _balance[msg.sender] = FHE.sub(bal, paid);
    _totalDeposits = FHE.sub(_totalDeposits, paid);
    FHE.allowThis(_balance[msg.sender]);
    FHE.allow(_balance[msg.sender], msg.sender);
    FHE.allowThis(_totalDeposits);

    FHE.allowTransient(paid, address(asset));
    asset.confidentialTransfer(msg.sender, paid);
    emit Withdrawn(msg.sender);
  }

  // ── Draw step 1 — reveal the aggregate total, freeze the pool ────────────────
  /// @notice Snapshot + publicly reveal the aggregate pool total so the random ticket can be bounded
  ///         to [0, total). Freezes deposits/withdrawals until fulfillDraw. Admin/keeper triggered.
  function requestDraw() external onlyAdmin {
    require(!drawPending, "draw in progress");
    require(depositors.length > 0, "no depositors");
    require(FHE.isInitialized(_totalDeposits), "empty pool");

    FHE.makePubliclyDecryptable(_totalDeposits);
    _pendingTotalHandle = euint64.unwrap(_totalDeposits);
    drawPending = true;
    emit DrawRequested(drawId, _pendingTotalHandle);
  }

  // ── Draw step 2 — deposit-weighted winner selection on ciphertext ────────────
  /// @notice Verifies the revealed total, draws an encrypted random ticket in [0, total), then walks
  ///         depositors accumulating an encrypted running sum and credits the prize to the FIRST
  ///         depositor whose cumulative crosses the ticket — all via FHE.select, no address revealed.
  ///         P(win) is exactly proportional to deposit size. Permissionless fulfill (like a keeper).
  function fulfillDraw(bytes calldata cleartexts, bytes calldata proof) external {
    require(drawPending, "no draw");

    bytes32[] memory handles = new bytes32[](1);
    handles[0] = _pendingTotalHandle;
    FHE.checkSignatures(handles, cleartexts, proof);
    uint64 totalPlain = abi.decode(cleartexts, (uint64));

    drawPending = false; // unfreeze regardless of outcome
    uint256 thisDraw = drawId;
    drawId++;

    if (totalPlain == 0) {
      emit DrawCompleted(thisDraw);
      return;
    }

    // encrypted random ticket, uniform in [0, total)
    euint64 target = FHE.rem(FHE.randEuint64(), totalPlain);
    euint64 prize = FHE.isInitialized(_prizeReserve) ? _prizeReserve : FHE.asEuint64(0);

    euint64 cum = FHE.asEuint64(0);
    ebool found = FHE.asEbool(false);

    uint256 n = depositors.length;
    for (uint256 i = 0; i < n; i++) {
      address d = depositors[i];
      cum = FHE.add(cum, _balance[d]);
      ebool crossed = FHE.gt(cum, target);
      // newlyWon = (NOT found) AND crossed — emulated with select (no FHE.and/not in this stack)
      ebool newlyWon = FHE.select(found, FHE.asEbool(false), crossed);
      euint64 award = FHE.select(newlyWon, prize, FHE.asEuint64(0));

      _balance[d] = FHE.add(_balance[d], award);
      FHE.allowThis(_balance[d]);
      FHE.allow(_balance[d], d);

      found = FHE.or(found, crossed);
    }

    // prize moved from the reserve into a depositor's balance → fold into the total, reset reserve
    _totalDeposits = FHE.add(_totalDeposits, prize);
    FHE.allowThis(_totalDeposits);
    _prizeReserve = FHE.asEuint64(0);
    FHE.allowThis(_prizeReserve);

    emit DrawCompleted(thisDraw);
  }

  // ── Views (return encrypted handles; only ACL-granted addresses can decrypt) ──
  function balanceOf(address a) external view returns (euint64) {
    return _balance[a];
  }

  function totalDeposits() external view returns (euint64) {
    return _totalDeposits;
  }

  function prizeReserve() external view returns (euint64) {
    return _prizeReserve;
  }

  function depositorCount() external view returns (uint256) {
    return depositors.length;
  }

  function pendingTotalHandle() external view returns (bytes32) {
    return _pendingTotalHandle;
  }
}
