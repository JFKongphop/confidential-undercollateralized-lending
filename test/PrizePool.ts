import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// Confidential PoolTogether — no-loss prize savings on Zama FHEVM.
// deposit (encrypted) -> hold a confidential balance -> draw (FHE-random, deposit-weighted winner
// selection over encrypted balances) -> only the winner's encrypted balance grows -> withdraw
// principal + any winnings at any time (no loss).

const EMPTY = "0x"; // deposit
const PRIZE_DATA = ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]); // prize-reserve top-up

describe("PrizePool (confidential no-loss prize savings)", function () {
  let signers: HardhatEthersSigner[];
  let admin: HardhatEthersSigner;
  let token: any, tokenAddr: string;
  let pool: any, poolAddr: string;

  before(async function () {
    signers = await ethers.getSigners();
    admin = signers[0];
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    token = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    tokenAddr = await token.getAddress();
    pool = await (await ethers.getContractFactory("PrizePool")).deploy(tokenAddr);
    poolAddr = await pool.getAddress();
  });

  async function deposit(user: HardhatEthersSigner, amount: number) {
    await token.mint(user.address, amount);
    const input = fhevm.createEncryptedInput(tokenAddr, user.address); // encrypt against the TOKEN
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await token
      .connect(user)
      ["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, EMPTY);
  }

  async function fundPrize(amount: number) {
    await token.mint(admin.address, amount);
    const input = fhevm.createEncryptedInput(tokenAddr, admin.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await token
      .connect(admin)
      ["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, PRIZE_DATA);
  }

  async function withdraw(user: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(poolAddr, user.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await pool.connect(user).withdraw(handles[0], inputProof);
  }

  // run the full draw: reveal total (Form-B) then the weighted selection
  async function runDraw() {
    await pool.connect(admin).requestDraw();
    const handle = await pool.pendingTotalHandle();
    const res = await fhevm.publicDecrypt([handle]);
    await pool.fulfillDraw(res.abiEncodedClearValues, res.decryptionProof);
  }

  const readBal = (u: HardhatEthersSigner) =>
    pool.balanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, poolAddr, u));
  const readTokenBal = (u: HardhatEthersSigner) =>
    token.confidentialBalanceOf(u.address).then((h: string) => fhevm.userDecryptEuint(FhevmType.euint64, h, tokenAddr, u));

  it("holds a confidential deposit balance readable only by the depositor", async function () {
    const alice = signers[1];
    await deposit(alice, 1_000);
    expect(await readBal(alice)).to.equal(1_000n);
    expect(await pool.depositorCount()).to.equal(1n);
    expect(await pool.isDepositor(alice.address)).to.equal(true);
  });

  it("aggregates multiple deposits from the same user", async function () {
    const alice = signers[1];
    await deposit(alice, 1_000);
    await deposit(alice, 500);
    expect(await readBal(alice)).to.equal(1_500n);
    expect(await pool.depositorCount()).to.equal(1n); // registered once
  });

  it("withdraws principal at any time — no loss", async function () {
    const alice = signers[2];
    await deposit(alice, 1_000);
    await withdraw(alice, 400);
    expect(await readBal(alice)).to.equal(600n);
    expect(await readTokenBal(alice)).to.equal(400n); // tokens returned
  });

  it("clamps an over-withdraw to the balance (never reverts, never leaks)", async function () {
    const alice = signers[3];
    await deposit(alice, 1_000);
    await withdraw(alice, 5_000); // more than balance
    expect(await readBal(alice)).to.equal(0n);
    expect(await readTokenBal(alice)).to.equal(1_000n); // got exactly their principal back
  });

  it("awards the whole prize to the sole depositor on a draw", async function () {
    const alice = signers[4];
    await deposit(alice, 1_000);
    await fundPrize(300);

    await runDraw();

    expect(await readBal(alice)).to.equal(1_300n); // principal + prize
    // no-loss + winnings: withdraw everything
    await withdraw(alice, 1_300);
    expect(await readTokenBal(alice)).to.equal(1_300n);
  });

  it("selects exactly one winner over encrypted balances and conserves the prize", async function () {
    const alice = signers[5];
    const bob = signers[6];
    await deposit(alice, 1_000);
    await deposit(bob, 3_000);
    await fundPrize(400);

    await runDraw();

    const a = await readBal(alice);
    const b = await readBal(bob);
    // each depositor got either their principal (no win) or principal + full prize (win)
    const aWon = a === 1_400n;
    const bWon = b === 3_400n;
    expect(aWon || bWon).to.equal(true); // someone won
    expect(aWon && bWon).to.equal(false); // exactly one winner
    expect(a + b).to.equal(1_000n + 3_000n + 400n); // prize fully distributed, no loss
  });

  it("runs consecutive draws, each awarding its own funded prize", async function () {
    const alice = signers[7];
    await deposit(alice, 1_000);

    await fundPrize(100);
    await runDraw();
    expect(await readBal(alice)).to.equal(1_100n);

    await fundPrize(50);
    await runDraw();
    expect(await readBal(alice)).to.equal(1_150n);

    expect(await pool.drawId()).to.equal(2n);
  });

  it("freezes deposits and withdrawals while a draw is pending, then unfreezes", async function () {
    const alice = signers[8];
    await deposit(alice, 1_000);
    await fundPrize(100);

    await pool.connect(admin).requestDraw();
    expect(await pool.drawPending()).to.equal(true);
    await expect(deposit(alice, 100)).to.be.reverted; // token callback require(!drawPending)
    await expect(withdraw(alice, 100)).to.be.revertedWith("draw in progress");

    // finish the draw
    const handle = await pool.pendingTotalHandle();
    const res = await fhevm.publicDecrypt([handle]);
    await pool.fulfillDraw(res.abiEncodedClearValues, res.decryptionProof);
    expect(await pool.drawPending()).to.equal(false);

    // works again after
    await withdraw(alice, 1_100);
    expect(await readBal(alice)).to.equal(0n);
  });

  it("only the admin can request a draw", async function () {
    const alice = signers[9];
    await deposit(alice, 1_000);
    await expect(pool.connect(alice).requestDraw()).to.be.revertedWith("not admin");
  });

  it("rejects a draw with no depositors", async function () {
    await expect(pool.connect(admin).requestDraw()).to.be.revertedWith("no depositors");
  });
});
