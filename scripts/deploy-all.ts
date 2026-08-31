import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Deploys the full multi-market confidential-lending system and wires the graph.
//   npx hardhat node && npx hardhat run scripts/deploy-all.ts --network localhost
//   npx hardhat run scripts/deploy-all.ts --network sepolia
//
// Asset feeds live on-chain in a ChainlinkFeedRegistry (symbol -> aggregator), pre-seeded with the
// verified Sepolia feeds. On Sepolia each market resolves its feed from the registry by symbol; on
// any other network it uses a controllable MockAggregator at par (so local math stays 1:1).
// Addresses are written to deployments/<network>.json.

// USD-debt markets: a collateral asset borrowing cUSDC, priced by a single `feed` symbol.
const MARKETS = [
  { collat: "cWETH", feed: "ETH/USD", lltvBps: 8_000 },
  { collat: "cWBTC", feed: "BTC/USD", lltvBps: 8_000 },
  { collat: "cLINK", feed: "LINK/USD", lltvBps: 7_500 },
  { collat: "cEUR", feed: "EUR/USD", lltvBps: 8_500 },
];

// Cross-asset markets: debt is NOT USD; priced by two feed symbols via PairPriceOracle.
const PAIR_MARKETS = [
  { collat: "cWETH", debt: "cWBTC", collatFeed: "ETH/USD", debtFeed: "BTC/USD", lltvBps: 7_500 },
  { collat: "cWBTC", debt: "cWETH", collatFeed: "BTC/USD", debtFeed: "ETH/USD", lltvBps: 7_500 },
];

const STALENESS = (net: string) => (net === "sepolia" ? 24 * 60 * 60 : 60 * 60);

async function main() {
  const [deployer] = await ethers.getSigners();
  const isSepolia = network.name === "sepolia";
  console.log(`\nDeploying confidential lending to "${network.name}" as ${deployer.address}\n`);

  const deploy = async (name: string, args: any[] = []) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(24)} ${await c.getAddress()}`);
    return c;
  };
  const tx = async (label: string, p: Promise<any>) => {
    await (await p).wait();
    console.log(`  ✓ ${label}`);
  };

  console.log("Deploying feed registry + tokens:");
  const registry = await deploy("ChainlinkFeedRegistry"); // on-chain symbol -> feed
  const cUSDC = await deploy("MockConfidentialUSDT"); // shared debt asset
  const tokens: Record<string, any> = { cUSDC };
  for (const m of MARKETS) tokens[m.collat] = await deploy("MockConfidentialUSDT");

  // resolve a feed by symbol: registry on Sepolia, mock@par elsewhere.
  const getFeed = async (symbol: string): Promise<string> => {
    if (isSepolia) return registry.feedOf(symbol);
    const agg = await (await ethers.getContractFactory("MockAggregator")).deploy(100_000_000, 8);
    await agg.waitForDeployment();
    return agg.getAddress();
  };

  console.log("Deploying core protocol:");
  const repTracker = await deploy("RepaymentTracker");
  const creditOracle = await deploy("CreditOracle", [await repTracker.getAddress()]);
  const rateModel = await deploy("InterestRateModel", [await creditOracle.getAddress()]);
  const positions = await deploy("PositionManager");
  const guarantor = await deploy("GuarantorModule");
  const auction = await deploy("LiquidationAuction");
  const engine = await deploy("LiquidationEngine");
  const pool = await deploy("LendingPool");
  const compliance = await deploy("ComplianceViewer");

  const A: Record<string, string> = {
    registry: await registry.getAddress(),
    repTracker: await repTracker.getAddress(),
    creditOracle: await creditOracle.getAddress(),
    rateModel: await rateModel.getAddress(),
    positions: await positions.getAddress(),
    guarantor: await guarantor.getAddress(),
    auction: await auction.getAddress(),
    engine: await engine.getAddress(),
    pool: await pool.getAddress(),
    compliance: await compliance.getAddress(),
  };
  for (const k of Object.keys(tokens)) A[k] = await tokens[k].getAddress();

  console.log("\nConfiguring markets (feeds: %s):", isSepolia ? "on-chain registry" : "mock @ par");
  const marketMeta: any[] = [];
  let id = 0;
  for (const m of MARKETS) {
    const adapter = await (await ethers.getContractFactory("OracleAdapter")).deploy(await getFeed(m.feed), STALENESS(network.name));
    await adapter.waitForDeployment();
    const oracleAddr = await adapter.getAddress();
    await tx(`addMarket ${id}: ${m.collat}->cUSDC (${m.feed}, lltv ${m.lltvBps})`, pool.addMarket(A[m.collat], A.cUSDC, oracleAddr, m.lltvBps));
    marketMeta.push({ id: id++, collateral: m.collat, debt: "cUSDC", feed: m.feed, oracle: oracleAddr, lltvBps: m.lltvBps, collateralToken: A[m.collat], debtToken: A.cUSDC });
  }
  for (const m of PAIR_MARKETS) {
    const pairOracle = await (await ethers.getContractFactory("PairPriceOracle")).deploy(await getFeed(m.collatFeed), await getFeed(m.debtFeed), STALENESS(network.name));
    await pairOracle.waitForDeployment();
    const oracleAddr = await pairOracle.getAddress();
    await tx(`addMarket ${id}: ${m.collat}->${m.debt} (${m.collatFeed}÷${m.debtFeed}, lltv ${m.lltvBps})`, pool.addMarket(A[m.collat], A[m.debt], oracleAddr, m.lltvBps));
    await tx(`${m.debt}.mint(pool, liquidity)`, tokens[m.debt].mint(A.pool, 1_000_000));
    marketMeta.push({ id: id++, collateral: m.collat, debt: m.debt, feed: `${m.collatFeed}/${m.debtFeed}`, oracle: oracleAddr, lltvBps: m.lltvBps, collateralToken: A[m.collat], debtToken: A[m.debt] });
  }

  console.log("\nWiring the graph:");
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
  await tx("pool.setLiquidationEngine", pool.setLiquidationEngine(A.engine));
  await tx("pool.setLiquidationAuction", pool.setLiquidationAuction(A.auction));
  await tx("engine.setPool", engine.setPool(A.pool));
  await tx("engine.setAuction", engine.setAuction(A.auction));
  await tx("auction.setLiquidationEngine", auction.setLiquidationEngine(A.engine));

  await tx("cUSDC.mint(pool, liquidity)", cUSDC.mint(A.pool, 1_000_000));

  const outDir = join(process.cwd(), "deployments");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, `${network.name}.json`),
    JSON.stringify({ network: network.name, deployer: deployer.address, markets: marketMeta, contracts: A }, null, 2),
  );
  console.log(`\nDone. ${marketMeta.length} markets. Addresses written to deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
