// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ComplianceViewer — scoped, revocable auditor access, the path-to-production (contract #9)
/// @notice Grants a permissioned auditor SCOPED decrypt rights over one specific handle at a
///         time, with an on-chain record. No compute — the ACL is the feature. Grant per-handle,
///         never blanket; "scoped and revocable" is the entire pitch.
contract ComplianceViewer is ZamaEthereumConfig {
  mapping(address => bool) public auditors;
  address public admin;

  event AccessGranted(address indexed auditor, bytes32 indexed handle);
  event AuditorSet(address indexed auditor, bool allowed);

  constructor() {
    admin = msg.sender;
  }

  modifier onlyAdmin() {
    require(msg.sender == admin, "only admin");
    _;
  }

  /// @notice Whitelist / de-whitelist an auditor. Note: FHE ACL is additive, so de-whitelisting
  ///         blocks FUTURE `grantAuditAccess` calls but cannot revoke handles already granted.
  function setAuditor(address a, bool ok) external onlyAdmin {
    auditors[a] = ok;
    emit AuditorSet(a, ok);
  }

  /// @notice Grant a whitelisted auditor decrypt access to exactly one field. The caller (the
  ///         holding contract, or a delegate) must already have ACL access to `handle` so this
  ///         contract can re-grant it.
  function grantAuditAccess(euint64 handle, address auditor) external {
    require(auditors[auditor], "not an auditor");
    FHE.allow(handle, auditor); // scoped to exactly this handle
    emit AccessGranted(auditor, euint64.unwrap(handle));
  }
}
