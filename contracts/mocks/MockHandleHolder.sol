// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IComplianceViewer {
  function grantAuditAccess(euint64 handle, address auditor) external;
}

/// @title MockHandleHolder — stand-in "holding contract" for the ComplianceViewer demo.
/// @notice Stores an encrypted secret per user, then delegates scoped audit access: it grants the
///         viewer ACL on the handle so the viewer can re-grant exactly that handle to an auditor.
contract MockHandleHolder is ZamaEthereumConfig {
  mapping(address => euint64) private _secret;

  function store(externalEuint64 enc, bytes calldata proof) external {
    euint64 v = FHE.fromExternal(enc, proof);
    _secret[msg.sender] = v;
    FHE.allowThis(v);
    FHE.allow(v, msg.sender);
  }

  function secretOf(address user) external view returns (euint64) {
    return _secret[user];
  }

  /// @notice Delegate scoped audit access on the caller's own secret to `auditor` via `viewer`.
  function delegateAudit(address viewer, address auditor) external {
    FHE.allow(_secret[msg.sender], viewer); // viewer may now re-grant this exact handle
    IComplianceViewer(viewer).grantAuditAccess(_secret[msg.sender], auditor);
  }
}
