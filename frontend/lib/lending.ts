// Confidential lending — contract addresses + ABIs for the frontend.
// Addresses come from lib/deployment.json (regenerated from deployments/<network>.json after deploy).
// The FHE wiring (provider, hooks) lives in app/providers.tsx + the fhe-frontend conventions.

import deployment from './deployment.json';

const ZERO = '0x0000000000000000000000000000000000000000';

export interface Market {
  id: number;
  collateral: string; // symbol e.g. cWETH
  debt: string; // symbol e.g. cUSDC
  feed: string; // e.g. ETH/USD
  lltvBps: number;
  oracle: `0x${string}`;
  collateralToken: `0x${string}`;
  debtToken: `0x${string}`;
}

export const TOKENS = ['cUSDC', 'cWETH', 'cWBTC', 'cLINK', 'cEUR'] as const;
export const tokenAddr = (sym: string) => ADDR[sym];

export const NETWORK = deployment.network;
export const ADDR = deployment.contracts as Record<string, `0x${string}`>;
export const MARKETS = deployment.markets as Market[];
export const isConfigured = () => ADDR.pool !== ZERO && deployment.network !== 'unset';

export const NULL_HANDLE =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export const CREDIT_ORACLE_ABI = [
  {
    type: 'function',
    name: 'submitInputs',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encBalances', type: 'bytes32' },
      { name: 'encAgeScore', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'hasScore', stateMutability: 'view', inputs: [{ name: 'u', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'scoreOf', stateMutability: 'view', inputs: [{ name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'bandOf', stateMutability: 'view', inputs: [{ name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  {
    type: 'function',
    name: 'scoreBreakdown',
    stateMutability: 'view',
    inputs: [{ name: 'u', type: 'address' }],
    outputs: [
      { name: 'balance', type: 'bytes32' },
      { name: 'age', type: 'bytes32' },
      { name: 'history', type: 'bytes32' },
    ],
  },
] as const;

export const POOL_ABI = [
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'encAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'encAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'onTimePlaintext', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'authorizeAudit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'viewer', type: 'address' },
      { name: 'auditor', type: 'address' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'debtOf', stateMutability: 'view', inputs: [{ name: 'm', type: 'uint256' }, { name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'collateralOf', stateMutability: 'view', inputs: [{ name: 'm', type: 'uint256' }, { name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'rateOf', stateMutability: 'view', inputs: [{ name: 'm', type: 'uint256' }, { name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'marketCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export const GUARANTOR_ABI = [
  {
    type: 'function',
    name: 'guarantee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'borrower', type: 'address' },
      { name: 'encAmount', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'hasStake', stateMutability: 'view', inputs: [{ name: 'm', type: 'uint256' }, { name: 'b', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'stakeFor', stateMutability: 'view', inputs: [{ name: 'm', type: 'uint256' }, { name: 'b', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;

export const ENGINE_ABI = [
  { type: 'function', name: 'requestLiquidation', stateMutability: 'nonpayable', inputs: [{ name: 'm', type: 'uint256' }, { name: 'u', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'fulfillLiquidation', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'cleartexts', type: 'bytes' }, { name: 'proof', type: 'bytes' }], outputs: [] },
  {
    type: 'function', name: 'pendingLiquidations', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: 'marketId', type: 'uint256' }, { name: 'user', type: 'address' }, { name: 'flagHandle', type: 'bytes32' }, { name: 'pending', type: 'bool' }],
  },
] as const;

export const AUCTION_ABI = [
  { type: 'function', name: 'bid', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'encBid', type: 'bytes32' }, { name: 'proof', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'settle', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'fulfillSettle', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'cleartexts', type: 'bytes' }, { name: 'proof', type: 'bytes' }], outputs: [] },
  {
    type: 'function', name: 'auctionInfo', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: 'isOpen', type: 'bool' }, { name: 'highestHandle', type: 'bytes32' }, { name: 'winnerHandle', type: 'bytes32' }],
  },
] as const;

export const RATE_MODEL_ABI = [
  { type: 'function', name: 'rateFor', stateMutability: 'nonpayable', inputs: [{ name: 'u', type: 'address' }, { name: 'util', type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'rateForRevealed', stateMutability: 'nonpayable', inputs: [{ name: 'u', type: 'address' }, { name: 'util', type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'rateOf', stateMutability: 'view', inputs: [{ name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'revealedRateHandleOf', stateMutability: 'view', inputs: [{ name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;

export const COMPLIANCE_ABI = [
  { type: 'function', name: 'setAuditor', stateMutability: 'nonpayable', inputs: [{ name: 'a', type: 'address' }, { name: 'ok', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'auditors', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

export const REP_ABI = [
  { type: 'function', name: 'reputationOf', stateMutability: 'view', inputs: [{ name: 'u', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;

export const ORACLE_ABI = [
  { type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'PRICE_SCALE', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// ERC-7984 confidential token (deposit + balance).
export const ERC7984_ABI = [
  {
    type: 'function',
    name: 'confidentialTransferAndCall',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'encAmount', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'confidentialBalanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'setOperator', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'until', type: 'uint48' }], outputs: [] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint64' }], outputs: [] },
] as const;
