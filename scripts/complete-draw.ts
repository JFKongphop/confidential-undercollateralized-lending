import { ethers, fhevm } from "hardhat";
import { readFileSync } from "fs";
const D = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));

// Completes a stuck draw (drawPending == true): reveal the pending total, then fulfillDraw.
//   npx hardhat run scripts/complete-draw.ts --network sepolia
async function main() {
  await fhevm.initializeCLIApi();
  const p = await ethers.getContractAt("PrizePool", D.contracts.prize);
  if (!(await p.drawPending())) { console.log("no pending draw — nothing to do"); return; }

  const th = await p.pendingTotalHandle();
  console.log("pending total handle:", th);
  const dec = await fhevm.publicDecrypt([th]);
  const tx = await p.fulfillDraw(dec.abiEncodedClearValues ?? dec.clearValues, dec.decryptionProof);
  await tx.wait();
  console.log("fulfillDraw done. drawPending =", await p.drawPending(), "| drawId =", (await p.drawId()).toString());
}
main().catch((e) => { console.error(e); process.exit(1); });
