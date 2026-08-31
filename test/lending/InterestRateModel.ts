import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// InterestRateModel (contract #3) — encrypted borrow rate. The rate stays encrypted so it cannot
// be inverted (rate -> premium -> band -> score). Includes the attack demo: a test-only public
// path that leaks the rate, plus a script that inverts it — proving why the production path must
// keep the rate encrypted.

const BASE_BPS = 200;
const PREMIUM = { 1: 1200, 2: 800, 3: 500, 4: 250, 5: 100 } as const;

describe("InterestRateModel", function () {
  let repTracker: any;
  let oracle: any;
  let oracleAddr: string;
  let rateModel: any;
  let rateAddr: string;
  let signers: HardhatEthersSigner[];

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    repTracker = await (await ethers.getContractFactory("RepaymentTracker")).deploy();
    oracle = await (await ethers.getContractFactory("CreditOracle")).deploy(await repTracker.getAddress());
    oracleAddr = await oracle.getAddress();
    rateModel = await (await ethers.getContractFactory("InterestRateModel")).deploy(oracleAddr);
    rateAddr = await rateModel.getAddress();

    // grant the band handle to the rate model at submit time.
    await oracle.setRateModel(rateAddr);
  });

  async function submitBand5(user: HardhatEthersSigner) {
    const input = fhevm.createEncryptedInput(oracleAddr, user.address);
    input.add64(2_000_000_000); // balScore 2000 -> score 1000 -> band 5
    input.add32(1_000);
    const { handles, inputProof } = await input.encrypt();
    await oracle.connect(user).submitInputs(handles[0], handles[1], inputProof);
  }

  it("returns an encrypted rate the borrower can decrypt but others cannot", async function () {
    const user = signers[1];
    await submitBand5(user);

    // utilization 0 => plainPart = BASE(200); band 5 premium = 100 => rate 300.
    await rateModel.connect(user).rateFor(user.address, 0);
    const h = await rateModel.rateOf(user.address);

    expect(await fhevm.userDecryptEuint(FhevmType.euint32, h, rateAddr, user)).to.equal(
      BigInt(BASE_BPS + PREMIUM[5]),
    );

    // a third party is NOT ACL'd on the encrypted rate.
    let failed = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, h, rateAddr, signers[4]);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("folds plaintext utilization into the rate", async function () {
    const user = signers[2];
    await submitBand5(user);

    // utilization 5000bps => slope part = 1000*5000/10000 = 500; plainPart = 700; +premium 100 = 800.
    await rateModel.connect(user).rateFor(user.address, 5_000);
    const h = await rateModel.rateOf(user.address);
    expect(await fhevm.userDecryptEuint(FhevmType.euint32, h, rateAddr, user)).to.equal(800n);
  });

  it("ATTACK DEMO: a leaked (public) rate can be inverted back to the band, encrypted cannot", async function () {
    const user = signers[3];
    await submitBand5(user); // actual band = 5

    // The leak: rateForRevealed makes the rate publicly decryptable.
    await rateModel.connect(user).rateForRevealed(user.address, 0);
    const leakedHandle = await rateModel.revealedRateHandleOf(user.address);
    const leakedRate = await fhevm.publicDecryptEuint(FhevmType.euint32, leakedHandle);

    // Attacker script: invert rate -> premium -> band (utilization is public = 0).
    const premium = Number(leakedRate) - BASE_BPS;
    const invertedBand = (Object.keys(PREMIUM) as unknown as (keyof typeof PREMIUM)[]).find(
      (b) => PREMIUM[b] === premium,
    );
    expect(Number(invertedBand)).to.equal(5); // the public rate leaked the private band

    // The production path keeps the same rate encrypted — the attacker cannot read it.
    await rateModel.connect(user).rateFor(user.address, 0);
    const encHandle = await rateModel.rateOf(user.address);
    let failed = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, encHandle, rateAddr, signers[4]);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true); // same script is defeated by the encrypted path
  });
});
