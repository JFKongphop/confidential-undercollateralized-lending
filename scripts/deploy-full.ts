import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// FULL INTEGRATED DEPLOY: the complete confidential lending system (multi-asset markets, real
// Chainlink feeds, credit scoring, interest, liquidation, compliance, guarantors) PLUS the
// confidential PrizePool wired as the sole cUSDC liquidity supplier — so savers' deposits are lent
// out and the prize is the real interest borrowers pay.
//   npx hardhat run scripts/deploy-full.ts --network sepolia
// Writes deployments/<network>.json (deploy-all shape + prize/savings keys).

const MARKETS = [
  { collat: "cWETH", feed: "ETH/USD", lltvBps: 8_000 },
  { collat: "cWBTC", feed: "BTC/USD", lltvBps: 8_000 },
  { collat: "cLINK", feed: "LINK/USD", lltvBps: 7_500 },
  { collat: "cEUR", feed: "EUR/USD", lltvBps: 8_500 }, // ~1:1 — the clean demo market
];
const PAIR_MARKETS = [
  { collat: "cWETH", debt: "cWBTC", collatFeed: "ETH/USD", debtFeed: "BTC/USD", lltvBps: 7_500 },
  { collat: "cWBTC", debt: "cWETH", collatFeed: "BTC/USD", debtFeed: "ETH/USD", lltvBps: 7_500 },
];
const YIELD_MID = 3; // cEUR->cUSDC is the demo/yield market (debtToken cUSDC; recognizeYield reads cUSDC globally)
const STALENESS = (net: string) => (net === "sepolia" ? 24 * 60 * 60 : 60 * 60);
const FAUCET = 300_000;

