import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// GuarantorModule (contract #8) — the hardest ACL. A third party backs a borrower with an
// encrypted amount. The AGGREGATE is readable by the pool ONLY — never the borrower or other
// guarantors. This suite verifies that confidentiality invariant directly.

describe("GuarantorModule", function () {
  let guarantor: any;
  let guarantorAddr: string;
  let signers: HardhatEthersSigner[];
  let pool: HardhatEthersSigner; // an EOA standing in for the pool address for ACL checks

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    pool = signers[9];

    guarantor = await (await ethers.getContractFactory("GuarantorModule")).deploy();
    guarantorAddr = await guarantor.getAddress();
    await guarantor.setLendingPool(pool.address);
  });

  async function guarantee(from: HardhatEthersSigner, borrower: string, amount: number) {
    const input = fhevm.createEncryptedInput(guarantorAddr, from.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await guarantor.connect(from).guarantee(0, borrower, handles[0], inputProof);
  }

  it("aggregates backing and exposes it to the pool only", async function () {
    const borrower = signers[1];
    const g1 = signers[2];
    const g2 = signers[3];

    await guarantee(g1, borrower.address, 1_000);
    await guarantee(g2, borrower.address, 500);

    expect(await guarantor.hasStake(0, borrower.address)).to.equal(true);

    const stakeHandle = await guarantor.stakeFor(0, borrower.address);
    // the pool CAN read the aggregate (1_500).
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, stakeHandle, guarantorAddr, pool)).to.equal(1_500n);
  });

  it("hides the summed aggregate from the borrower and from every guarantor", async function () {
    const borrower = signers[1];
    const g1 = signers[2];
    const g2 = signers[3];
    // Two contributions: the summed aggregate is a FRESH handle, granted to the pool only.
    // (Each guarantor is granted only their own contribution handle, never the sum.)
    await guarantee(g1, borrower.address, 1_000);
    await guarantee(g2, borrower.address, 500);
    const stakeHandle = await guarantor.stakeFor(0, borrower.address);

    for (const who of [borrower, g1, g2]) {
      let failed = false;
      try {
        await fhevm.userDecryptEuint(FhevmType.euint64, stakeHandle, guarantorAddr, who);
      } catch {
        failed = true;
      }
      expect(failed, `${who.address} must not read the aggregate`).to.equal(true);
    }
  });
});
