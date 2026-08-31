// Sync a hardhat deployment into the frontend's lib/deployment.json.
//   node scripts/sync-frontend.mjs sepolia
import { readFileSync, writeFileSync } from 'fs';

const net = process.argv[2] ?? 'sepolia';
const dep = JSON.parse(readFileSync(`deployments/${net}.json`, 'utf8'));

const out = {
  network: dep.network,
  chainId: net === 'sepolia' ? 11155111 : 31337,
  contracts: dep.contracts,
  markets: dep.markets.map((m) => ({
    id: m.id,
    collateral: m.collateral,
    debt: m.debt,
    feed: m.feed,
    lltvBps: m.lltvBps,
    oracle: m.oracle,
    collateralToken: m.collateralToken,
    debtToken: m.debtToken,
  })),
};

writeFileSync('frontend/lib/deployment.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote frontend/lib/deployment.json — ${out.markets.length} markets on ${out.network}`);
