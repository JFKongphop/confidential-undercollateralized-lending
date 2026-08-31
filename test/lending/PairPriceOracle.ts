import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// PairPriceOracle — cross-rate of two Chainlink USD feeds, so a market can pair arbitrary assets
// (debt need not be USD). Plaintext-only; runs on any network.

describe("PairPriceOracle", function () {
  let signers: HardhatEthersSigner[];
  let ethFeed: any; // ETH/USD
  let btcFeed: any; // BTC/USD
  let oracle: any;

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    const Agg = await ethers.getContractFactory("MockAggregator");
    ethFeed = await Agg.deploy(3000n * 10n ** 8n, 8); // $3000
    btcFeed = await Agg.deploy(60000n * 10n ** 8n, 8); // $60000
    oracle = await (await ethers.getContractFactory("PairPriceOracle")).deploy(
      await ethFeed.getAddress(),
      await btcFeed.getAddress(),
      3600,
    );
  });

  it("prices collateral in debt units as the cross-rate of the two feeds", async function () {
    // 1 ETH = 3000/60000 = 0.05 BTC; scaled by PRICE_SCALE (1e6) => 50000.
    expect(await oracle.price()).to.equal(50_000n);
    expect(await oracle.PRICE_SCALE()).to.equal(1_000_000n);
  });

  it("tracks price changes on either feed", async function () {
    await ethFeed.setAnswer(6000n * 10n ** 8n); // ETH doubles -> 0.10 BTC
    expect(await oracle.price()).to.equal(100_000n);
  });

  it("reverts if either feed is stale", async function () {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await ethFeed.setUpdatedAt(now - 2 * 60 * 60);
    await expect(oracle.price()).to.be.revertedWith("Price feed stale");

    await ethFeed.setAnswer(3000n * 10n ** 8n); // refresh eth
    await btcFeed.setUpdatedAt(now - 2 * 60 * 60);
    await expect(oracle.price()).to.be.revertedWith("Price feed stale");
  });
});
