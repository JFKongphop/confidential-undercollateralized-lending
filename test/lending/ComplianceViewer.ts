import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// ComplianceViewer (contract #9) — scoped, revocable auditor access. The ACL is the feature: an
// auditor decrypts exactly one whitelisted field and provably cannot decrypt anything else. The
// MockHandleHolder plays the "holding contract" that delegates scoped access.

describe("ComplianceViewer", function () {
  let viewer: any;
  let viewerAddr: string;
  let holder: any;
  let holderAddr: string;
  let signers: HardhatEthersSigner[];

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    viewer = await (await ethers.getContractFactory("ComplianceViewer")).deploy();
    viewerAddr = await viewer.getAddress();
    holder = await (await ethers.getContractFactory("MockHandleHolder")).deploy();
    holderAddr = await holder.getAddress();
  });

  async function store(user: HardhatEthersSigner, secret: number) {
    const input = fhevm.createEncryptedInput(holderAddr, user.address);
    input.add64(secret);
    const { handles, inputProof } = await input.encrypt();
    await holder.connect(user).store(handles[0], inputProof);
  }

  it("grants a whitelisted auditor scoped decrypt access to exactly one field", async function () {
    const user = signers[1];
    const auditor = signers[5];
    await store(user, 42);
    await viewer.setAuditor(auditor.address, true);

    await expect(holder.connect(user).delegateAudit(viewerAddr, auditor.address)).to.emit(viewer, "AccessGranted");

    const handle = await holder.secretOf(user.address);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, handle, holderAddr, auditor)).to.equal(42n);
  });

  it("rejects granting access to a non-whitelisted auditor", async function () {
    const user = signers[1];
    const notAuditor = signers[6];
    await store(user, 42);

    await expect(holder.connect(user).delegateAudit(viewerAddr, notAuditor.address)).to.be.reverted;
  });

  it("keeps every other field private to the auditor (scoped, not blanket)", async function () {
    const user1 = signers[1];
    const user2 = signers[2];
    const auditor = signers[5];
    await store(user1, 42);
    await store(user2, 99);
    await viewer.setAuditor(auditor.address, true);

    // auditor is granted user1's field only.
    await holder.connect(user1).delegateAudit(viewerAddr, auditor.address);

    // user2's field was never granted — the auditor cannot decrypt it.
    const other = await holder.secretOf(user2.address);
    let failed = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint64, other, holderAddr, auditor);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });
});
