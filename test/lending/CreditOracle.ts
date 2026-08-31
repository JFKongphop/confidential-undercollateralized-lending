import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// CreditOracle (contract #1) — encrypted credit scoring. Verifies the weighted-sum score and the
// nested-select risk band are computed correctly on ciphertext and stay private (never decrypted
// on-chain; the user decrypts their own score/band handles off-chain).

describe("CreditOracle", function () {
  let repTracker: any;
  let oracle: any;
  let oracleAddr: string;
  let signers: HardhatEthersSigner[];

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    const repFactory = await ethers.getContractFactory("RepaymentTracker");
    repTracker = await repFactory.deploy();

    const oracleFactory = await ethers.getContractFactory("CreditOracle");
    oracle = await oracleFactory.deploy(await repTracker.getAddress());
    oracleAddr = await oracle.getAddress();
  });

  async function submit(user: HardhatEthersSigner, balances: number, age: number) {
    const input = fhevm.createEncryptedInput(oracleAddr, user.address);
    input.add64(balances);
    input.add32(age);
    const { handles, inputProof } = await input.encrypt();
    await oracle.connect(user).submitInputs(handles[0], handles[1], inputProof);
  }

  async function readScore(user: HardhatEthersSigner): Promise<bigint> {
    const h = await oracle.scoreOf(user.address);
    return fhevm.userDecryptEuint(FhevmType.euint32, h, oracleAddr, user);
  }

  async function readBand(user: HardhatEthersSigner): Promise<bigint> {
    const h = await oracle.bandOf(user.address);
    return fhevm.userDecryptEuint(FhevmType.euint8, h, oracleAddr, user);
  }

  it("computes a mid-tier score and band (band 3)", async function () {
    const user = signers[1];
    // balScore = 500e6/1e6 = 500; raw = 500*40 + 1000*20 + 0*40 = 40000; score = 400 => band 3.
    await submit(user, 500_000_000, 1_000);
    expect(await readScore(user)).to.equal(400n);
    expect(await readBand(user)).to.equal(3n);
    expect(await oracle.hasScore(user.address)).to.equal(true);
  });

  it("computes a top-tier band (band 5) for strong inputs", async function () {
    const user = signers[2];
    // balScore = 2000; raw = 2000*40 + 1000*20 = 100000; score = 1000 => band 5.
    await submit(user, 2_000_000_000, 1_000);
    expect(await readScore(user)).to.equal(1000n);
    expect(await readBand(user)).to.equal(5n);
  });

  it("computes the worst band (band 1) for weak inputs", async function () {
    const user = signers[3];
    // balScore = 100; raw = 100*40 + 100*20 = 6000; score = 60 => band 1.
    await submit(user, 100_000_000, 100);
    expect(await readScore(user)).to.equal(60n);
    expect(await readBand(user)).to.equal(1n);
  });

  it("exposes a private credit-report breakdown to the borrower only", async function () {
    const user = signers[1];
    // balScore 500, age 1000, rep 0 -> contributions 200 / 200 / 0, summing to score 400.
    await submit(user, 500_000_000, 1_000);

    const bd = await oracle.scoreBreakdown(user.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint32, bd.balance, oracleAddr, user);
    const age = await fhevm.userDecryptEuint(FhevmType.euint32, bd.age, oracleAddr, user);
    const history = await fhevm.userDecryptEuint(FhevmType.euint32, bd.history, oracleAddr, user);

    expect(balance).to.equal(200n); // 500 * 40 / 100
    expect(age).to.equal(200n); // 1000 * 20 / 100
    expect(history).to.equal(0n); // 0 * 40 / 100
    expect(balance + age + history).to.equal(await readScore(user)); // == 400

    // the breakdown is a PRIVATE credit report — a third party cannot read any component.
    let failed = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, bd.balance, oracleAddr, signers[4]);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("keeps the raw score private to the borrower (a third party cannot decrypt it)", async function () {
    const user = signers[1];
    await submit(user, 500_000_000, 1_000);
    const h = await oracle.scoreOf(user.address);

    let failed = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, h, oracleAddr, signers[4]);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });
});
