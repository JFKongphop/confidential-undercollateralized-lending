import { ethers } from "hardhat";
import { readFileSync } from "fs";
const D = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
async function main() {
  const p = await ethers.getContractAt("PrizePool", D.contracts.prize);
  console.log("drawPending  :", await p.drawPending());
  console.log("drawId       :", (await p.drawId()).toString());
  console.log("depositors   :", (await p.depositorCount()).toString());
  const [me] = await ethers.getSigners();
  console.log("me isDepositor:", await p.isDepositor(me.address));
}
main().catch((e) => { console.error(e); process.exit(1); });
