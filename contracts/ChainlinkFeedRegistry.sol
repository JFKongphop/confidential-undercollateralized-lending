// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainlinkFeedRegistry — on-chain directory of Chainlink price feeds by symbol
/// @notice Holds `symbol => aggregator` so the protocol supports many assets natively: markets and
///         off-chain tooling resolve a feed by name (e.g. "ETH/USD") instead of hardcoding an
///         address. Pre-seeded with the verified Ethereum Sepolia feeds; the admin can add or
///         update entries as new assets are listed — no contract change needed.
///         Source: https://docs.chain.link/data-feeds/price-feeds/addresses?networkType=testnet
contract ChainlinkFeedRegistry {
  address public admin;
  mapping(bytes32 => address) private _feeds; // keccak256(symbol) => aggregator
  string[] public symbols; // enumerable list of registered symbols

  event FeedSet(string symbol, address feed);

  constructor() {
    admin = msg.sender;
    // ── Ethereum Sepolia (chainId 11155111), all 8-decimal USD feeds ──────────
    _set("ETH/USD", 0x694AA1769357215DE4FAC081bf1f309aDC325306);
    _set("BTC/USD", 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43);
    _set("LINK/USD", 0xc59E3633BAAC79493d908e63626716e204A45EdF);
    _set("USDC/USD", 0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E);
    _set("DAI/USD", 0x14866185B1962B63C3Ea9E03Bc1da838bab34C19);
    _set("EUR/USD", 0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910);
    _set("GBP/USD", 0x91FAB41F5f3bE955963a986366edAcff1aaeaa83);
    _set("JPY/USD", 0x8A6af2B75F23831ADc973ce6288e5329F63D86c6);
    _set("SNX/USD", 0xc0F82A46033b8BdBA4Bb0B0e28Bc2006F64355bC);
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "not admin");
    _;
  }

  /// @notice Register or update a feed for `symbol` (e.g. "ETH/USD").
  function setFeed(string calldata symbol, address feed) external onlyAdmin {
    require(feed != address(0), "zero feed");
    _set(symbol, feed);
  }

  /// @notice Feed aggregator for `symbol`. Reverts if the symbol is not registered.
  function feedOf(string calldata symbol) external view returns (address) {
    address f = _feeds[keccak256(bytes(symbol))];
    require(f != address(0), "unknown feed");
    return f;
  }

  /// @notice Whether `symbol` has a registered feed.
  function hasFeed(string calldata symbol) external view returns (bool) {
    return _feeds[keccak256(bytes(symbol))] != address(0);
  }

  function symbolCount() external view returns (uint256) {
    return symbols.length;
  }

  function _set(string memory symbol, address feed) internal {
    bytes32 key = keccak256(bytes(symbol));
    if (_feeds[key] == address(0)) symbols.push(symbol);
    _feeds[key] = feed;
    emit FeedSet(symbol, feed);
  }
}
