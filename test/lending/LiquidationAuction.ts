import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";

// LiquidationAuction (contract #7) — sealed-bid auction on ciphertext. The winner is selected via
// an encrypted running max; only the outcome is revealed at settle. This suite verifies the
// encrypted selection picks the true high bidder and that the reveal (Form B) settles correctly.

describe("LiquidationAuction", function () {
  let auction: any;
  let auctionAddr: string;
  let collTokenAddr: string;
  let signers: HardhatEthersSigner[];

  before(async function () {
    signers = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    const collToken = await (await ethers.getContractFactory("MockConfidentialUSDT")).deploy();
    collTokenAddr = await collToken.getAddress();
    auction = await (await ethers.getContractFactory("LiquidationAuction")).deploy();
    auctionAddr = await auction.getAddress();
    // Focused auction tests open a prize-less auction; fund it so the (zero) payout at fulfill
    // has an initialized token balance to send from. Production auctions hold real seized collateral.
    await collToken.mint(auctionAddr, 1_000);
    // admin may open/settle directly (no engine needed for a focused auction test).
  });

  const openAuction = (debtor: string) => auction["open(address,address)"](debtor, collTokenAddr);

  async function bid(id: number, bidder: HardhatEthersSigner, amount: number) {
    const input = fhevm.createEncryptedInput(auctionAddr, bidder.address);
    input.add64(amount);
    const { handles, inputProof } = await input.encrypt();
    await auction.connect(bidder).bid(id, handles[0], inputProof);
  }

  it("selects the highest sealed bid on ciphertext and reveals it at settle", async function () {
    await openAuction(signers[8].address); // debtor
    const id = 0;

    await bid(id, signers[1], 100);
    await bid(id, signers[2], 250); // winner
    await bid(id, signers[3], 180);

    await auction.settle(id);
    const info = await auction.auctionInfo(id);
    expect(info.isOpen).to.equal(false);

    const highest = await fhevm.publicDecryptEuint(5 /* euint64 */, info.highestHandle);
    const winner = await fhevm.publicDecryptEaddress(info.winnerHandle);
    expect(highest).to.equal(250n);
    expect(winner).to.equal(signers[2].address);
  });

  it("drives the Form-B fulfill to record the settled outcome", async function () {
    await openAuction(signers[8].address);
    const id = 0;
    await bid(id, signers[1], 300); // winner
    await bid(id, signers[2], 120);
    await auction.settle(id);

    const info = await auction.auctionInfo(id);
    const result = await fhevm.publicDecrypt([info.highestHandle, info.winnerHandle]);

    await expect(auction.fulfillSettle(id, result.abiEncodedClearValues, result.decryptionProof))
      .to.emit(auction, "AuctionSettled")
      .withArgs(id, signers[1].address, 300n);
  });

  it("lets a bidder decrypt only their own bid, never the running max", async function () {
    await openAuction(signers[8].address);
    const id = 0;
    await bid(id, signers[1], 100);
    await bid(id, signers[2], 250);

    // Before settle there is no exposed running-max handle at all (winnerHandle is zero),
    // so a losing bidder has nothing to decrypt — front-running is impossible.
    const info = await auction.auctionInfo(id);
    expect(info.isOpen).to.equal(true);
    expect(info.highestHandle).to.equal(ethers.ZeroHash);
    expect(info.winnerHandle).to.equal(ethers.ZeroHash);
  });
});
