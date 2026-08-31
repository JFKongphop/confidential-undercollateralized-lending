import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

// Threat-model demo: why the borrow rate must stay ENCRYPTED end-to-end.
//
// The InterestRateModel picks a risk premium from a PUBLIC per-band table. So if the final rate is
// ever revealed, an attacker can invert it: rate -> premium -> band -> (a range of) the borrower's
// private credit score. This script runs the attack against a deliberately-leaky path
// (`rateForRevealed`) and shows the same attack is defeated by the production path (`rateFor`),
// which keeps the rate encrypted and ACL'd to the borrower + pool only.
//
// Run (two terminals):
//   npx hardhat node                                              # terminal 1: FHEVM mock node
//   npx hardhat run --network localhost scripts/attack-rate-inversion.ts   # terminal 2

const BASE_BPS = 200;
const PREMIUM: Record<number, number> = { 1: 1200, 2: 800, 3: 500, 4: 250, 5: 100 };

async function main() {
  await fhevm.initializeCLIApi();

  if (!fhevm.isMock) {
    console.log("This demo runs on the FHEVM mock network. Use the default hardhat network.");
    return;
  }

  const signers = await ethers.getSigners();
  const borrower = signers[1];
  const attacker = signers[2];

  const repTracker = await (await ethers.getContractFactory("RepaymentTracker")).deploy();
  const oracle = await (await ethers.getContractFactory("CreditOracle")).deploy(await repTracker.getAddress());
  const oracleAddr = await oracle.getAddress();
  const rateModel = await (await ethers.getContractFactory("InterestRateModel")).deploy(oracleAddr);
  const rateAddr = await rateModel.getAddress();
  await oracle.setRateModel(rateAddr); // grant the encrypted band to the rate model

  // The borrower privately submits inputs. Their band (here: 5) is computed and stored ENCRYPTED —
  // it is never revealed on-chain.
  const input = fhevm.createEncryptedInput(oracleAddr, borrower.address);
  input.add64(2_000_000_000);
  input.add32(1_000);
  const enc = await input.encrypt();
  await oracle.connect(borrower).submitInputs(enc.handles[0], enc.handles[1], enc.inputProof);

  console.log("=== Confidential lending — rate-inversion attack demo ===");
  console.log("The borrower's credit band is encrypted on-chain. Can an attacker recover it?\n");

  // ── VULNERABLE PATH: the rate is made publicly decryptable ──────────────────
  await rateModel.connect(borrower).rateForRevealed(borrower.address, 0);
  const leakedHandle = await rateModel.revealedRateHandleOf(borrower.address);
  const leakedRate = await fhevm.publicDecryptEuint(FhevmType.euint32, leakedHandle);

  const premium = Number(leakedRate) - BASE_BPS; // utilization is public (0), so subtract the base
  const recoveredBand = Object.keys(PREMIUM).find((b) => PREMIUM[Number(b)] === premium);
  console.log(`[VULNERABLE] leaked public rate = ${leakedRate} bps`);
  console.log(`[ATTACKER]   invert: premium ${premium} -> band ${recoveredBand}   <== PRIVATE BAND LEAKED\n`);

  // ── SECURE PATH: the rate stays encrypted (production `rateFor`) ─────────────
  await rateModel.connect(borrower).rateFor(borrower.address, 0);
  const encHandle = await rateModel.rateOf(borrower.address);

  let attackerReadIt = true;
  try {
    await fhevm.userDecryptEuint(FhevmType.euint32, encHandle, rateAddr, attacker);
  } catch {
    attackerReadIt = false;
  }
  const borrowerRate = await fhevm.userDecryptEuint(FhevmType.euint32, encHandle, rateAddr, borrower);

  console.log(`[SECURE]     encrypted rate handle = ${encHandle}`);
  console.log(`[ATTACKER]   can decrypt it? ${attackerReadIt ? "YES (leak!)" : "NO — ACLNotAllowed"}`);
  console.log(`[BORROWER]   can decrypt own rate: ${borrowerRate} bps (only the borrower + pool can)\n`);

  console.log("Conclusion: revealing the rate leaks the private band/score via the public premium");
  console.log("table. The production path keeps the rate encrypted end-to-end, defeating the same");
  console.log("inversion script.");

  if (attackerReadIt) throw new Error("SECURE path unexpectedly leaked the rate to the attacker");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
