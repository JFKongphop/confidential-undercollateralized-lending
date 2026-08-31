import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { KeeperContracts, newState, runCycle, fulfillLiquidations, syncEvents } from "../../scripts/keeperCore";

// Keeper — proves the off-chain operator drives the protocol's async flows end to end against the
// FHEVM mock: it discovers borrowers, initiates epoch-batch liquidation checks, fulfills the
// revealed flags (seize + open auction), settles auctions, and pays the winning liquidator — and
// self-heals (a restart with fresh state skips already-fulfilled work instead of double-acting).

const PM = "contracts/PositionManager.sol:PositionManager";
const M0 = 0;
const md = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [M0]);

describe("Keeper", function () {
  let signers: HardhatEthersSigner[];
  let cWETH: any, cWETHAddr: string;
  let cUSDC: any;
  let oracle: any, oracleAddr: string;
  let auction: any, auctionAddr: string;
  let engine: any;
  let pool: any, poolAddr: string;
  let c: KeeperContracts;

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    cWETH = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    cWETHAddr = await cWETH.getAddress();
    cUSDC = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    const agg = await (await ethers.getContractFactory("MockAggregator")).deploy(100_000_000, 8);
    const adapter = await (await ethers.getContractFactory("OracleAdapter")).deploy(await agg.getAddress(), 3600);

    const repTracker = await (await ethers.getContractFactory("RepaymentTracker")).deploy();
    oracle = await (await ethers.getContractFactory("CreditOracle")).deploy(await repTracker.getAddress());
    oracleAddr = await oracle.getAddress();
    const rateModel = await (await ethers.getContractFactory("InterestRateModel")).deploy(oracleAddr);
    const positions = await (await ethers.getContractFactory(PM)).deploy();
    const guarantor = await (await ethers.getContractFactory("GuarantorModule")).deploy();
    auction = await (await ethers.getContractFactory("LiquidationAuction")).deploy();
    auctionAddr = await auction.getAddress();
    engine = await (await ethers.getContractFactory("LiquidationEngine")).deploy();
    pool = await (await ethers.getContractFactory("LendingPool")).deploy();
    poolAddr = await pool.getAddress();

    await pool.addMarket(cWETHAddr, await cUSDC.getAddress(), await adapter.getAddress(), 8_000);
    await repTracker.setLendingPool(poolAddr);
    await repTracker.setCreditOracle(oracleAddr);
    await oracle.setLendingPool(poolAddr);
    await oracle.setRateModel(await rateModel.getAddress());
    await rateModel.setLendingPool(poolAddr);
    await positions.setLendingPool(poolAddr);
    await guarantor.setLendingPool(poolAddr);
    await pool.setCreditOracle(oracleAddr);
    await pool.setPositions(await positions.getAddress());
    await pool.setRepaymentTracker(await repTracker.getAddress());
    await pool.setGuarantor(await guarantor.getAddress());
    await pool.setRateModel(await rateModel.getAddress());
    await pool.setUtilizationBps(0);
    await pool.setLiquidationEngine(await engine.getAddress());
    await pool.setLiquidationAuction(auctionAddr);
    await engine.setPool(poolAddr);
    await engine.setAuction(auctionAddr);
    await auction.setLiquidationEngine(await engine.getAddress());
    await cUSDC.mint(poolAddr, 1_000_000);

    c = { pool, engine, auction };
  });

  async function setupBorrower(user: HardhatEthersSigner, collateral: number, debt: number) {
    let inp = fhevm.createEncryptedInput(oracleAddr, user.address);
    inp.add64(2_000_000_000);
    inp.add32(1_000);
    let enc = await inp.encrypt();
    await oracle.connect(user).submitInputs(enc.handles[0], enc.handles[1], enc.inputProof);

    await cWETH.mint(user.address, 100_000);
    inp = fhevm.createEncryptedInput(cWETHAddr, user.address);
    inp.add64(collateral);
    enc = await inp.encrypt();
    await cWETH.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, enc.handles[0], enc.inputProof, md);

    inp = fhevm.createEncryptedInput(poolAddr, user.address);
    inp.add64(debt);
    enc = await inp.encrypt();
    await pool.connect(user).borrow(M0, enc.handles[0], enc.inputProof);
  }

  async function bid(id: number, bidder: HardhatEthersSigner, amount: number) {
    const inp = fhevm.createEncryptedInput(auctionAddr, bidder.address);
    inp.add64(amount);
    const enc = await inp.encrypt();
    await auction.connect(bidder).bid(id, enc.handles[0], enc.inputProof);
  }

  const readDebt = (u: HardhatEthersSigner) =>
    pool.debtOf(M0, u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, u));
  const readCollBal = (u: HardhatEthersSigner) =>
    cWETH.confidentialBalanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, cWETHAddr, u));

  it("checks, liquidates, settles, and pays out — end to end", async function () {
    const debtor = signers[1];
    const liqA = signers[2];
    const liqB = signers[3];
    await setupBorrower(debtor, 1_000, 900); // liquidatable (debt 900 > 80% of 1000)

    const state = newState(0);

    // Cycle 1: discover the borrower, epoch-batch check, fulfill -> seize + open auction.
    const r1 = await runCycle(c, fhevm, state, ethers.provider, { check: true });
    expect(r1.checked).to.equal(1);
    expect(r1.liquidations).to.deep.include({ id: 0, liquidatable: true });
    expect(await readDebt(debtor)).to.equal(0n); // seized + wiped
    expect((await auction.auctionInfo(0)).isOpen).to.equal(true);

    // liquidators bid on the seized collateral.
    await bid(0, liqA, 700);
    await bid(0, liqB, 850);

    // Cycle 2: settle the (now-biddable) auction and pay the winner.
    const r2 = await runCycle(c, fhevm, state, ethers.provider, { settle: true, settleWindowSecs: 0 });
    expect(r2.settled).to.deep.equal([0]);
    expect(r2.payouts).to.deep.equal([0]);
    expect(await readCollBal(liqB)).to.equal(1_000n); // winner received the seized collateral
  });

  it("does not liquidate a healthy position (fulfills as NotLiquidatable)", async function () {
    const user = signers[4];
    await setupBorrower(user, 1_000, 500); // healthy

    const state = newState(0);
    const r = await runCycle(c, fhevm, state, ethers.provider, { check: true });
    expect(r.liquidations).to.deep.include({ id: 0, liquidatable: false });
    expect(await readDebt(user)).to.equal(500n); // untouched
  });

  it("self-heals on restart: a fresh keeper skips an already-fulfilled request", async function () {
    const debtor = signers[5];
    await setupBorrower(debtor, 1_000, 900);

    // first keeper does the work
    const s1 = newState(0);
    const r1 = await runCycle(c, fhevm, s1, ethers.provider, { check: true });
    expect(r1.liquidations.length).to.equal(1);

    // a brand-new keeper (lost cache) replays logs but finds the request already fulfilled.
    const s2 = newState(0);
    await syncEvents(c, s2, ethers.provider);
    expect(s2.requested.has(0)).to.equal(true); // it sees the request in the logs
    const acted = await fulfillLiquidations(c, fhevm, s2);
    expect(acted).to.deep.equal([]); // ...but does nothing, because on-chain it is no longer pending
  });
});
