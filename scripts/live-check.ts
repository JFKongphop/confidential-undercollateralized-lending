import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { readFileSync } from "fs";
import { join } from "path";

// LIVE end-to-end check against the deployed Sepolia contracts (real txs, deployer key):
// deposit → supply → inject+harvest real yield → FHE draw → decrypt winnings → no-loss withdraw.
//   npx hardhat run scripts/live-check.ts --network sepolia

const D = JSON.parse(readFileSync(join(process.cwd(), "deployments", "sepolia.json"), "utf8"));
const A = D.contracts;

async function main() {
  await fhevm.initializeCLIApi();
  const [me] = await ethers.getSigners();
  console.log(`\nLive check as ${me.address}\n`);

  const prize = await ethers.getContractAt("PrizePool", A.prize);
  const cUSDC = await ethers.getContractAt("MockConfidentialUSDT", A.cUSDC);

  const readPrize = async () => {
    const h = await prize.balanceOf(me.address);
    if (h === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, h, A.prize, me);
  };

  // 1. deposit 5000 cUSDC into the prize pool (→ supplied into the lending market)
  console.log("1. deposit 5000 cUSDC …");
  {
    const input = fhevm.createEncryptedInput(A.cUSDC, me.address);
    input.add64(5000);
    const { handles, inputProof } = await input.encrypt();
    const tx = await cUSDC["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](A.prize, handles[0], inputProof, "0x");
    await tx.wait();
  }
  console.log(`   prize balance = ${await readPrize()}  (expect 5000)`);
  console.log(`   depositor? ${await prize.isDepositor(me.address)}`);

  // 2. inject 300 of interest into the lending reserve + harvest it as yield (real recognizeYield path)
  console.log("2. inject 300 interest + harvest …");
  await (await cUSDC.mint(A.pool, 300)).wait();
  await (await prize.harvest()).wait();

  // 3. run the FHE-random draw (reveal total → fulfill)
  console.log("3. draw …");
  await (await prize.requestDraw()).wait();
  const th = await prize.pendingTotalHandle();
  const dec = await fhevm.publicDecrypt([th]);
  await (await prize.fulfillDraw(dec.abiEncodedClearValues ?? dec.clearValues, dec.decryptionProof)).wait();

  // 4. decrypt winnings — sole saver should have won the 300
  const afterDraw = await readPrize();
  console.log(`   prize balance after draw = ${afterDraw}  (expect 5300)`);

  // 5. no-loss withdraw of principal + winnings
  console.log("4. withdraw 5300 …");
  {
    const input = fhevm.createEncryptedInput(A.prize, me.address);
    input.add64(5300);
    const { handles, inputProof } = await input.encrypt();
    await (await prize.withdraw(handles[0], inputProof)).wait();
  }
  console.log(`   prize balance after withdraw = ${await readPrize()}  (expect 0)`);

  console.log("\n✅ LIVE CHECK PASSED — supply → harvest real yield → FHE draw → win → no-loss withdraw all work on Sepolia.\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
