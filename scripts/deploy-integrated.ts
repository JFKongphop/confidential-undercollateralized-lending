import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Deploys the INTEGRATED system: a confidential LendingPool market (cWETH collateral -> cUSD debt)
// whose borrowable liquidity is supplied by the confidential PrizePool. Borrowers pay encrypted
// interest; the PrizePool harvests that real yield as its prize. One integrated market, at par oracle.
//   npx hardhat run scripts/deploy-integrated.ts --network sepolia
// Addresses -> deployments/<network>.json.

const MID = 0;
const FAUCET = 200_000;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying INTEGRATED CipherPool to "${network.name}" as ${deployer.address}\n`);

  const deploy = async (name: string, args: any[] = []) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(22)} ${await c.getAddress()}`);
    return c;
  };
  const tx = async (label: string, p: Promise<any>) => { await (await p).wait(); console.log(`  ✓ ${label}`); };

  console.log("Tokens + oracle:");
  const cWETH = await deploy("MockConfidentialUSDT"); // collateral
  const cUSD = await deploy("MockConfidentialUSDT"); // savings asset = market debt token
  const agg = await deploy("MockAggregator", [100_000_000, 8]); // par (1 collateral = 1 debt)
  const adapter = await deploy("OracleAdapter", [await agg.getAddress(), 24 * 60 * 60]);

  console.log("Lending stack:");
  const repTracker = await deploy("RepaymentTracker");
  const credit = await deploy("CreditOracle", [await repTracker.getAddress()]);
  const rateModel = await deploy("InterestRateModel", [await credit.getAddress()]);
  const positions = await deploy("PositionManager");
  const guarantor = await deploy("GuarantorModule");
  const pool = await deploy("LendingPool");
  const poolAddr = await pool.getAddress();

  console.log("Prize pool:");
  const prize = await deploy("PrizePool", [await cUSD.getAddress()]);
  const prizeAddr = await prize.getAddress();

  console.log("\nWiring:");
  await tx("addMarket cWETH->cUSD", pool.addMarket(await cWETH.getAddress(), await cUSD.getAddress(), await adapter.getAddress(), 8_000));
  await tx("repTracker.setLendingPool", repTracker.setLendingPool(poolAddr));
  await tx("repTracker.setCreditOracle", repTracker.setCreditOracle(await credit.getAddress()));
  await tx("credit.setLendingPool", credit.setLendingPool(poolAddr));
  await tx("credit.setRateModel", credit.setRateModel(await rateModel.getAddress()));
  await tx("rateModel.setLendingPool", rateModel.setLendingPool(poolAddr));
  await tx("positions.setLendingPool", positions.setLendingPool(poolAddr));
  await tx("guarantor.setLendingPool", guarantor.setLendingPool(poolAddr));
  await tx("pool.setCreditOracle", pool.setCreditOracle(await credit.getAddress()));
  await tx("pool.setPositions", pool.setPositions(await positions.getAddress()));
  await tx("pool.setRepaymentTracker", pool.setRepaymentTracker(await repTracker.getAddress()));
  await tx("pool.setGuarantor", pool.setGuarantor(await guarantor.getAddress()));
  await tx("pool.setRateModel", pool.setRateModel(await rateModel.getAddress()));
  await tx("pool.setUtilizationBps(0)", pool.setUtilizationBps(0)); // band-5 => 300 bps
  await tx("prize.setLending(pool)", prize.setLending(poolAddr));
  await tx("pool.setYieldSupplier(prize)", pool.setYieldSupplier(prizeAddr, MID));

  console.log("\nFaucet:");
  await tx(`mint cUSD ${FAUCET}`, cUSD.mint(deployer.address, FAUCET));
  await tx(`mint cWETH ${FAUCET}`, cWETH.mint(deployer.address, FAUCET));

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    marketId: MID,
    contracts: {
      pool: poolAddr,
      prize: prizeAddr,
      token: await cUSD.getAddress(), // savings asset (cUSD) — PrizePool.asset
      collateral: await cWETH.getAddress(), // borrower collateral (cWETH)
      credit: await credit.getAddress(),
      rateModel: await rateModel.getAddress(),
      positions: await positions.getAddress(),
      repTracker: await repTracker.getAddress(),
      guarantor: await guarantor.getAddress(),
      oracle: await adapter.getAddress(),
    },
    token: { symbol: "cUSD", name: "Confidential USD", decimals: 0 },
    collateralToken: { symbol: "cWETH", name: "Confidential WETH", decimals: 0 },
  };

  const dir = join(__dirname, "..", "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`\nDone. Addresses written to deployments/${network.name}.json\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
