import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// LendingPool (contract #4) + integration — the confidential loan loop over an ISOLATED MARKET
// (collateral cWETH -> debt cUSDC, priced by an oracle at par): deposit -> borrow against the
// encrypted band with a dynamic, oracle-valued ratio -> interest accrual -> repay (reputation) ->
// liquidation reveal flow with real collateral seizure + payout.

const PM = "contracts/PositionManager.sol:PositionManager";
const YEAR = 365 * 24 * 60 * 60;
const MID = 0; // single market id used throughout
const marketData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [MID]);

describe("LendingPool (integration)", function () {
  let signers: HardhatEthersSigner[];
  let cWETH: any, cWETHAddr: string; // collateral token
  let cUSDC: any, cUSDCAddr: string; // debt token
  let agg: any;
  let repTracker: any, repAddr: string;
  let oracle: any, oracleAddr: string;
  let rateModel: any, rateAddr: string;
  let positions: any, positionsAddr: string;
  let guarantor: any;
  let engine: any, engineAddr: string;
  let auction: any, auctionAddr: string;
  let pool: any, poolAddr: string;

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    cWETH = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    cWETHAddr = await cWETH.getAddress();
    cUSDC = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    cUSDCAddr = await cUSDC.getAddress();
    agg = await (await ethers.getContractFactory("MockAggregator")).deploy(100_000_000, 8); // par (P=100)
    const adapter = await (await ethers.getContractFactory("OracleAdapter")).deploy(await agg.getAddress(), 3600);

    repTracker = await (await ethers.getContractFactory("RepaymentTracker")).deploy();
    repAddr = await repTracker.getAddress();
    oracle = await (await ethers.getContractFactory("CreditOracle")).deploy(repAddr);
    oracleAddr = await oracle.getAddress();
    rateModel = await (await ethers.getContractFactory("InterestRateModel")).deploy(oracleAddr);
    rateAddr = await rateModel.getAddress();
    positions = await (await ethers.getContractFactory(PM)).deploy();
    positionsAddr = await positions.getAddress();
    guarantor = await (await ethers.getContractFactory("GuarantorModule")).deploy();
    auction = await (await ethers.getContractFactory("LiquidationAuction")).deploy();
    auctionAddr = await auction.getAddress();
    engine = await (await ethers.getContractFactory("LiquidationEngine")).deploy();
    engineAddr = await engine.getAddress();
    pool = await (await ethers.getContractFactory("LendingPool")).deploy();
    poolAddr = await pool.getAddress();

    await pool.addMarket(cWETHAddr, cUSDCAddr, await adapter.getAddress(), 8_000);

    await repTracker.setLendingPool(poolAddr);
    await repTracker.setCreditOracle(oracleAddr);
    await oracle.setLendingPool(poolAddr);
    await oracle.setRateModel(rateAddr);
    await rateModel.setLendingPool(poolAddr);
    await positions.setLendingPool(poolAddr);
    await guarantor.setLendingPool(poolAddr);
    await pool.setCreditOracle(oracleAddr);
    await pool.setPositions(positionsAddr);
    await pool.setRepaymentTracker(repAddr);
    await pool.setGuarantor(await guarantor.getAddress());
    await pool.setRateModel(rateAddr);
    await pool.setUtilizationBps(0); // clean rate: band-5 => 300 bps
    await pool.setLiquidationEngine(engineAddr);
    await pool.setLiquidationAuction(auctionAddr);
    await engine.setPool(poolAddr);
    await engine.setAuction(auctionAddr);
    await auction.setLiquidationEngine(engineAddr);

    await cUSDC.mint(poolAddr, 1_000_000); // debt-token liquidity
  });

  async function submitScore(user: HardhatEthersSigner, balances: number, age: number) {
    const input = fhevm.createEncryptedInput(oracleAddr, user.address);
    input.add64(balances);
    input.add32(age);
    const { handles, inputProof } = await input.encrypt();
    await oracle.connect(user).submitInputs(handles[0], handles[1], inputProof);
  }

  async function deposit(user: HardhatEthersSigner, amount: number) {
    await cWETH.mint(user.address, 100_000);
    const input = fhevm.createEncryptedInput(cWETHAddr, user.address); // encrypt against the TOKEN
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await cWETH
      .connect(user)
      ["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, marketData);
  }

  async function borrow(user: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).borrow(MID, handles[0], inputProof);
  }

  async function repay(user: HardhatEthersSigner, amount: number, onTime: boolean) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).repay(MID, handles[0], inputProof, onTime);
  }

  async function bid(id: number, bidder: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(auctionAddr, bidder.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await auction.connect(bidder).bid(id, handles[0], inputProof);
  }

  const readDebt = (u: HardhatEthersSigner) =>
    pool.debtOf(MID, u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, u));
  const readColl = (u: HardhatEthersSigner) =>
    pool.collateralOf(MID, u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, u));
  const readCollBal = (u: HardhatEthersSigner) =>
    cWETH.confidentialBalanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, cWETHAddr, u));

  it("disburses a loan against the dynamic (band-selected) collateral ratio", async function () {
    const user = signers[1];
    await submitScore(user, 2_000_000_000, 1_000); // band 5, ratio 110%
    await deposit(user, 1_000);
    await borrow(user, 500); // valued backing 1000 >= required 550 -> disbursed

    expect(await readDebt(user)).to.equal(500n);

    const pos = await positions.getPosition(MID, user.address);
    expect(pos.exists).to.equal(true);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, pos.debt, positionsAddr, user)).to.equal(500n);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, pos.collateral, positionsAddr, user)).to.equal(1_000n);
  });

  it("clamps the disbursement to zero when undercollateralized (never reverts)", async function () {
    const user = signers[2];
    await submitScore(user, 100_000_000, 100); // band 1, ratio 200%
    await deposit(user, 100);
    await borrow(user, 500); // required 1000 > valued 100 -> actual 0

    expect(await readDebt(user)).to.equal(0n);
  });

  it("accrues encrypted interest on the debt over time", async function () {
    const user = signers[3];
    await submitScore(user, 2_000_000_000, 1_000); // band 5 -> 300 bps at util 0
    await deposit(user, 1_000);
    await borrow(user, 500);

    await time.increase(YEAR);
    await pool.accrue(MID, user.address);

    expect(await readDebt(user)).to.equal(515n); // 500 + 500*300/10000
  });

  it("records an on-time repayment as increased encrypted reputation", async function () {
    const user = signers[4];
    await submitScore(user, 2_000_000_000, 1_000);
    await deposit(user, 1_000);
    await borrow(user, 500);

    await cUSDC.connect(user).setOperator(poolAddr, 2_000_000_000); // authorize the debt-token pull
    await repay(user, 400, true);

    expect(await readDebt(user)).to.equal(100n);
    const repHandle = await repTracker.reputationOf(user.address);
    expect(await fhevm.userDecryptEuint(FhevmType.euint32, repHandle, repAddr, user)).to.equal(50n);
  });

  it("reputation unlocks an UNDERCOLLATERALIZED borrow (killer feature)", async function () {
    const user = signers[11];
    await submitScore(user, 2_000_000_000, 1_000); // band 5

    // build reputation: a small collateralized loan, repaid on time
    await deposit(user, 100);
    await borrow(user, 50);
    await cUSDC.connect(user).setOperator(poolAddr, 2_000_000_000);
    await repay(user, 50, true); // debt 0, reputation 50 -> credit line 500

    // now borrow 500 against only 100 collateral — impossible without the reputation credit line
    await borrow(user, 500);
    expect(await readDebt(user)).to.equal(500n); // borrowed 500...
    expect(await readColl(user)).to.equal(100n); // ...against only 100 collateral = undercollateralized
  });

  it("seizes collateral and pays the winning liquidator on a confirmed liquidation", async function () {
    const debtor = signers[5];
    const liqLoser = signers[6];
    const liqWinner = signers[7];

    await submitScore(debtor, 2_000_000_000, 1_000);
    await deposit(debtor, 1_000);
    await borrow(debtor, 900); // valued 1000, debt 900 -> liquidatable

    await engine.requestLiquidation(MID, debtor.address);
    let req = await engine.pendingLiquidations(0);
    let result = await fhevm.publicDecrypt([req.flagHandle]);
    await expect(engine.fulfillLiquidation(0, result.abiEncodedClearValues, result.decryptionProof)).to.emit(
      engine,
      "Liquidated",
    );

    expect(await readDebt(debtor)).to.equal(0n);
    expect(await readColl(debtor)).to.equal(0n);

    await bid(0, liqLoser, 800);
    await bid(0, liqWinner, 950);
    await auction.settle(0);
    const info = await auction.auctionInfo(0);
    const settleResult = await fhevm.publicDecrypt([info.highestHandle, info.winnerHandle]);
    await expect(auction.fulfillSettle(0, settleResult.abiEncodedClearValues, settleResult.decryptionProof))
      .to.emit(auction, "AuctionSettled")
      .withArgs(0, liqWinner.address, 950n);

    expect(await readCollBal(liqWinner)).to.equal(1_000n); // seized collateral paid out
  });

  it("re-checks health at finalize: a borrower who cures is seized zero (no over-seizure)", async function () {
    const debtor = signers[8];
    await submitScore(debtor, 2_000_000_000, 1_000);
    await deposit(debtor, 1_000);
    await borrow(debtor, 900);

    await engine.requestLiquidation(MID, debtor.address);

    await cUSDC.connect(debtor).setOperator(poolAddr, 2_000_000_000);
    await repay(debtor, 500, true); // debt 900 -> 400, now healthy

    const req = await engine.pendingLiquidations(0);
    const result = await fhevm.publicDecrypt([req.flagHandle]);
    await engine.fulfillLiquidation(0, result.abiEncodedClearValues, result.decryptionProof);

    expect(await readDebt(debtor)).to.equal(400n); // not wiped
    expect(await readColl(debtor)).to.equal(1_000n); // not seized
  });

  it("liquidates on an oracle price drop (collateral valued via the market oracle)", async function () {
    const user = signers[9];
    await submitScore(user, 2_000_000_000, 1_000);
    await deposit(user, 1_000);
    await borrow(user, 500); // healthy at par

    await agg.setAnswer(40_000_000); // P = 40 -> valued backing 400 < debt-threshold

    await engine.requestLiquidation(MID, user.address);
    const req = await engine.pendingLiquidations(0);
    const result = await fhevm.publicDecrypt([req.flagHandle]);
    await expect(engine.fulfillLiquidation(0, result.abiEncodedClearValues, result.decryptionProof)).to.emit(
      engine,
      "Liquidated",
    );
    expect(await readDebt(user)).to.equal(0n);
  });

  it("does not liquidate a healthy position", async function () {
    const user = signers[10];
    await submitScore(user, 2_000_000_000, 1_000);
    await deposit(user, 1_000);
    await borrow(user, 500);

    await engine.requestLiquidation(MID, user.address);
    const req = await engine.pendingLiquidations(0);
    const result = await fhevm.publicDecrypt([req.flagHandle]);
    await expect(engine.fulfillLiquidation(0, result.abiEncodedClearValues, result.decryptionProof)).to.emit(
      engine,
      "NotLiquidatable",
    );
  });

  it("batches liquidation checks into epochs so individual timing does not leak", async function () {
    const risky = signers[11];
    const safe = signers[12];

    await submitScore(risky, 2_000_000_000, 1_000);
    await deposit(risky, 1_000);
    await borrow(risky, 900);

    await submitScore(safe, 2_000_000_000, 1_000);
    await deposit(safe, 1_000);
    await borrow(safe, 500);

    await engine.requestLiquidationBatch(MID, [risky.address, safe.address]);
    await expect(engine.requestLiquidationBatch(MID, [risky.address])).to.be.revertedWith("epoch not elapsed");

    const r0 = await engine.pendingLiquidations(0);
    const res0 = await fhevm.publicDecrypt([r0.flagHandle]);
    await expect(engine.fulfillLiquidation(0, res0.abiEncodedClearValues, res0.decryptionProof)).to.emit(engine, "Liquidated");

    const r1 = await engine.pendingLiquidations(1);
    const res1 = await fhevm.publicDecrypt([r1.flagHandle]);
    await expect(engine.fulfillLiquidation(1, res1.abiEncodedClearValues, res1.decryptionProof)).to.emit(engine, "NotLiquidatable");
  });
});
