// Keeper core — restart-safe logic that OPERATES the confidential-lending protocol's async flows.
// Pure of any CLI concerns so it can be unit-tested against the FHEVM mock. The CLI runner
// (scripts/keeper.ts) wires this to a live node + a loop; the test drives it directly.
//
// Responsibilities:
//   • track borrowers from `Borrowed` events (restart-safe: replayed from logs)
//   • fulfill pending liquidation flags: publicDecrypt -> fulfillLiquidation (seize + open auction)
//   • fulfill settled auctions: publicDecrypt -> fulfillSettle (pay the winning liquidator)
//   • [check mode] epoch-gated batch liquidation checks over tracked borrowers
//   • [settle mode] settle auctions open longer than a bidding window
//
// Self-healing: on-chain state (pendingLiquidations / auctionInfo) is always the source of truth,
// so a fulfilled/settled item is skipped even if the local cache is stale or was lost on restart.

import { AbiCoder } from "ethers";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CHUNK = 5_000; // block range per queryFilter (RPC-friendly)

export interface KeeperContracts {
  pool: any;
  engine: any;
  auction: any;
}

export interface KeeperState {
  lastBlock: number;
  borrowers: Set<string>; // "marketId:address"
  requested: Set<number>; // liquidation request ids seen
  settles: Map<number, { highest: string; winner: string }>; // auction settle-requested ids
  settled: Set<number>;
  openedAt: Map<number, number>; // auctionId -> open timestamp
}

export function newState(fromBlock = 0): KeeperState {
  return {
    lastBlock: fromBlock - 1,
    borrowers: new Set(),
    requested: new Set(),
    settles: new Map(),
    settled: new Set(),
    openedAt: new Map(),
  };
}

// Serialize / restore state (for the CLI's on-disk persistence).
export function serializeState(s: KeeperState) {
  return {
    lastBlock: s.lastBlock,
    borrowers: [...s.borrowers],
    requested: [...s.requested],
    settles: [...s.settles.entries()],
    settled: [...s.settled],
    openedAt: [...s.openedAt.entries()],
  };
}
export function deserializeState(o: any): KeeperState {
  return {
    lastBlock: o.lastBlock ?? -1,
    borrowers: new Set(o.borrowers ?? []),
    requested: new Set(o.requested ?? []),
    settles: new Map(o.settles ?? []),
    settled: new Set(o.settled ?? []),
    openedAt: new Map(o.openedAt ?? []),
  };
}

/// Scan new events since state.lastBlock and fold them into state.
export async function syncEvents(c: KeeperContracts, state: KeeperState, provider: any): Promise<void> {
  const latest = await provider.getBlockNumber();
  let start = state.lastBlock + 1;
  while (start <= latest) {
    const end = Math.min(start + CHUNK - 1, latest);

    for (const ev of await c.pool.queryFilter(c.pool.filters.Borrowed(), start, end)) {
      state.borrowers.add(`${ev.args.marketId}:${ev.args.user}`);
    }
    for (const ev of await c.engine.queryFilter(c.engine.filters.LiquidationRequested(), start, end)) {
      state.requested.add(Number(ev.args.id));
    }
    for (const ev of await c.auction.queryFilter(c.auction.filters.AuctionSettleRequested(), start, end)) {
      state.settles.set(Number(ev.args.id), { highest: ev.args.highestHandle, winner: ev.args.winnerHandle });
    }
    for (const ev of await c.auction.queryFilter(c.auction.filters.AuctionOpened(), start, end)) {
      const blk = await ev.getBlock();
      state.openedAt.set(Number(ev.args.id), blk.timestamp);
    }
    start = end + 1;
  }
  state.lastBlock = latest;
}

/// Fulfill every pending liquidation flag. Returns the ids acted on with their revealed outcome.
export async function fulfillLiquidations(
  c: KeeperContracts,
  fhevm: any,
  state: KeeperState,
): Promise<{ id: number; liquidatable: boolean }[]> {
  const done: { id: number; liquidatable: boolean }[] = [];
  for (const id of state.requested) {
    const req = await c.engine.pendingLiquidations(id);
    if (!req.pending) continue; // already fulfilled — self-healing skip
    const res = await fhevm.publicDecrypt([req.flagHandle]);
    await (await c.engine.fulfillLiquidation(id, res.abiEncodedClearValues, res.decryptionProof)).wait();
    const liquidatable = AbiCoder.defaultAbiCoder().decode(["bool"], res.abiEncodedClearValues)[0] as boolean;
    done.push({ id, liquidatable });
  }
  return done;
}

