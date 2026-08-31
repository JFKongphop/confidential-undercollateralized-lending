import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// Full-flow + coverage suite over MULTI-ASSET markets. Deploys and wires the whole system with two
// isolated markets (M0: cWETH->cUSDC, M1: cWBTC->cUSDC), then:
//  1) walks the complete lifecycle end to end on M0, and
//  2) proves market isolation, plus the branch/guard coverage the focused suites don't
//     (reputation decay, guarantor-lifted borrow, no-debt accrual, config, auth reverts).

const PM = "contracts/PositionManager.sol:PositionManager";
const YEAR = 365 * 24 * 60 * 60;
const M0 = 0;
const M1 = 1;
const M2 = 2; // cross-asset market: cWETH -> cWBTC, priced by two feeds
const md = (m: number) => ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [m]);

describe("Full flow — multi-asset confidential lending", function () {
  let signers: HardhatEthersSigner[];
  let cWETH: any, cWETHAddr: string;
  let cWBTC: any, cWBTCAddr: string;
  let cUSDC: any, cUSDCAddr: string;
  let agg0: any;
  let agg1: any;
  let repTracker: any, repAddr: string;
  let oracle: any, oracleAddr: string;
  let rateModel: any, rateAddr: string;
  let positions: any;
  let guarantor: any, guarantorAddr: string;
  let engine: any, engineAddr: string;
  let auction: any, auctionAddr: string;
  let pool: any, poolAddr: string;
  let compliance: any, complianceAddr: string;

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    const Token = await ethers.getContractFactory("MockConfidentialUSDT");
    cWETH = await Token.deploy();
    cWETHAddr = await cWETH.getAddress();
    cWBTC = await Token.deploy();
    cWBTCAddr = await cWBTC.getAddress();
    cUSDC = await Token.deploy();
    cUSDCAddr = await cUSDC.getAddress();

    const Agg = await ethers.getContractFactory("MockAggregator");
    const Adapter = await ethers.getContractFactory("OracleAdapter");
    agg0 = await Agg.deploy(100_000_000, 8); // par
    const adapter0 = await Adapter.deploy(await agg0.getAddress(), 3600);
    agg1 = await Agg.deploy(100_000_000, 8);
    const adapter1 = await Adapter.deploy(await agg1.getAddress(), 3600);

    repTracker = await (await ethers.getContractFactory("RepaymentTracker")).deploy();
    repAddr = await repTracker.getAddress();
    oracle = await (await ethers.getContractFactory("CreditOracle")).deploy(repAddr);
    oracleAddr = await oracle.getAddress();
    rateModel = await (await ethers.getContractFactory("InterestRateModel")).deploy(oracleAddr);
    rateAddr = await rateModel.getAddress();
    positions = await (await ethers.getContractFactory(PM)).deploy();
    guarantor = await (await ethers.getContractFactory("GuarantorModule")).deploy();
    guarantorAddr = await guarantor.getAddress();
    auction = await (await ethers.getContractFactory("LiquidationAuction")).deploy();
    auctionAddr = await auction.getAddress();
    engine = await (await ethers.getContractFactory("LiquidationEngine")).deploy();
    engineAddr = await engine.getAddress();
    pool = await (await ethers.getContractFactory("LendingPool")).deploy();
    poolAddr = await pool.getAddress();
    compliance = await (await ethers.getContractFactory("ComplianceViewer")).deploy();
    complianceAddr = await compliance.getAddress();

    await pool.addMarket(cWETHAddr, cUSDCAddr, await adapter0.getAddress(), 8_000); // M0
    await pool.addMarket(cWBTCAddr, cUSDCAddr, await adapter1.getAddress(), 8_000); // M1

    // M2 — a cross-asset market cWETH -> cWBTC priced by TWO feeds (ETH/USD, BTC/USD).
    const ethFeed = await Agg.deploy(3000n * 10n ** 8n, 8);
    const btcFeed = await Agg.deploy(60000n * 10n ** 8n, 8);
    const pairOracle = await (await ethers.getContractFactory("PairPriceOracle")).deploy(
      await ethFeed.getAddress(),
      await btcFeed.getAddress(),
      3600,
    );
    await pool.addMarket(cWETHAddr, cWBTCAddr, await pairOracle.getAddress(), 8_000); // M2

    await repTracker.setLendingPool(poolAddr);
    await repTracker.setCreditOracle(oracleAddr);
    await oracle.setLendingPool(poolAddr);
    await oracle.setRateModel(rateAddr);
    await rateModel.setLendingPool(poolAddr);
    await positions.setLendingPool(poolAddr);
    await guarantor.setLendingPool(poolAddr);
    await pool.setCreditOracle(oracleAddr);
    await pool.setPositions(await positions.getAddress());
    await pool.setRepaymentTracker(repAddr);
    await pool.setGuarantor(guarantorAddr);
    await pool.setRateModel(rateAddr);
    await pool.setUtilizationBps(0);
    await pool.setLiquidationEngine(engineAddr);
    await pool.setLiquidationAuction(auctionAddr);
    await engine.setPool(poolAddr);
    await engine.setAuction(auctionAddr);
    await auction.setLiquidationEngine(engineAddr);

    await cUSDC.mint(poolAddr, 1_000_000);
    await cWBTC.mint(poolAddr, 1_000_000); // cWBTC liquidity for the M2 cross-asset market
  });

  // ── helpers ──────────────────────────────────────────────────────────────
  async function submitScore(user: HardhatEthersSigner, balances: number, age: number) {
    const input = fhevm.createEncryptedInput(oracleAddr, user.address);
    input.add64(balances);
    input.add32(age);
    const { handles, inputProof } = await input.encrypt();
    await oracle.connect(user).submitInputs(handles[0], handles[1], inputProof);
  }
  async function guarantee(g: HardhatEthersSigner, marketId: number, borrower: string, amount: number) {
    const input = fhevm.createEncryptedInput(guarantorAddr, g.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await guarantor.connect(g).guarantee(marketId, borrower, handles[0], inputProof);
  }
  async function deposit(user: HardhatEthersSigner, token: any, tokenAddr: string, marketId: number, amount: number) {
    await token.mint(user.address, 100_000);
    const input = fhevm.createEncryptedInput(tokenAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await token
      .connect(user)
      ["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, md(marketId));
  }
  async function borrow(user: HardhatEthersSigner, marketId: number, amount: number) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).borrow(marketId, handles[0], inputProof);
  }
  async function repay(user: HardhatEthersSigner, marketId: number, amount: number, onTime: boolean) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).repay(marketId, handles[0], inputProof, onTime);
  }
  async function bid(id: number, bidder: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(auctionAddr, bidder.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await auction.connect(bidder).bid(id, handles[0], inputProof);
  }
  const readDebt = (m: number, u: HardhatEthersSigner) =>
    pool.debtOf(m, u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, u));
  const readColl = (m: number, u: HardhatEthersSigner) =>
    pool.collateralOf(m, u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, u));
  const readRep = (u: HardhatEthersSigner) =>
    repTracker.reputationOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint32, h, repAddr, u));
  const readCollBal = (token: any, tokenAddr: string, u: HardhatEthersSigner) =>
    token.confidentialBalanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, tokenAddr, u));

  it("runs the complete lifecycle end to end (M0: cWETH -> cUSDC)", async function () {
    const borrower = signers[1];
    const backer = signers[2];
    const auditor = signers[3];
    const liqA = signers[4];
    const liqB = signers[5];

    // 1) private scoring -> band 3 + a breakdown only the borrower can read.
    await submitScore(borrower, 500_000_000, 1_000);
    expect(await oracle.bandOf(borrower.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint8, h, oracleAddr, borrower))).to.equal(3n);
    const bd = await oracle.scoreBreakdown(borrower.address);
    const parts = await Promise.all(
      [bd.balance, bd.age, bd.history].map((h: string) => fhevm.userDecryptEuint(FhevmType.euint32, h, oracleAddr, borrower)),
    );
    expect(parts).to.deep.equal([200n, 200n, 0n]);

    // 2) confidential third-party backing; 3) deposit own collateral (too little alone).
    await guarantee(backer, M0, borrower.address, 700);
    await deposit(borrower, cWETH, cWETHAddr, M0, 100);

    // 4) borrow 500: valued backing (100 + 700) = 800 >= required 700.
    await borrow(borrower, M0, 500);
    expect(await readDebt(M0, borrower)).to.equal(500n);
    expect(await pool.rateOf(M0, borrower.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint32, h, poolAddr, borrower))).to.equal(700n);

    // 5) one year of encrypted interest: 500 * 700 / 10000 = 35 -> 535.
    await time.increase(YEAR);
    await pool.accrue(M0, borrower.address);
    expect(await readDebt(M0, borrower)).to.equal(535n);

    // 6) borrower-consented compliance: auditor decrypts exactly the debt.
    await compliance.setAuditor(auditor.address, true);
    await pool.connect(borrower).authorizeAudit(M0, complianceAddr, auditor.address);
    expect(await pool.debtOf(M0, borrower.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, auditor))).to.equal(535n);

    // 7) repay on time -> debt 500, reputation +50.
    await cUSDC.connect(borrower).setOperator(poolAddr, 2_000_000_000);
    await repay(borrower, M0, 35, true);
    expect(await readDebt(M0, borrower)).to.equal(500n);
    expect(await readRep(borrower)).to.equal(50n);

    // 8) collateral price crashes -> underwater; 9) liquidation seizes + opens auction.
    await agg0.setAnswer(10_000_000); // P = 10 (must overcome the borrower's reputation credit line)
    await engine.requestLiquidation(M0, borrower.address);
    const req = await engine.pendingLiquidations(0);
    const flag = await fhevm.publicDecrypt([req.flagHandle]);
    await expect(engine.fulfillLiquidation(0, flag.abiEncodedClearValues, flag.decryptionProof)).to.emit(engine, "Liquidated");
    expect(await readDebt(M0, borrower)).to.equal(0n);
    expect(await readColl(M0, borrower)).to.equal(0n);

    // 10) sealed-bid auction -> winner receives the seized cWETH collateral (100).
    await bid(0, liqA, 60);
    await bid(0, liqB, 90);
    await auction.settle(0);
    const info = await auction.auctionInfo(0);
    const settled = await fhevm.publicDecrypt([info.highestHandle, info.winnerHandle]);
    await expect(auction.fulfillSettle(0, settled.abiEncodedClearValues, settled.decryptionProof))
      .to.emit(auction, "AuctionSettled")
      .withArgs(0, liqB.address, 90n);
    expect(await readCollBal(cWETH, cWETHAddr, liqB)).to.equal(100n);
  });

  it("isolates positions across markets (M0 cWETH, M1 cWBTC)", async function () {
    const user = signers[6];
    await submitScore(user, 2_000_000_000, 1_000); // band 5 (score is global)

    await deposit(user, cWETH, cWETHAddr, M0, 1_000);
    await deposit(user, cWBTC, cWBTCAddr, M1, 1_000);
    await borrow(user, M0, 500);
    await borrow(user, M1, 300);

    expect(await readDebt(M0, user)).to.equal(500n);
    expect(await readDebt(M1, user)).to.equal(300n);
    expect(await pool.collateralTokenOf(M0)).to.equal(cWETHAddr);
    expect(await pool.collateralTokenOf(M1)).to.equal(cWBTCAddr);
    expect(await pool.marketCount()).to.equal(3n);

    // liquidate M1 by crashing ONLY the M1 collateral price; M0 uses a different oracle.
    await agg1.setAnswer(20_000_000); // M1 P = 20 -> valued 200 < debt-threshold (300)
    await engine.requestLiquidation(M1, user.address);
    const req = await engine.pendingLiquidations(0);
    const flag = await fhevm.publicDecrypt([req.flagHandle]);
    await engine.fulfillLiquidation(0, flag.abiEncodedClearValues, flag.decryptionProof);

    // M1 wiped, M0 completely untouched.
    expect(await readDebt(M1, user)).to.equal(0n);
    expect(await readDebt(M0, user)).to.equal(500n);
    expect(await readColl(M0, user)).to.equal(1_000n);
  });

  it("prices a cross-asset market via two feeds (cWETH collateral -> cWBTC debt)", async function () {
    const user = signers[14];
    await submitScore(user, 2_000_000_000, 1_000); // band 5, ratio 110%

    await deposit(user, cWETH, cWETHAddr, M2, 1_000);
    // valued = 1000 cWETH * (0.05 cWBTC/cWETH) = 50 cWBTC; required for 40 = 44 <= 50 -> disbursed.
    await borrow(user, M2, 40);
    expect(await readDebt(M2, user)).to.equal(40n);
    // borrowing 60 would need 66 cWBTC of value > 50 -> clamped to zero.
    await borrow(user, M2, 60);
    expect(await readDebt(M2, user)).to.equal(40n); // unchanged (second borrow disbursed 0)
  });

  it("reputation decays on a missed repayment (onTime=false), floored at zero", async function () {
    const user = signers[7];
    await submitScore(user, 2_000_000_000, 1_000);
    await deposit(user, cWETH, cWETHAddr, M0, 1_000);
    await borrow(user, M0, 900);
    await cUSDC.connect(user).setOperator(poolAddr, 2_000_000_000);

    await repay(user, M0, 100, true); // 0 -> 50
    await repay(user, M0, 100, true); // 50 -> 100
    await repay(user, M0, 100, false); // MISS: 100 -> 70

    expect(await readRep(user)).to.equal(70n);
    expect(await readDebt(M0, user)).to.equal(600n);
  });

  it("a guarantor's stake lifts an otherwise-insufficient borrow", async function () {
    const backed = signers[8];
    const backer = signers[9];
    const unbacked = signers[10];

    await submitScore(backed, 500_000_000, 1_000);
    await guarantee(backer, M0, backed.address, 700);
    await deposit(backed, cWETH, cWETHAddr, M0, 100);
    await borrow(backed, M0, 500);
    expect(await readDebt(M0, backed)).to.equal(500n);

    await submitScore(unbacked, 500_000_000, 1_000);
    await deposit(unbacked, cWETH, cWETHAddr, M0, 100);
    await borrow(unbacked, M0, 500);
    expect(await readDebt(M0, unbacked)).to.equal(0n);
  });

  it("accrue is a safe no-op when the user has no debt", async function () {
    await expect(pool.accrue(M0, signers[11].address)).to.not.be.reverted;
  });

  it("accumulates a second deposit and exposes the config surface", async function () {
    const user = signers[12];
    await submitScore(user, 2_000_000_000, 1_000);

    await deposit(user, cWETH, cWETHAddr, M0, 100);
    await deposit(user, cWETH, cWETHAddr, M0, 150); // accumulate branch (collateral 250)
    await borrow(user, M0, 200);
    expect(await readDebt(M0, user)).to.equal(200n);

    expect(await pool.rateOf(M0, user.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint32, h, poolAddr, user))).to.equal(300n);

    await engine.setEpochLength(300);
    expect(await engine.epochLength()).to.equal(300n);
  });

  it("enforces access control on privileged functions", async function () {
    const outsider = signers[13];
    await expect(pool.connect(outsider).setCreditOracle(outsider.address)).to.be.revertedWith("not admin");
    await expect(pool.connect(outsider).addMarket(cWETHAddr, cUSDCAddr, cWETHAddr, 8_000)).to.be.revertedWith("not admin");
    await expect(pool.connect(outsider).seize(M0, outsider.address)).to.be.revertedWith("only engine");
    await expect(auction.connect(outsider)["open(address,address)"](outsider.address, cWETHAddr)).to.be.revertedWith("only engine");
    await expect(compliance.connect(outsider).setAuditor(outsider.address, true)).to.be.revertedWith("only admin");
    await expect(engine.connect(outsider).setPool(outsider.address)).to.be.revertedWith("not admin");

    const input = fhevm.createEncryptedInput(poolAddr, outsider.address);
    input.add64(100);
    const { handles, inputProof } = await input.encrypt();
    await expect(pool.connect(outsider).borrow(M0, handles[0], inputProof)).to.be.revertedWith("no score");
  });
});
