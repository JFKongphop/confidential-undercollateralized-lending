// Prize-pool layer — reads the shared deployment.json (full-deploy shape: contracts incl. prize +
// cUSDC savings asset + LendingPool). Lending pages use lib/lending.ts; these are the prize extras.
import deployment from './deployment.json';

export const NULL_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const ADDR = deployment.contracts as Record<string, `0x${string}`>;
export const PRIZE = ADDR.prize; // PrizePool
export const LENDING = ADDR.pool; // LendingPool (yield engine)
export const SAVINGS = ADDR.cUSDC; // savings asset (also the markets' debt token)
export const TOKEN = (deployment as any).token ?? { symbol: 'cUSDC', name: 'Confidential USDC' };
export const MARKET_ID = (deployment as any).marketId ?? 0;

// ERC-7984 confidential token (savings cUSDC)
export const TOKEN_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'confidentialBalanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'setOperator', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'until', type: 'uint48' }], outputs: [] },
  {
    type: 'function', name: 'confidentialTransferAndCall', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'encAmount', type: 'bytes32' }, { name: 'inputProof', type: 'bytes' }, { name: 'data', type: 'bytes' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const;

// PrizePool
export const PRIZE_ABI = [
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'encAmount', type: 'bytes32' }, { name: 'proof', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'requestDraw', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'fulfillDraw', stateMutability: 'nonpayable', inputs: [{ name: 'cleartexts', type: 'bytes' }, { name: 'proof', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'harvest', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'depositorCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pendingTotalHandle', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'drawId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'drawPending', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isDepositor', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'admin', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;
