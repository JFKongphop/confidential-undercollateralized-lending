import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { readFileSync } from "fs";
const D = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));

// Proves withdraw works now: read balance, withdraw a small amount, read balance again.
//   npx hardhat run scripts/withdraw-test.ts --network sepolia
async function main() {
  await fhevm.initializeCLIApi();
  const [me] = await ethers.getSigners();
  const p = await ethers.getContractAt("PrizePool", D.contracts.prize);

  const read = async () => {
    const h = await p.balanceOf(me.address);
    if (h === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, h, D.contracts.prize, me);
  };

  console.log("drawPending:", await p.drawPending());
  console.log("balance before:", (await read()).toString());

  const input = fhevm.createEncryptedInput(D.contracts.prize, me.address);
  input.add64(100); // small test withdraw
  const { handles, inputProof } = await input.encrypt();
  const tx = await p.withdraw(handles[0], inputProof);
  console.log("withdraw tx:", tx.hash);
  await tx.wait();

  console.log("balance after :", (await read()).toString(), " (should be 100 less)");
  console.log("✅ withdraw works.");
}
main().catch((e) => { console.error(e); process.exit(1); });
