'use client';

import { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { usePublicDecrypt } from '@zama-fhe/react-sdk';
import { decodeAbiParameters } from 'viem';
import { wagmiConfig } from '@/lib/wagmi';
import { PageHeader, ConnectGate } from '@/components/app/ui';
import { ADDR, RATE_MODEL_ABI } from '@/lib/lending';

const BASE_BPS = 200;
const PREMIUM: Record<number, number> = { 1: 1200, 2: 800, 3: 500, 4: 250, 5: 100 };

function Attack() {
  const { address } = useAccount();
  const publicDecrypt = usePublicDecrypt();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState('');
  const [leaked, setLeaked] = useState<{ rate: number; band?: number } | null>(null);

  async function runLeak() {
    if (!address) return;
    setBusy('Leaking rate…');
    try {
      // vulnerable path: make the rate publicly decryptable
      await writeContractAsync({ address: ADDR.rateModel, abi: RATE_MODEL_ABI, functionName: 'rateForRevealed', args: [address, 0n], gas: 15_000_000n });
      const handle: any = await readContract(wagmiConfig, { address: ADDR.rateModel, abi: RATE_MODEL_ABI, functionName: 'revealedRateHandleOf', args: [address] });
      setBusy('Decrypting…');
      const dec = await publicDecrypt.mutateAsync([handle]);
      const rate = Number(decodeAbiParameters([{ type: 'uint256' }], dec.abiEncodedClearValues as `0x${string}`)[0]);
      const premium = rate - BASE_BPS;
      const band = Number(Object.keys(PREMIUM).find((b) => PREMIUM[Number(b)] === premium));
      setLeaked({ rate, band: Number.isNaN(band) ? undefined : band });
    } finally { setBusy(''); }
  }

  async function runSecure() {
    if (!address) return;
    setBusy('Computing encrypted rate…');
    try {
      await writeContractAsync({ address: ADDR.rateModel, abi: RATE_MODEL_ABI, functionName: 'rateFor', args: [address, 0n], gas: 15_000_000n });
    } finally { setBusy(''); }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <span className="eyebrow">The threat model</span>
        <h3 style={{ fontSize: 19, fontWeight: 650, margin: '8px 0 10px' }}>Why the borrow rate must stay encrypted</h3>
        <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
          The rate is <span className="mono">BASE + premium[band]</span>, and the premium table is <strong style={{ color: 'var(--text)' }}>public</strong>.
          So if the rate is ever revealed, anyone can subtract the base and read the premium straight off the table — recovering your
          private credit band. This page runs that attack against a deliberately-leaky path, then shows the production path defeats it.
        </p>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card" style={{ borderColor: 'rgba(248,113,113,0.3)' }}>
          <span className="eyebrow" style={{ color: 'var(--red)' }}>Vulnerable</span>
          <h3 style={{ fontSize: 18, fontWeight: 650, margin: '8px 0 10px' }}>Leak &amp; invert the rate</h3>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>Publicly reveals your rate, then recovers your band from it.</p>
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} disabled={!address || !!busy} onClick={runLeak}>{busy && busy !== 'Computing encrypted rate…' ? busy : 'Run the attack'}</button>
          {leaked && (
            <div style={{ marginTop: 16, padding: '16px', borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14 }}>Public rate: <span className="mono" style={{ color: 'var(--text)' }}>{leaked.rate} bps</span></div>
              <div style={{ fontSize: 14, marginTop: 6 }}>Recovered band: <span className="mono" style={{ color: 'var(--red)', fontSize: 18, fontWeight: 700 }}>{leaked.band ?? '—'}</span> ← leaked from a public value</div>
            </div>
          )}
        </div>

        <div className="card" style={{ borderColor: 'rgba(52,211,153,0.28)' }}>
          <span className="eyebrow" style={{ color: 'var(--green)' }}>Production</span>
          <h3 style={{ fontSize: 18, fontWeight: 650, margin: '8px 0 10px' }}>Keep the rate encrypted</h3>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>The same rate, ACL&apos;d to you + the pool only — never publicly decryptable.</p>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!address || !!busy} onClick={runSecure}>{busy === 'Computing encrypted rate…' ? busy : 'Compute encrypted rate'}</button>
          <div style={{ marginTop: 16, padding: '16px', borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', fontSize: 14 }}>
            <span style={{ color: 'var(--green)' }}>🔒 The same inversion script gets ACLNotAllowed.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AttackPage() {
  return (
    <div>
      <PageHeader title="Attack demo" subtitle="A concrete threat-model showcase: revealing the rate leaks the private band; encryption defeats it." />
      <ConnectGate><Attack /></ConnectGate>
    </div>
  );
}
