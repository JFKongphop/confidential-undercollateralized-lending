# CreditLend — The private credit layer for onchain lending

> **🔐 Confidential Undercollateralized Lending — built on [Zama FHEVM](https://github.com/zama-ai/fhevm)**
>
> *"Every lending position onchain is a public broadcast — your size, your debt, your exact liquidation price. That is why onchain credit does not exist: you cannot build a credit score, price risk, or lend below 100% collateral when the score itself leaks. CreditLend encrypts creditworthiness itself, so lending can finally be credit-based — not just over-collateralized — with every score, rate, position, and bid computed end-to-end on ciphertext."*

A fully onchain, multi-asset lending protocol where the thing that has never been private onchain — **your creditworthiness** — is encrypted with Fully Homomorphic Encryption (FHE) via [FHEVM](https://github.com/zama-ai/fhevm) by Zama. Credit scores, risk bands, borrow rates, collateral, debt, guarantor stakes, and liquidation bids are all stored and computed as ciphertexts. The chain enforces every rule without ever seeing a plaintext number.

## Demo

[![CreditLend Demo](https://img.youtube.com/vi/VIDEO_ID/maxresdefault.jpg)](https://youtu.be/VIDEO_ID)

Deposit encrypted collateral, prove your funds privately, get an encrypted credit score → risk band, borrow at an encrypted risk-priced rate — and, if your repayment reputation is high enough, **borrow below 100% collateral**. Liquidations run as sealed-bid auctions on ciphertext; only the outcome is ever revealed.

---

## 🚀 Killer Feature — Reputation-Unlocked Undercollateralized Lending

Every other confidential-lending project encrypts *amounts*. Amounts are not credit. **CreditLend is the only one where good private repayment history lets you borrow more than you post.**

Each on-time repayment raises an **encrypted reputation** (`euint32`, decays on a miss). The pool turns that reputation into an **encrypted unsecured credit line** and adds it to your effective backing in *both* borrow eligibility and health checks:

```solidity
// LendingPool.sol — reputation becomes virtual, encrypted collateral
uint64 internal constant CREDIT_PER_REP = 10;

function _creditLine(address user) internal returns (euint64) {
    if (address(repTracker) == address(0) || !repTracker.hasReputation(user)) return FHE.asEuint64(0);
    return FHE.mul(FHE.asEuint64(repTracker.reputationOf(user)), CREDIT_PER_REP);
}

// borrow() — collateral value PLUS the encrypted credit line must cover the loan
euint64 effBacking = FHE.add(_valued(marketId, _backing(marketId, msg.sender)), _creditLine(msg.sender));
ebool   ok         = FHE.ge(effBacking, required);           // never reverts on balance — clamps to 0
```

The result — proven in the test suite ("*reputation unlocks an UNDERCOLLATERALIZED borrow*") — is a borrower who draws **500 against 100 of collateral**, with the reputation, the credit line, and the debt all encrypted. On a transparent chain this is impossible: the moment your score is public, it can be gamed, front-run, and censored. Under FHE it just works.

---

## Problems We Solve

Onchain lending is over-collateralized *because* it is transparent. Everything you submit is public — your collateral, your debt, your health factor, your liquidation price. That transparency creates a class of problems FHE makes disappear:

### 1. Credit-Score Leakage

A credit score onchain is a permanent, public label. Anyone can profile your wallet, deny you service, or price against you. With FHE:
- The score is a weighted sum computed on ciphertext → an `euint32`; the risk band (1–5) is an `euint8`.
- Only **you** can decrypt your own private credit report. The protocol enforces the band without reading it.

### 2. Undercollateralized Lending Is Impossible on Transparent Chains

Unsecured credit requires a reputation that *can't* be gamed or censored. A public reputation is trivially Sybil-farmed and selectively front-run. With FHE:
- Repayment reputation is an encrypted `euint32`, ACL'd to the borrower and the pool only.
- It is added as **virtual collateral** — so you can borrow below 100%, and a liquidator still can't see how much of your backing is reputation vs. tokens.

### 3. Rate Inversion

If your borrow rate is public, anyone can invert the rate curve to recover your hidden credit band — the leak defeats the encryption. With FHE:
- The rate is derived from the encrypted band and kept encrypted end-to-end (`euint32`).
- The premium-per-band is chosen with a branch-free `FHE.select` ladder — no plaintext band ever touches the rate.

### 4. Liquidation Front-Running (MEV)

On a transparent chain, liquidation bots watch health factors and race to seize collateral, and bidders see each other's offers. With FHE:
- Liquidators submit **encrypted** bids; the winner is an encrypted running-max selected on ciphertext.
- Only **one health bit** is ever revealed, and only at the moment it flips — the size, debt, and every losing bid stay private.

### 5. Position & Guarantor Surveillance

Collateral, debt, and who-backs-whom are a map of everyone's risk. With FHE:
- Collateral and debt are `euint64` ciphertexts per isolated market.
- A guarantor posts **encrypted** backing to lift a borrower's limit — without revealing the amount or that the relationship exists.

### 6. Compliance Without a Backdoor

Auditability usually means "make everything public." FHE makes it **consent-based and scoped**:
- A borrower authorizes a whitelisted auditor to decrypt **exactly one field** (e.g. their debt in one market) — and the auditor provably can read nothing else.

---

## Token Standard — ERC-7984

All collateral and debt assets are [ERC-7984](https://eips.ethereum.org/EIPS/eip-7984) confidential tokens (via OpenZeppelin's [confidential-contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts)) — an encrypted-balance standard (analogous to ERC-20, but for FHEVM):

- **Balances are `euint64` ciphertexts** — the chain never sees a plaintext amount.
- **Transfers are encrypted** — `confidentialTransfer` / `confidentialTransferAndCall` carry encrypted handles, not values.
- **`IERC7984Receiver`** — `LendingPool` accepts confidential collateral deposits via `confidentialTransferAndCall`, with the target `marketId` encoded in the ERC-7984 `data` field (`abi.encode(uint256)`).

Every downstream operation — depositing collateral, borrowing, accruing interest, repaying, seizing on liquidation — works entirely over encrypted handles.

---

## Contracts (Sepolia)

Deployer: [`0x204a73e8303F3d09B12062dEdAA74B1CDA6E167d`](https://sepolia.etherscan.io/address/0x204a73e8303F3d09B12062dEdAA74B1CDA6E167d) · Network: FHEVM on Sepolia (chainId 11155111)

| Contract | Description | Address |
|---|---|---|
| `LendingPool.sol` | Core protocol — isolated multi-asset markets, encrypted collateral/debt, interest accrual, and the reputation credit line. | [0xB377…b18D](https://sepolia.etherscan.io/address/0xB3771769c56Eff1946D32ecdA91A50d9e22cb18D) |
| `CreditOracle.sol` | Computes the encrypted credit score → risk band on ciphertext; exposes a per-component private credit report to the borrower only. | [0xFA52…Cba9](https://sepolia.etherscan.io/address/0xFA52ee8e41ff766e8dC7675cfc59d454F3EbCba9) |
| `InterestRateModel.sol` | Derives an **encrypted** borrow rate from the encrypted band via a branch-free `FHE.select` premium ladder. | [0xca2d…d399](https://sepolia.etherscan.io/address/0xca2db97e8977CC68eC2f7dE0f16f4F743d6bd399) |
| `RepaymentTracker.sol` | Encrypted repayment **reputation** (`euint32`) — rises on-time, decays on a miss. Powers undercollateralized borrowing. | [0x9bF6…98F3](https://sepolia.etherscan.io/address/0x9bF6B78121824f50ae2ADD3F5D6095Cc48Af98F3) |
| `PositionManager.sol` | Encrypted per-market position store (collateral + debt as `euint64`). | [0x0205…eD27](https://sepolia.etherscan.io/address/0x020564Fe5367E1c9F029Afc11C651b21061BeD27) |
| `GuarantorModule.sol` | Confidential third-party backing — encrypted stake lifts a borrower's limit without revealing the guarantor or amount. | [0x21dD…43fC](https://sepolia.etherscan.io/address/0x21dD518251117e69174d34D1F43d5Fd340e243fC) |
| `LiquidationEngine.sol` | Epoch-batched liquidation checks; reveals only one health bit at the trigger. | [0xb268…444c](https://sepolia.etherscan.io/address/0xb2686e92CfB07830f504C0029dE1aF7c7F25444c) |
| `LiquidationAuction.sol` | **Sealed-bid** auction — encrypted bids, encrypted running-max winner (`eaddress`); outcome revealed only at settle. | [0xf8C8…930b](https://sepolia.etherscan.io/address/0xf8C82290591dDA9A710aB4e07b5036D8F241930b) |
| `ComplianceViewer.sol` | Consent-based, scoped auditor decryption of a single handle. | [0x07A5…ebd0](https://sepolia.etherscan.io/address/0x07A55C4f30D8B0c155c6167033cab6aB2075ebd0) |
| `ChainlinkFeedRegistry.sol` | Onchain `symbol → aggregator` registry, pre-seeded with 9 verified Sepolia feeds. | [0xB2BC…030b](https://sepolia.etherscan.io/address/0xB2BCa33595c1e482e3a6cA9D4df99895fCe3030b) |

**Confidential test assets (ERC-7984):**
[cUSDC](https://sepolia.etherscan.io/address/0xaD8aE90DefFFaf553aA2A07Ee0dd22C74451ec1C) ·
[cWETH](https://sepolia.etherscan.io/address/0xC65AC40d37DAF5A39dEAe0cb0181574acDB82576) ·
[cWBTC](https://sepolia.etherscan.io/address/0xf16ffA3C53d2D6469a4379e65d97A7a4e945d6f4) ·
[cLINK](https://sepolia.etherscan.io/address/0x068339195c5326C914613F3B85aF963c3eC3ff63) ·
[cEUR](https://sepolia.etherscan.io/address/0x8d87106463fde5a110B168383Ba07592d9F541f9)

> All 23 deployed contracts are **verified on Etherscan**.

---

## Markets (Sepolia)

Six isolated markets, each priced by a real Chainlink feed resolved onchain from the registry. Cross-asset markets are priced by combining two USD feeds (`PairPriceOracle`).

| # | Collateral → Debt | Price source | LLTV |
|---|---|---|---|
| M0 | cWETH → cUSDC | ETH/USD | 80% |
| M1 | cWBTC → cUSDC | BTC/USD | 80% |
| M2 | cLINK → cUSDC | LINK/USD | 75% |
| M3 | cEUR → cUSDC | EUR/USD | 85% |
| M4 | cWETH → cWBTC | ETH/USD ÷ BTC/USD | 75% |
| M5 | cWBTC → cWETH | BTC/USD ÷ ETH/USD | 75% |

Adding an asset takes **no contract change** — `registry.setFeed(...)` plus one market entry.

---

## Encrypted Fields at a Glance

| Field | Contract | Type | Privacy Benefit |
|---|---|---|---|
| Credit score | `CreditOracle` | `euint32` | Hides creditworthiness — no public profiling or scoring |
| Risk band (1–5) | `CreditOracle` | `euint8` | The band drives rate & ratio without ever being read |
| Score components | `CreditOracle` | `euint32` | Private per-factor credit report, borrower-only |
| Repayment reputation | `RepaymentTracker` | `euint32` | **Enables undercollateralized borrowing** without a gameable public score |
| Borrow rate | `InterestRateModel` | `euint32` | Prevents rate-inversion recovery of the hidden band |
| Collateral (per market) | `PositionManager` | `euint64` | Hides capital at risk |
| Debt (per market) | `PositionManager` | `euint64` | Hides leverage and liquidation distance |
| Guarantor stake | `GuarantorModule` | `euint64` | Hides the amount and existence of third-party backing |
| Liquidation bid | `LiquidationAuction` | `euint64` | **Sealed-bid** — no front-running the auction |
| Auction winner | `LiquidationAuction` | `eaddress` | Winner selected on ciphertext, revealed only at settle |
| Health bit | `LendingPool` | `ebool` | Only bit revealed — at the trigger, and nothing else |

---

## FHE Highlights

### Undercollateralized health — reputation as encrypted collateral

Health is checked on ciphertext, with the encrypted credit line folded into backing. A borrower who repaid on time can be *below* 100% token collateral and still healthy — and a liquidator can never tell how much of the backing is reputation:

```solidity
// LendingPool._unhealthy() — cross-multiplied comparison, no division, no plaintext
euint64 effBacking = FHE.add(_valued(marketId, _backing(marketId, user)), _creditLine(user));
euint64 debt       = _liveDebt(marketId, user);              // includes accrued interest
return FHE.lt(FHE.mul(effBacking, lltv), FHE.mul(debt, uint64(10_000)));
```

### Risk-priced rate that can't be inverted

The rate is built from the encrypted band with a branch-free `FHE.select` ladder and stays encrypted:

```solidity
// InterestRateModel._premiumFor() — band never leaves ciphertext
FHE.select(FHE.eq(band, FHE.asEuint8(5)), FHE.asEuint32(P5),
FHE.select(FHE.eq(band, FHE.asEuint8(4)), FHE.asEuint32(P4),
FHE.select(FHE.eq(band, FHE.asEuint8(3)), FHE.asEuint32(P3),
FHE.select(FHE.eq(band, FHE.asEuint8(2)), FHE.asEuint32(P2), FHE.asEuint32(P1)))));

euint32 rate = FHE.add(FHE.asEuint32(plainPart), premium);   // rate is ENCRYPTED end-to-end
```

> There is also a `rateForRevealed(...)` path that intentionally leaks the rate (`FHE.makePubliclyDecryptable`) — used in `scripts/attack-rate-inversion.ts` / `ATTACK_DEMO.md` to *demonstrate* how a public rate lets an attacker recover the private band, and why keeping it encrypted matters.

### Sealed-bid liquidation auction

Liquidators bid on ciphertext. The running max and the winning address are selected homomorphically; nothing is revealed until settlement:

```solidity
// LiquidationAuction.bid() — encrypted running max + encrypted winner
ebool higher = FHE.gt(b, a.highest);
a.highest    = FHE.select(higher, b, a.highest);                        // running max
a.winner     = FHE.select(higher, FHE.asEaddress(msg.sender), a.winner); // encrypted winner (eaddress)

// settle() — Form-B reveal: only the outcome becomes public
FHE.makePubliclyDecryptable(a.winner);
FHE.makePubliclyDecryptable(a.highest);
```

At `fulfillSettle`, `FHE.checkSignatures` verifies the KMS decryption proof, then the seized collateral is paid to the revealed winner — the losing bids stay encrypted forever.

### Scoped, consent-based compliance

A borrower grants a whitelisted auditor decrypt access to **one** handle. The auditor can read that field and nothing else — attempting any other handle reverts with `ACLNotAllowed`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js 15)                     │
│   @zama-fhe/react-sdk · wagmi v2 · viem · MetaMask · Chainlink   │
└───────────────────────────────┬──────────────────────────────────┘
                                │ encrypted handles + inputProof
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Sepolia Testnet (FHEVM)                     │
│                                                                  │
│   ┌────────────┐   score/band   ┌──────────────┐   rate          │
│   │CreditOracle│───────────────►│ InterestRate │                 │
│   └─────┬──────┘                │    Model     │                 │
│         │ band                  └──────┬───────┘                 │
│         ▼                              │ enc. rate               │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                      LendingPool                          │  │
│   │  isolated markets · enc. collateral/debt · credit line    │  │
│   └──┬──────────┬──────────┬──────────┬──────────┬────────────┘  │
│      │          │          │          │          │               │
│  ┌───▼───┐ ┌────▼────┐ ┌───▼────┐ ┌───▼─────┐ ┌──▼──────────┐    │
│  │Position│ │Guarantor│ │RepTrack│ │Liquidat.│ │ Compliance  │    │
│  │Manager │ │ Module  │ │(reput.)│ │Engine + │ │  Viewer     │    │
│  └────────┘ └─────────┘ └────────┘ │Auction  │ └─────────────┘    │
│                                    └────┬────┘                    │
│  ┌────────────────────┐  ┌──────────────▼──────┐  ┌───────────┐   │
│  │ChainlinkFeedRegistry│─►│ Oracle/PairPrice    │  │  Zama KMS │   │
│  │ (symbol → feed)     │  │ Oracle (real feeds) │  │(off-chain)│   │
│  └────────────────────┘  └─────────────────────┘  └───────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

An off-chain **keeper** (`scripts/keeper.ts`) drives the async Form-B flows: it batches liquidation checks, fulfills flagged liquidations (`publicDecrypt → fulfillLiquidation`), and settles stale auctions (`fulfillSettle`). It is restart-safe — onchain state is the source of truth.

---

## What's Hidden vs. Public

| 🔒 Encrypted | 🌐 Public |
|---|---|
| Credit score & risk band | Which market you use |
| Repayment reputation & history | Chainlink prices & per-market LLTVs |
| Collateral, debt & borrow rate | That a liquidation occurred |
| Guarantor amounts & identities | The winning bid — at settle only |
| Every bid in a liquidation auction | One health bit — at the trigger only |

---

## Testing

```
50 passing
```

- **~99.6% statement coverage / 100% function coverage** across the lending suite.
- Run with the coverage flag (required — the FHE mock self-skips to 0% otherwise):

  ```bash
  SOLIDITY_COVERAGE=true npx hardhat coverage --testfiles "test/lending/*.ts"
  ```

`test/lending/FullFlow.ts` is the end-to-end lifecycle test: score → guarantee → deposit → borrow → accrue → compliance → repay → price-drop → liquidate → auction → payout — plus the dedicated undercollateralized-borrow and reputation-decay cases.

---

## Quick Start

### Prerequisites

- **Node.js** 20+
- A Sepolia wallet with test ETH

### Install & test

```bash
npm install
npm run compile
npx hardhat test --testfiles "test/lending/*.ts"
```

### Deploy to Sepolia

`.env` at the repo root needs `PRIVATE_KEY`, `SEPOLIA_RPC_URL`, and (for verification) `ETHERSCAN_API_KEY`.

```bash
# Deploy all contracts + wire the graph + seed pool liquidity
npm run deploy:sepolia

# Verify every contract on Etherscan
npx hardhat run scripts/verify-all.ts --network sepolia

# Sync deployed addresses into the frontend
node scripts/sync-frontend.mjs sepolia
```

### Run the keeper

```bash
npm run keeper:sepolia   # operates async liquidation/auction settlement
```

### Run the frontend

```bash
cd frontend
npm install
npx next start -p 3210   # → http://localhost:3210
```

---

## Project Structure

```
confidential-undercollateralized-lending/
├── contracts/
│   ├── LendingPool.sol           # Core — markets, credit line, accrual
│   ├── CreditOracle.sol          # Encrypted score → risk band
│   ├── InterestRateModel.sol     # Encrypted risk-priced rate
│   ├── RepaymentTracker.sol      # Encrypted repayment reputation
│   ├── PositionManager.sol       # Encrypted per-market positions
│   ├── GuarantorModule.sol       # Confidential third-party backing
│   ├── LiquidationEngine.sol     # Epoch-batched liquidation checks
│   ├── LiquidationAuction.sol    # Sealed-bid auction (eaddress winner)
│   ├── ComplianceViewer.sol      # Scoped, consent-based auditing
│   ├── ChainlinkFeedRegistry.sol # Onchain symbol → feed registry
│   ├── OracleAdapter.sol         # Single-feed Chainlink wrapper
│   ├── PairPriceOracle.sol       # Cross-asset price (two USD feeds)
│   └── mocks/                    # ERC-7984 test tokens, MockAggregator
├── test/lending/                 # 50 tests (FullFlow, Keeper, per-contract)
├── scripts/                      # deploy-all, verify-all, keeper, attack demo
├── frontend/                     # Next.js 15 dApp (wagmi v2 + Zama React SDK)
├── ATTACK_DEMO.md                # Rate-inversion attack writeup
├── FHE_COMPLEXITY.md             # Static FHE-op budget
└── CONFIDENTIAL_LENDING_CONTRACTS_DETAIL.md  # Full contract spec
```

---

## Further Reading

- [ATTACK_DEMO.md](ATTACK_DEMO.md) — the rate-inversion attack, and why the rate stays encrypted
- [FHE_COMPLEXITY.md](FHE_COMPLEXITY.md) — FHE operation budget (only two ciphertext×ciphertext multiplies system-wide)
- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [ERC-7984](https://eips.ethereum.org/EIPS/eip-7984) — confidential token standard

---

## License

BSD-3-Clause-Clear.

---

**Built on Zama FHEVM · ERC-7984 · Chainlink · Sepolia**
