'use client';

import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { useEncrypt, useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { ADDR, MARKETS, POOL_ABI, ERC7984_ABI, NULL_HANDLE, type Market } from '@/lib/lending';

export function PositionsPanel() {
  const { address } = useAccount();
  const CONTRACTS: [`0x${string}`, ...`0x${string}`[]] = [ADDR.pool];
  const { mutateAsync: allow, isPending: allowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });
  const [reveal, setReveal] = useState(false);

  async function decryptAll() {
    if (!isAllowed) await allow(CONTRACTS);
    setReveal(true);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <span className="eyebrow">Your positions</span>
          <h3 style={{ fontSize: 20, fontWeight: 650, marginTop: 6 }}>Debt & collateral, per market</h3>
        </div>
        <button className="btn btn-ghost" onClick={decryptAll} disabled={!address || allowing}>
          {allowing ? 'Signing…' : reveal ? '🔓 Revealed' : 'Decrypt positions'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.1fr', fontSize: 12, padding: '0 4px' }} className="dim">
          <span>Market</span><span>Collateral</span><span>Debt</span><span style={{ textAlign: 'right' }}>Repay</span>
        </div>
        {MARKETS.map((m) => (
          <PositionRow key={m.id} m={m} reveal={reveal && !!isAllowed} address={address} />
        ))}
      </div>
    </div>
  );
}

function PositionRow({ m, reveal, address }: { m: Market; reveal: boolean; address?: `0x${string}` }) {
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState('');

  const base = { address: ADDR.pool, abi: POOL_ABI, args: (address ? [BigInt(m.id), address] : undefined) as any, query: { enabled: !!address, refetchInterval: 5000 } } as const;
  const { data: debtH } = useReadContract({ ...base, functionName: 'debtOf' });
  const { data: collH } = useReadContract({ ...base, functionName: 'collateralOf' });

  const handles = [collH as `0x${string}` | undefined, debtH as `0x${string}` | undefined]
    .filter((h): h is `0x${string}` => !!h && h !== NULL_HANDLE)
    .map((handle) => ({ handle, contractAddress: ADDR.pool }));
  const { data: dec } = useUserDecrypt({ handles }, { enabled: reveal && handles.length > 0 });
  const decMap = dec as Record<string, bigint> | undefined;

  const show = (h?: string) =>
    !reveal ? '••••' : !h || h === NULL_HANDLE ? '0' : decMap?.[h] !== undefined ? String(decMap[h]) : '…';

  async function repay() {
    if (!address || !amt) return;
    setBusy('Approving…');
    try {
      // authorize the pool to pull the debt token, then repay on-time
      await writeContractAsync({ address: m.debtToken, abi: ERC7984_ABI, functionName: 'setOperator', args: [ADDR.pool, 4102444800], gas: 1_000_000n });
      setBusy('Encrypting…');
      const enc = await encrypt.mutateAsync({ values: [{ value: BigInt(amt), type: 'euint64' }], contractAddress: ADDR.pool, userAddress: address });
      setBusy('Repaying…');
      await writeContractAsync({ address: ADDR.pool, abi: POOL_ABI, functionName: 'repay', args: [BigInt(m.id), bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof), true], gas: 15_000_000n });
      setAmt('');
    } finally { setBusy(''); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.1fr', alignItems: 'center', gap: 8, padding: '11px 14px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 14, fontWeight: 550 }}>{m.collateral} <span className="dim">→</span> {m.debt}</span>
      <span className="mono" style={{ fontSize: 13.5, color: 'var(--text)' }}>{show(collH as string)}</span>
      <span className="mono" style={{ fontSize: 13.5, color: 'var(--accent)' }}>{show(debtH as string)}</span>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <input className="mono" placeholder="amt" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ''))}
          style={{ width: 68, padding: '7px 9px', fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)', outline: 'none' }} />
        <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 12.5 }} disabled={!address || !amt || !!busy} onClick={repay}>{busy || 'Repay'}</button>
      </div>
    </div>
  );
}
