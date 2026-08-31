import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// OracleAdapter — Chainlink ETH/USD wrapper with a staleness guard. Plaintext-only (no FHE), so
// this suite runs on any network. Verifies the raw price surface (getCurrentPrice / getPriceAtRound),
// the normalized pool scalar (price), and the staleness / bad-price guards.

describe("OracleAdapter", function () {
  let signers: HardhatEthersSigner[];
  let agg: any;
  let adapter: any;

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    // ETH/USD ~ $3000, 8 decimals
    agg = await (await ethers.getContractFactory("MockAggregator")).deploy(3000n * 10n ** 8n, 8);
    adapter = await (await ethers.getContractFactory("OracleAdapter")).deploy(await agg.getAddress(), 3600);
  });

  it("returns the raw Chainlink answer at native (8-decimal) precision", async function () {
    expect(await adapter.getCurrentPrice()).to.equal(3000n * 10n ** 8n);
  });

  it("returns a price for a specific round", async function () {
    expect(await adapter.getPriceAtRound(1)).to.equal(3000n * 10n ** 8n);
  });

  it("normalizes to PRICE_SCALE for the pool scalar", async function () {
    // 3000e8 * 100 / 1e8 = 300000
    expect(await adapter.price()).to.equal(300_000n);
    expect(await adapter.PRICE_SCALE()).to.equal(100n);
  });

  it("defaults to the canonical Sepolia feed when constructed with address(0)", async function () {
    const def = await (await ethers.getContractFactory("OracleAdapter")).deploy(ethers.ZeroAddress, 3600);
    expect(await def.priceFeed()).to.equal("0x694AA1769357215DE4FAC081bf1f309aDC325306");
  });

  it("reverts on a stale answer", async function () {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await agg.setUpdatedAt(now - 2 * 60 * 60); // 2h old, past the 1h window
    await expect(adapter.getCurrentPrice()).to.be.revertedWith("Price feed stale");
  });

  it("reverts on a non-positive answer", async function () {
    await agg.setAnswer(0);
    await expect(adapter.getCurrentPrice()).to.be.revertedWith("Invalid price");
  });
});
