'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { useEncrypt, useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { ADDR, CREDIT_ORACLE_ABI, NULL_HANDLE } from '@/lib/lending';

const BAND_LABEL = ['—', 'Very high risk', 'High risk', 'Medium', 'Low risk', 'Prime'];

export function CreditPanel() {
  const { address } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const [balances, setBalances] = useState('500000000');
  const [age, setAge] = useState('1000');
  const [busy, setBusy] = useState('');
  const [reveal, setReveal] = useState(false);

  const base = {
    address: ADDR.creditOracle,
    abi: CREDIT_ORACLE_ABI,
    args: (address ? [address] : undefined) as any,
    query: { enabled: !!address, refetchInterval: 4000 },
  } as const;
  const { data: hasScore } = useReadContract({ ...base, functionName: 'hasScore' });
  const { data: scoreH } = useReadContract({ ...base, functionName: 'scoreOf' });
  const { data: bandH } = useReadContract({ ...base, functionName: 'bandOf' });
  const { data: bd } = useReadContract({ ...base, functionName: 'scoreBreakdown' }); // [balance, age, history]

  const CONTRACTS: [`0x${string}`, ...`0x${string}`[]] = [ADDR.creditOracle];
  const { mutateAsync: allow, isPending: allowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });

  const bdArr = (bd as `0x${string}`[] | undefined) ?? [];
  const handleList = [scoreH as `0x${string}` | undefined, bandH as `0x${string}` | undefined, ...bdArr]
    .filter((h): h is `0x${string}` => !!h && h !== NULL_HANDLE)
    .map((handle) => ({ handle, contractAddress: ADDR.creditOracle }));

  const { data: dec } = useUserDecrypt(
    { handles: handleList },
    { enabled: reveal && !!isAllowed && handleList.length > 0 },
  );

  const decMap = dec as Record<string, bigint> | undefined;
  const val = (h?: string) => (h && decMap?.[h] !== undefined ? Number(decMap[h]) : undefined);
  const score = val(scoreH as string);
  const band = val(bandH as string);
  const parts = bdArr.map((h) => val(h));

  async function submit() {
    if (!address) return;
    setBusy('Encrypting…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [
          { value: BigInt(balances || '0'), type: 'euint64' },
          { value: BigInt(age || '0'), type: 'euint32' },
        ],
        contractAddress: ADDR.creditOracle,
        userAddress: address,
      });
      setBusy('Submitting…');
      await writeContractAsync({
        address: ADDR.creditOracle,
        abi: CREDIT_ORACLE_ABI,
        functionName: 'submitInputs',
        args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.handles[1]!), bytesToHex(enc.inputProof)],
        gas: 15_000_000n,
      });
    } finally {
      setBusy('');
    }
  }

  async function decrypt() {
    if (!isAllowed) {
      setBusy('Signing…');
      try {
        await allow(CONTRACTS);
      } finally {
        setBusy('');
      }
    }
    setReveal(true);
  }

  const labels = ['Balance', 'Account age', 'History'];
  const maxPart = Math.max(1, ...parts.map((p) => p ?? 0));

  return (
    <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
      {/* inputs */}
      <div className="card">
        <span className="eyebrow">Prove funds, privately</span>
        <h3 style={{ fontSize: 20, fontWeight: 650, margin: '10px 0 6px' }}>Submit encrypted inputs</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 22 }}>
          These are encrypted in your browser and scored on ciphertext — the raw values never touch the chain.
        </p>

        <label className="dim" style={{ fontSize: 12.5 }}>Aggregate balance (proof-of-funds)</label>
        <input className="mono" value={balances} onChange={(e) => setBalances(e.target.value.replace(/\D/g, ''))} style={inp} />
        <label className="dim" style={{ fontSize: 12.5, marginTop: 14, display: 'block' }}>Account age (pre-bucketed)</label>
        <input className="mono" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} style={inp} />

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 20 }} disabled={!address || !!busy} onClick={submit}>
          {busy || (hasScore ? 'Re-score' : 'Submit & score')}
        </button>
        <p className="dim" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
          {address ? '🔐 balances → euint64, age → euint32' : 'Connect a wallet to begin'}
        </p>
      </div>

      {/* private credit report */}
      <div className="card" style={{ minHeight: 320, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span className="eyebrow">Your private credit report</span>
          <span className="pill" style={{ padding: '4px 10px', fontSize: 11 }}>🔓 you only</span>
        </div>

        {!hasScore ? (
          <div className="dim" style={{ fontSize: 14, padding: '48px 0', textAlign: 'center' }}>No score yet — submit inputs to compute one.</div>
        ) : !reveal || score === undefined ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>Your score is encrypted onchain. Decrypt it privately (only you can).</p>
            <button className="btn btn-ghost" onClick={decrypt} disabled={!!busy}>{busy || 'Decrypt my score'}</button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
              {parts.map((p, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span className="muted">{labels[i]}</span>
                    <span className="mono" style={{ color: 'var(--accent)' }}>+{p ?? 0}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 6, background: 'var(--bg-input)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${((p ?? 0) / maxPart) * 100}%`, background: 'linear-gradient(90deg, var(--accent-dim), var(--accent))' }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 18, borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
              <div><div className="dim" style={{ fontSize: 12 }}>Score</div><div style={{ fontSize: 32, fontWeight: 700 }}>{score}</div></div>
              <div style={{ textAlign: 'right' }}>
                <div className="dim" style={{ fontSize: 12 }}>Risk band</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{band}<span className="dim" style={{ fontSize: 16 }}>/5</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{BAND_LABEL[band ?? 0]}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: '11px 13px', fontSize: 15,
  background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
};