async function main() {
  const [deployer] = await ethers.getSigners();
  const isSepolia = network.name === "sepolia";
  console.log(`\nFULL integrated deploy to "${network.name}" as ${deployer.address}\n`);

  const deploy = async (name: string, args: any[] = []) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(22)} ${await c.getAddress()}`);
    return c;
  };
  const tx = async (label: string, p: Promise<any>) => { await (await p).wait(); console.log(`  ✓ ${label}`); };

  console.log("Feed registry + tokens:");
  const registry = await deploy("ChainlinkFeedRegistry");
  const cUSDC = await deploy("MockConfidentialUSDT"); // savings + shared debt asset
  const tokens: Record<string, any> = { cUSDC };
  for (const m of MARKETS) tokens[m.collat] = await deploy("MockConfidentialUSDT");

  const getFeed = async (symbol: string): Promise<string> => {
    if (isSepolia) return registry.feedOf(symbol);
    const agg = await (await ethers.getContractFactory("MockAggregator")).deploy(100_000_000, 8);
    await agg.waitForDeployment();
    return agg.getAddress();
  };

  console.log("Core protocol:");
  const repTracker = await deploy("RepaymentTracker");
  const creditOracle = await deploy("CreditOracle", [await repTracker.getAddress()]);
  const rateModel = await deploy("InterestRateModel", [await creditOracle.getAddress()]);
  const positions = await deploy("PositionManager");
  const guarantor = await deploy("GuarantorModule");
  const auction = await deploy("LiquidationAuction");
  const engine = await deploy("LiquidationEngine");
  const pool = await deploy("LendingPool");
  const compliance = await deploy("ComplianceViewer");
  const prize = await deploy("PrizePool", [await cUSDC.getAddress()]);

  const A: Record<string, string> = {
    registry: await registry.getAddress(), repTracker: await repTracker.getAddress(),
    creditOracle: await creditOracle.getAddress(), rateModel: await rateModel.getAddress(),
    positions: await positions.getAddress(), guarantor: await guarantor.getAddress(),
    auction: await auction.getAddress(), engine: await engine.getAddress(),
    pool: await pool.getAddress(), compliance: await compliance.getAddress(),
    prize: await prize.getAddress(),
  };
  for (const k of Object.keys(tokens)) A[k] = await tokens[k].getAddress();

  console.log("\nMarkets (feeds: %s):", isSepolia ? "on-chain Chainlink registry" : "mock @ par");
  const marketMeta: any[] = [];
  let id = 0;
  for (const m of MARKETS) {
    const adapter = await (await ethers.getContractFactory("OracleAdapter")).deploy(await getFeed(m.feed), STALENESS(network.name));
    await adapter.waitForDeployment();
    const oracleAddr = await adapter.getAddress();
    await tx(`addMarket ${id}: ${m.collat}->cUSDC (${m.feed})`, pool.addMarket(A[m.collat], A.cUSDC, oracleAddr, m.lltvBps));
    marketMeta.push({ id: id++, collateral: m.collat, debt: "cUSDC", feed: m.feed, oracle: oracleAddr, lltvBps: m.lltvBps, collateralToken: A[m.collat], debtToken: A.cUSDC });
  }
  for (const m of PAIR_MARKETS) {
    const pairOracle = await (await ethers.getContractFactory("PairPriceOracle")).deploy(await getFeed(m.collatFeed), await getFeed(m.debtFeed), STALENESS(network.name));
    await pairOracle.waitForDeployment();
    const oracleAddr = await pairOracle.getAddress();
    await tx(`addMarket ${id}: ${m.collat}->${m.debt}`, pool.addMarket(A[m.collat], A[m.debt], oracleAddr, m.lltvBps));
    await tx(`${m.debt}.mint(pool, liquidity)`, tokens[m.debt].mint(A.pool, 1_000_000)); // non-cUSDC liquidity
    marketMeta.push({ id: id++, collateral: m.collat, debt: m.debt, feed: `${m.collatFeed}/${m.debtFeed}`, oracle: oracleAddr, lltvBps: m.lltvBps, collateralToken: A[m.collat], debtToken: A[m.debt] });
  }

  console.log("\nWiring:");
  await tx("repTracker.setLendingPool", repTracker.setLendingPool(A.pool));
  await tx("repTracker.setCreditOracle", repTracker.setCreditOracle(A.creditOracle));
  await tx("creditOracle.setLendingPool", creditOracle.setLendingPool(A.pool));
  await tx("creditOracle.setRateModel", creditOracle.setRateModel(A.rateModel));
  await tx("rateModel.setLendingPool", rateModel.setLendingPool(A.pool));
  await tx("positions.setLendingPool", positions.setLendingPool(A.pool));
  await tx("guarantor.setLendingPool", guarantor.setLendingPool(A.pool));
  await tx("pool.setCreditOracle", pool.setCreditOracle(A.creditOracle));
  await tx("pool.setPositions", pool.setPositions(A.positions));
  await tx("pool.setRepaymentTracker", pool.setRepaymentTracker(A.repTracker));
  await tx("pool.setGuarantor", pool.setGuarantor(A.guarantor));
  await tx("pool.setRateModel", pool.setRateModel(A.rateModel));
  await tx("pool.setUtilizationBps(0)", pool.setUtilizationBps(0));
  await tx("pool.setLiquidationEngine", pool.setLiquidationEngine(A.engine));
  await tx("pool.setLiquidationAuction", pool.setLiquidationAuction(A.auction));
  await tx("engine.setPool", engine.setPool(A.pool));
  await tx("engine.setAuction", engine.setAuction(A.auction));
  await tx("auction.setLiquidationEngine", auction.setLiquidationEngine(A.engine));
  // prize pool integration — sole cUSDC liquidity supplier + yield harvester
  await tx("prize.setLending(pool)", prize.setLending(A.pool));
  await tx(`pool.setYieldSupplier(prize, ${YIELD_MID})`, pool.setYieldSupplier(A.prize, YIELD_MID));

  console.log("\nFaucet:");
  await tx(`mint cUSDC ${FAUCET}`, cUSDC.mint(deployer.address, FAUCET));
  for (const m of MARKETS) await tx(`mint ${m.collat} ${FAUCET}`, tokens[m.collat].mint(deployer.address, FAUCET));

  const out = {
    network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address, marketId: YIELD_MID, savings: "cUSDC", contracts: A, markets: marketMeta,
    token: { symbol: "cUSDC", name: "Confidential USDC", decimals: 0 },
  };
  const dir = join(process.cwd(), "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`\nDone. ${marketMeta.length} markets + prize pool. → deployments/${network.name}.json\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
