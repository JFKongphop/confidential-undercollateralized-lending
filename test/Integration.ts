import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// END-TO-END INTEGRATION: the confidential PrizePool supplies its savers' deposits into the
// confidential LendingPool as borrowable liquidity; a borrower pays encrypted interest; the pool
// harvests that REAL yield as the prize; an FHE-random draw awards it; savers withdraw principal +
// winnings — no loss. Both contracts do real work; the prize is real lending interest.

const PM = "contracts/PositionManager.sol:PositionManager";
const YEAR = 365 * 24 * 60 * 60;
const MID = 0;
const marketData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [MID]);
const EMPTY = "0x";

describe("Integration — lending yield funds the confidential prize pool", function () {
  let signers: HardhatEthersSigner[];
  let admin: HardhatEthersSigner;
  let cWETH: any, cWETHAddr: string; // borrower collateral
  let cUSD: any, cUSDAddr: string; // savings asset = market debt token
  let oracle: any, repTracker: any, credit: any, rateModel: any, positions: any, guarantor: any;
  let pool: any, poolAddr: string; // LendingPool
  let prize: any, prizeAddr: string; // PrizePool

  before(async function () {
    signers = await ethers.getSigners();
    admin = signers[0];
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    cWETH = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    cWETHAddr = await cWETH.getAddress();
    cUSD = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    cUSDAddr = await cUSD.getAddress();
    const agg = await (await ethers.getContractFactory("MockAggregator")).deploy(100_000_000, 8); // par
    const adapter = await (await ethers.getContractFactory("OracleAdapter")).deploy(await agg.getAddress(), 3600);

    repTracker = await (await ethers.getContractFactory("RepaymentTracker")).deploy();
    credit = await (await ethers.getContractFactory("CreditOracle")).deploy(await repTracker.getAddress());
    rateModel = await (await ethers.getContractFactory("InterestRateModel")).deploy(await credit.getAddress());
    positions = await (await ethers.getContractFactory(PM)).deploy();
    guarantor = await (await ethers.getContractFactory("GuarantorModule")).deploy();
    pool = await (await ethers.getContractFactory("LendingPool")).deploy();
    poolAddr = await pool.getAddress();

    await pool.addMarket(cWETHAddr, cUSDAddr, await adapter.getAddress(), 8_000);
    await repTracker.setLendingPool(poolAddr);
    await repTracker.setCreditOracle(await credit.getAddress());
    await credit.setLendingPool(poolAddr);
    await credit.setRateModel(await rateModel.getAddress());
    await rateModel.setLendingPool(poolAddr);
    await positions.setLendingPool(poolAddr);
    await guarantor.setLendingPool(poolAddr);
    await pool.setCreditOracle(await credit.getAddress());
    await pool.setPositions(await positions.getAddress());
    await pool.setRepaymentTracker(await repTracker.getAddress());
    await pool.setGuarantor(await guarantor.getAddress());
    await pool.setRateModel(await rateModel.getAddress());
    await pool.setUtilizationBps(0); // band-5 => 300 bps

    // the prize pool over the savings asset (cUSD), wired as the market's liquidity supplier
    prize = await (await ethers.getContractFactory("PrizePool")).deploy(cUSDAddr);
    prizeAddr = await prize.getAddress();
    await prize.setLending(poolAddr);
    await pool.setYieldSupplier(prizeAddr, MID);
  });

  async function save(user: HardhatEthersSigner, amount: number) {
    await cUSD.mint(user.address, amount);
    const input = fhevm.createEncryptedInput(cUSDAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await cUSD.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](prizeAddr, handles[0], inputProof, EMPTY);
  }

  async function submitScore(user: HardhatEthersSigner, bal: number, age: number) {
    const input = fhevm.createEncryptedInput(await credit.getAddress(), user.address);
    input.add64(bal);
    input.add32(age);
    const { handles, inputProof } = await input.encrypt();
    await credit.connect(user).submitInputs(handles[0], handles[1], inputProof);
  }

  async function depositCollateral(user: HardhatEthersSigner, amount: number) {
    await cWETH.mint(user.address, amount);
    const input = fhevm.createEncryptedInput(cWETHAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await cWETH.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, marketData);
  }

  async function borrow(user: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).borrow(MID, handles[0], inputProof);
  }

  async function repay(user: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).repay(MID, handles[0], inputProof, true);
  }

  async function runDraw() {
    await prize.connect(admin).requestDraw();
    const handle = await prize.pendingTotalHandle();
    const res = await fhevm.publicDecrypt([handle]);
    await prize.fulfillDraw(res.abiEncodedClearValues, res.decryptionProof);
  }

  const prizeBal = (u: HardhatEthersSigner) =>
    prize.balanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, prizeAddr, u));
  const tokenBal = (u: HardhatEthersSigner) =>
    cUSD.confidentialBalanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, cUSDAddr, u));

  it("routes savings into the lending market as borrowable liquidity", async function () {
    const saver = signers[1];
    await save(saver, 100_000);
    expect(await prizeBal(saver)).to.equal(100_000n); // saver's confidential pool balance
    expect(await prize.isDepositor(saver.address)).to.equal(true);

    // the supplied liquidity is now borrowable: a borrower can draw it down
    const borrower = signers[2];
    await submitScore(borrower, 2_000_000_000, 1_000);
    await depositCollateral(borrower, 12_000);
    await borrow(borrower, 10_000);
    expect(await tokenBal(borrower)).to.equal(10_000n); // borrowed from the pooled savings
  });

  it("full cycle: supply → borrow → interest → harvest → draw → no-loss withdraw", async function () {
    const saver = signers[1];
    const borrower = signers[2];

    // 1. saver saves 100k into the pool (supplied into the lending market)
    await save(saver, 100_000);

    // 2. a borrower borrows the liquidity against collateral, at a real encrypted rate
    await submitScore(borrower, 2_000_000_000, 1_000); // band 5 -> 300 bps at util 0
    await depositCollateral(borrower, 12_000);
    await borrow(borrower, 10_000); // required 11,000 <= collateral 12,000
    expect(await tokenBal(borrower)).to.equal(10_000n); // received the borrowed cUSD

    // 3. a year of interest accrues on the encrypted debt
    await time.increase(YEAR);
    await pool.accrue(MID, borrower.address);

    // 4. borrower repays principal + interest (300 = 10,000 * 300bps)
    await cUSD.mint(borrower.address, 300); // top up for the interest
    await cUSD.connect(borrower).setOperator(poolAddr, 4_102_444_800);
    await repay(borrower, 10_300);

    // 5. harvest the realized interest as the prize
    await prize.connect(admin).harvest();

    // 6. draw — the sole saver wins the harvested yield
    await runDraw();
    expect(await prizeBal(saver)).to.equal(100_300n); // principal + real yield prize

    // 7. no-loss withdraw of principal + winnings
    await prize.connect(saver).withdraw(...(await encInput(saver, 100_300)));
    expect(await prizeBal(saver)).to.equal(0n);
    expect(await tokenBal(saver)).to.equal(100_300n); // got it all back in real tokens
  });

  async function encInput(user: HardhatEthersSigner, amount: number): Promise<[string, string]> {
    const input = fhevm.createEncryptedInput(prizeAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    return [handles[0] as unknown as string, inputProof as unknown as string];
  }
});