/// Fulfill every settled auction (reveal winner + amount, pay out). Returns ids paid.
export async function fulfillAuctionSettles(c: KeeperContracts, fhevm: any, state: KeeperState): Promise<number[]> {
  const done: number[] = [];
  for (const [id, h] of state.settles) {
    if (state.settled.has(id)) continue;
    const info = await c.auction.auctionInfo(id);
    if (info.isOpen || info.winnerHandle === ZERO_HASH) continue; // not ready
    const res = await fhevm.publicDecrypt([info.highestHandle, info.winnerHandle]);
    try {
      await (await c.auction.fulfillSettle(id, res.abiEncodedClearValues, res.decryptionProof)).wait();
      done.push(id);
    } catch (e: any) {
      if (!/settled/.test(String(e?.message))) throw e; // already settled elsewhere -> fine
    }
    state.settled.add(id);
  }
  return done;
}

/// CHECK mode: one epoch-gated batch of liquidation checks over tracked borrowers. The contract
/// enforces at most one batch per epoch, so this batches the market with the most borrowers.
export async function checkBorrowersBatch(c: KeeperContracts, state: KeeperState): Promise<number> {
  const epoch = await c.engine.currentEpoch();
  const lastProcessed = await c.engine.lastProcessedEpoch();
  if (epoch <= lastProcessed || state.borrowers.size === 0) return 0;

  const byMarket = new Map<number, string[]>();
  for (const key of state.borrowers) {
    const [m, addr] = key.split(":");
    const arr = byMarket.get(Number(m)) ?? [];
    arr.push(addr);
    byMarket.set(Number(m), arr);
  }
  // pick the market with the most tracked borrowers
  let best = -1;
  let bestUsers: string[] = [];
  for (const [m, users] of byMarket) if (users.length > bestUsers.length) ((best = m), (bestUsers = users));
  if (best < 0) return 0;

  try {
    await (await c.engine.requestLiquidationBatch(best, bestUsers)).wait();
    return bestUsers.length;
  } catch (e: any) {
    if (/epoch not elapsed/.test(String(e?.message))) return 0;
    throw e;
  }
}

/// SETTLE mode: settle auctions that have been open longer than `windowSecs`, so the payout flow
/// can proceed. Returns ids settled.
export async function settleStaleAuctions(
  c: KeeperContracts,
  state: KeeperState,
  provider: any,
  windowSecs: number,
): Promise<number[]> {
  const now = (await provider.getBlock("latest")).timestamp;
  const done: number[] = [];
  for (const [id, openedAt] of state.openedAt) {
    if (now - openedAt < windowSecs) continue;
    const info = await c.auction.auctionInfo(id);
    if (!info.isOpen) continue; // already settled/closed
    await (await c.auction.settle(id)).wait();
    done.push(id);
  }
  return done;
}

export interface CycleOpts {
  check?: boolean;
  settle?: boolean;
  settleWindowSecs?: number;
}

/// One full keeper cycle. Returns a summary of what it did.
export async function runCycle(c: KeeperContracts, fhevm: any, state: KeeperState, provider: any, opts: CycleOpts = {}) {
  await syncEvents(c, state, provider);
  const checked = opts.check ? await checkBorrowersBatch(c, state) : 0;
  if (opts.check) await syncEvents(c, state, provider); // pick up freshly-created requests
  const liquidations = await fulfillLiquidations(c, fhevm, state);
  const settledNow = opts.settle ? await settleStaleAuctions(c, state, provider, opts.settleWindowSecs ?? 0) : [];
  if (opts.settle && settledNow.length) await syncEvents(c, state, provider);
  const settles = await fulfillAuctionSettles(c, fhevm, state);
  return { checked, liquidations, settled: settledNow, payouts: settles, lastBlock: state.lastBlock };
}
