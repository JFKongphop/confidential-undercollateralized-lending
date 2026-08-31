'use client';

import { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { useEncrypt } from '@zama-fhe/react-sdk';
import { bytesToHex, isAddress } from 'viem';
import { PageHeader, ConnectGate, inputStyle, labelStyle } from '@/components/app/ui';
import { MARKETS, ADDR, GUARANTOR_ABI } from '@/lib/lending';

function GuaranteeForm() {
  const { address } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();
  const [mid, setMid] = useState(0);
  const [borrower, setBorrower] = useState('');
  const [amount, setAmount] = useState('700');
  const [busy, setBusy] = useState('');

  const valid = isAddress(borrower);

  async function guarantee() {
    if (!address || !valid) return;
    setBusy('Encrypting…');
    try {
      const enc = await encrypt.mutateAsync({ values: [{ value: BigInt(amount || '0'), type: 'euint64' }], contractAddress: ADDR.guarantor, userAddress: address });
      setBusy('Backing…');
      await writeContractAsync({
        address: ADDR.guarantor, abi: GUARANTOR_ABI, functionName: 'guarantee',
        args: [BigInt(mid), borrower as `0x${string}`, bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)], gas: 15_000_000n,
      });
      setBorrower('');
    } finally { setBusy(''); }
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <span className="eyebrow">Back a borrower</span>
        <h3 style={{ fontSize: 20, fontWeight: 650, margin: '10px 0 16px' }}>Post encrypted backing</h3>

        <label style={labelStyle}>Market</label>
        <select value={mid} onChange={(e) => setMid(Number(e.target.value))} style={{ ...inputStyle }}>
          {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.collateral} → {m.debt}</option>)}
        </select>

        <label style={labelStyle}>Borrower address</label>
        <input className="mono" placeholder="0x…" value={borrower} onChange={(e) => setBorrower(e.target.value.trim())} style={inputStyle} />

        <label style={labelStyle}>Backing amount ({MARKETS[mid].collateral})</label>
        <input className="mono" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} style={inputStyle} />

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={!address || !valid || !!busy} onClick={guarantee}>
          {busy || 'Guarantee'}
        </button>
        {!valid && borrower.length > 0 && <p style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 10 }}>Enter a valid address.</p>}
      </div>

      <div className="card">
        <span className="eyebrow">How it works</span>
        <h3 style={{ fontSize: 18, fontWeight: 650, margin: '10px 0 14px' }}>Confidential co-signing</h3>
        <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
          Your backing lifts the borrower&apos;s effective limit in that market — letting them borrow more than their own
          collateral would allow. The <strong style={{ color: 'var(--text)' }}>aggregate</strong> backing is readable only by
          the pool; each guarantor can decrypt only <strong style={{ color: 'var(--text)' }}>their own</strong> contribution.
          No amounts and no borrower↔guarantor link are ever emitted.
        </p>
      </div>
    </div>
  );
}

export default function GuarantorPage() {
  return (
    <div>
      <PageHeader title="Guarantor" subtitle="Confidentially back a borrower — without revealing who, or how much." />
      <ConnectGate><GuaranteeForm /></ConnectGate>
    </div>
  );
}
