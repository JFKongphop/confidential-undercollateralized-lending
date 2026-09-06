import { ethers } from "hardhat";
import { readFileSync } from "fs";
const D = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
const TX = process.env.TX!;

async function main() {
  const prov = ethers.provider;
  const tx = await prov.getTransaction(TX);
  const rc = await prov.getTransactionReceipt(TX);
  console.log("to        :", tx?.to, "(prize =", D.contracts.prize + ")");
  console.log("from      :", tx?.from);
  console.log("gasLimit  :", tx?.gasLimit?.toString());
  console.log("gasUsed   :", rc?.gasUsed?.toString());
  console.log("status    :", rc?.status, "(0 = reverted)");
  const nearCap = rc && tx && rc.gasUsed >= (tx.gasLimit * 97n) / 100n;
  console.log("out-of-gas? :", nearCap, "(gasUsed within 3% of the cap)");

  const p = await ethers.getContractAt("PrizePool", D.contracts.prize);
  console.log("\n-- pool --");
  console.log("drawPending:", await p.drawPending());
  console.log("from isDepositor:", await p.isDepositor(tx!.from));

  // try to get the revert reason via a call at that block
  try {
    await prov.call({ to: tx!.to!, from: tx!.from, data: tx!.data, blockTag: rc!.blockNumber });
    console.log("replay: (no revert on replay)");
  } catch (e: any) {
    console.log("revert reason:", e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
