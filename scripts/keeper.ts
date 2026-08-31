import { ethers, fhevm, network } from "hardhat";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  KeeperContracts,
  newState,
  deserializeState,
  serializeState,
  runCycle,
} from "./keeperCore";

// Off-chain keeper that OPERATES the protocol's async flows on a schedule.
//
//   npx hardhat run scripts/keeper.ts --network localhost      # one cycle
//   KEEPER_LOOP=1 npx hardhat run scripts/keeper.ts --network sepolia
//
// Env:
//   KEEPER_LOOP=1            run continuously (else a single cycle)
//   KEEPER_INTERVAL=15       seconds between cycles (loop mode)
//   KEEPER_CHECK=1           also initiate epoch-batch liquidation checks over tracked borrowers
//   KEEPER_SETTLE=1          also settle auctions older than the bidding window
//   KEEPER_SETTLE_WINDOW=60  bidding window seconds before an auction is settled
//   KEEPER_FROM_BLOCK=N      first block to scan on a fresh run (default 0)
//
// State (tracked borrowers, last block, seen requests) is persisted to
// deployments/keeper-state-<network>.json so restarts self-heal from where they left off.

async function main() {
  await fhevm.initializeCLIApi();

  const depFile = join(process.cwd(), "deployments", `${network.name}.json`);
  if (!existsSync(depFile)) throw new Error(`no deployment for ${network.name} — run deploy-all first`);
  const dep = JSON.parse(readFileSync(depFile, "utf8"));
  const A = dep.contracts;

  const c: KeeperContracts = {
    pool: await ethers.getContractAt("LendingPool", A.pool),
    engine: await ethers.getContractAt("LiquidationEngine", A.engine),
    auction: await ethers.getContractAt("LiquidationAuction", A.auction),
  };

  const stateFile = join(process.cwd(), "deployments", `keeper-state-${network.name}.json`);
  const state = existsSync(stateFile)
    ? deserializeState(JSON.parse(readFileSync(stateFile, "utf8")))
    : newState(Number(process.env.KEEPER_FROM_BLOCK ?? 0));

  const opts = {
    check: process.env.KEEPER_CHECK === "1",
    settle: process.env.KEEPER_SETTLE === "1",
    settleWindowSecs: Number(process.env.KEEPER_SETTLE_WINDOW ?? 60),
  };
  const loop = process.env.KEEPER_LOOP === "1";
  const interval = Number(process.env.KEEPER_INTERVAL ?? 15) * 1000;

  const [signer] = await ethers.getSigners();
  console.log(`keeper on "${network.name}" as ${signer.address} — check=${opts.check} settle=${opts.settle} loop=${loop}`);

  const cycle = async () => {
    const r = await runCycle(c, fhevm, state, ethers.provider, opts);
    writeFileSync(stateFile, JSON.stringify(serializeState(state), null, 2));
    const parts = [
      `block ${r.lastBlock}`,
      `tracked ${state.borrowers.size}`,
      r.checked ? `checked ${r.checked}` : "",
      r.liquidations.length ? `fulfilled ${r.liquidations.map((l) => `#${l.id}${l.liquidatable ? "✓" : "·"}`).join(",")}` : "",
      r.settled.length ? `settled ${r.settled.join(",")}` : "",
      r.payouts.length ? `paid ${r.payouts.join(",")}` : "",
    ].filter(Boolean);
    console.log(`  [${new Date().toISOString()}] ${parts.join(" | ")}`);
  };

  await cycle();
  if (!loop) return;
  // simple recurring loop; each cycle re-reads chain state so a crash/restart self-heals.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((res) => setTimeout(res, interval));
    try {
      await cycle();
    } catch (e: any) {
      console.error(`  cycle error (will retry): ${e?.message ?? e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
