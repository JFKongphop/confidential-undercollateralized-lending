import hre, { ethers } from 'hardhat';
import { readFileSync } from 'fs';

// Verify every deployed contract on Etherscan.
//   npx hardhat run scripts/verify-all.ts --network sepolia
// Reads deployments/<network>.json; reconstructs oracle constructor args from on-chain immutables.

async function main() {
  const net = hre.network.name;
  const dep = JSON.parse(readFileSync(`deployments/${net}.json`, 'utf8'));
  const C = dep.contracts as Record<string, string>;

  const jobs: { name: string; address: string; args: any[] }[] = [];

  // no-arg contracts
  for (const k of ['registry', 'repTracker', 'positions', 'guarantor', 'auction', 'engine', 'pool', 'compliance'])
    jobs.push({ name: k, address: C[k], args: [] });
  // tokens (identical bytecode, no args)
  for (const k of Object.keys(C).filter((k) => k.startsWith('c')))
    jobs.push({ name: k, address: C[k], args: [] });
  // args contracts
  jobs.push({ name: 'creditOracle', address: C.creditOracle, args: [C.repTracker] });
  jobs.push({ name: 'rateModel', address: C.rateModel, args: [C.creditOracle] });

  // per-market oracles — read constructor args back from the deployed contract
  for (const m of dep.markets as any[]) {
    if (m.id < 4) {
      const o = await ethers.getContractAt('OracleAdapter', m.oracle);
      jobs.push({ name: `OracleAdapter(m${m.id})`, address: m.oracle, args: [await o.priceFeed(), await o.stalenessThreshold()] });
    } else {
      const o = await ethers.getContractAt('PairPriceOracle', m.oracle);
      jobs.push({ name: `PairPriceOracle(m${m.id})`, address: m.oracle, args: [await o.collateralFeed(), await o.debtFeed(), await o.stalenessThreshold()] });
    }
  }

  let ok = 0;
  let already = 0;
  let failed = 0;
  for (const j of jobs) {
    process.stdout.write(`verify ${j.name.padEnd(20)} ${j.address} … `);
    try {
      await hre.run('verify:verify', { address: j.address, constructorArguments: j.args });
      console.log('✓');
      ok++;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/already verified/i.test(msg)) {
        console.log('already verified');
        already++;
      } else {
        console.log('FAILED —', msg.split('\n')[0]);
        failed++;
      }
    }
  }
  console.log(`\nDone. ${ok} verified, ${already} already, ${failed} failed (of ${jobs.length}).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
