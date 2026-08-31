'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { isAddress } from 'viem';
import { PageHeader, ConnectGate, inputStyle, labelStyle } from '@/components/app/ui';
import { MARKETS, ADDR, COMPLIANCE_ABI, POOL_ABI, NULL_HANDLE } from '@/lib/lending';

function Card({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <span className="eyebrow">{eyebrow}</span>
      <h3 style={{ fontSize: 18, fontWeight: 650, margin: '8px 0 14px' }}>{title}</h3>
      {children}
    </div>
  );
}

function Compliance() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // A — whitelist auditor
  const [auditor, setAuditor] = useState('');
  const [busyA, setBusyA] = useState('');
  // B — authorize disclosure
  const [midB, setMidB] = useState(0);
  const [auditorB, setAuditorB] = useState('');
  const [busyB, setBusyB] = useState('');
  // C — decrypt as auditor
  const [midC, setMidC] = useState(0);
  const [borrower, setBorrower] = useState('');
  const [reveal, setReveal] = useState(false);

  async function whitelist() {
    if (!isAddress(auditor)) return;
    setBusyA('Setting…');
    try { await writeContractAsync({ address: ADDR.compliance, abi: COMPLIANCE_ABI, functionName: 'setAuditor', args: [auditor as `0x${string}`, true], gas: 1_000_000n }); }
    finally { setBusyA(''); }
  }
  async function grant() {
    if (!isAddress(auditorB)) return;
    setBusyB('Granting…');
    try { await writeContractAsync({ address: ADDR.pool, abi: POOL_ABI, functionName: 'authorizeAudit', args: [BigInt(midB), ADDR.compliance, auditorB as `0x${string}`], gas: 3_000_000n }); }
    finally { setBusyB(''); }
  }

  // C decrypt
  const { data: debtH } = useReadContract({ address: ADDR.pool, abi: POOL_ABI, functionName: 'debtOf', args: isAddress(borrower) ? [BigInt(midC), borrower as `0x${string}`] : undefined, query: { enabled: isAddress(borrower) } });
  const CONTRACTS: [`0x${string}`, ...`0x${string}`[]] = [ADDR.pool];
  const { mutateAsync: allow } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });
  const handle = debtH as `0x${string}` | undefined;
  const handles = handle && handle !== NULL_HANDLE ? [{ handle, contractAddress: ADDR.pool }] : [];
  const { data: dec, error: decErr } = useUserDecrypt({ handles }, { enabled: reveal && !!isAllowed && handles.length > 0 });
  const decMap = dec as Record<string, bigint> | undefined;
  const value = handle && decMap?.[handle] !== undefined ? String(decMap[handle]) : undefined;

  async function decrypt() {
    if (!isAllowed) await allow(CONTRACTS);
    setReveal(true);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
        <Card eyebrow="Step 1 · admin" title="Whitelist an auditor">
          <label style={labelStyle}>Auditor address</label>
          <input className="mono" placeholder="0x…" value={auditor} onChange={(e) => setAuditor(e.target.value.trim())} style={inputStyle} />
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }} disabled={!isAddress(auditor) || !!busyA} onClick={whitelist}>{busyA || 'Set auditor'}</button>
        </Card>

        <Card eyebrow="Step 2 · borrower" title="Authorize disclosure of my debt">
          <label style={labelStyle}>Market</label>
          <select value={midB} onChange={(e) => setMidB(Number(e.target.value))} style={inputStyle}>
            {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.collateral} → {m.debt}</option>)}
          </select>
          <label style={labelStyle}>Auditor address</label>
          <input className="mono" placeholder="0x…" value={auditorB} onChange={(e) => setAuditorB(e.target.value.trim())} style={inputStyle} />
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }} disabled={!isAddress(auditorB) || !!busyB} onClick={grant}>{busyB || 'Grant scoped access'}</button>
        </Card>
      </div>

      <Card eyebrow="Step 3 · auditor" title="Decrypt exactly one field">
        <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>Connected as the granted auditor, decrypt a specific borrower&apos;s debt — and nothing else.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Market</label>
            <select value={midC} onChange={(e) => setMidC(Number(e.target.value))} style={inputStyle}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.collateral}→{m.debt}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Borrower address</label>
            <input className="mono" placeholder="0x…" value={borrower} onChange={(e) => setBorrower(e.target.value.trim())} style={inputStyle} />
          </div>
          <button className="btn btn-primary" style={{ height: 44 }} disabled={!isAddress(borrower)} onClick={decrypt}>Decrypt debt</button>
        </div>
        {reveal && (
          <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            {value !== undefined ? (
              <span>Debt: <span className="mono" style={{ color: 'var(--accent)', fontSize: 18 }}>{value}</span></span>
            ) : decErr ? (
              <span style={{ color: 'var(--red)', fontSize: 14 }}>🔒 ACLNotAllowed — you were not granted this handle.</span>
            ) : (
              <span className="muted" style={{ fontSize: 14 }}>Decrypting…</span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CompliancePage() {
  return (
    <div>
      <PageHeader title="Compliance" subtitle="Grant a permissioned auditor scoped, per-handle decrypt access — and prove they can read nothing else." />
      <ConnectGate><Compliance /></ConnectGate>
    </div>
  );
}
