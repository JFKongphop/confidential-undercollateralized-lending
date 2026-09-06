import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Deploys the Confidential PoolTogether system: an ERC-7984 confidential test token + the PrizePool,
// seeds an initial prize (mock yield), and mints faucet tokens to the deployer.
//   npx hardhat run scripts/deploy-pool.ts --network localhost
//   npx hardhat run scripts/deploy-pool.ts --network sepolia
// Addresses are written to deployments/<network>.json.

const INITIAL_PRIZE = 5_000; // mock-yield prize seeded so judges see a live prize immediately
const FAUCET = 100_000; // deployer faucet mint

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying Confidential PoolTogether to "${network.name}" as ${deployer.address}\n`);

  const deploy = async (name: string, args: any[] = []) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(22)} ${await c.getAddress()}`);
    return c;
  };
  const tx = async (label: string, p: Promise<any>) => {
    await (await p).wait();
    console.log(`  ✓ ${label}`);
  };

  console.log("Deploying contracts:");
  const token = await deploy("MockConfidentialUSDT");
  const tokenAddr = await token.getAddress();
  const pool = await deploy("PrizePool", [tokenAddr]);
  const poolAddr = await pool.getAddress();

  console.log("\nSeeding + faucet:");
  await tx(`mint prize reserve (${INITIAL_PRIZE}) to pool`, token.mint(poolAddr, INITIAL_PRIZE));
  await tx(`seedPrize(${INITIAL_PRIZE})`, pool.seedPrize(INITIAL_PRIZE));
  await tx(`faucet mint (${FAUCET}) to deployer`, token.mint(deployer.address, FAUCET));

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    contracts: {
      pool: poolAddr,
      token: tokenAddr,
    },
    token: { symbol: "cUSD", name: "Confidential USD", decimals: 0 },
  };

  const dir = join(__dirname, "..", "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${network.name}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nDone. Addresses written to ${file}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
