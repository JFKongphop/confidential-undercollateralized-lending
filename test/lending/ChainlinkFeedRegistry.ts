import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// ChainlinkFeedRegistry — on-chain symbol -> feed directory. Plaintext, runs on any network.

const SEPOLIA = {
  "ETH/USD": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  "BTC/USD": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  "LINK/USD": "0xc59E3633BAAC79493d908e63626716e204A45EdF",
  "SNX/USD": "0xc0F82A46033b8BdBA4Bb0B0e28Bc2006F64355bC",
} as const;

describe("ChainlinkFeedRegistry", function () {
  let signers: HardhatEthersSigner[];
  let registry: any;

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    registry = await (await ethers.getContractFactory("ChainlinkFeedRegistry")).deploy();
  });

  it("resolves the seeded Sepolia feeds by symbol", async function () {
    for (const [sym, addr] of Object.entries(SEPOLIA)) {
      expect(await registry.feedOf(sym)).to.equal(addr);
      expect(await registry.hasFeed(sym)).to.equal(true);
    }
    expect(await registry.symbolCount()).to.equal(9n);
  });

  it("reports unknown symbols", async function () {
    expect(await registry.hasFeed("FOO/USD")).to.equal(false);
    await expect(registry.feedOf("FOO/USD")).to.be.revertedWith("unknown feed");
  });

  it("lets the admin register a new asset", async function () {
    const aave = "0x000000000000000000000000000000000000AAaE";
    await expect(registry.setFeed("AAVE/USD", aave)).to.emit(registry, "FeedSet").withArgs("AAVE/USD", aave);
    expect(await registry.feedOf("AAVE/USD")).to.equal(aave);
    expect(await registry.symbolCount()).to.equal(10n);
  });

  it("guards admin + zero address", async function () {
    await expect(registry.connect(signers[1]).setFeed("X/USD", signers[2].address)).to.be.revertedWith("not admin");
    await expect(registry.setFeed("X/USD", ethers.ZeroAddress)).to.be.revertedWith("zero feed");
  });
});
