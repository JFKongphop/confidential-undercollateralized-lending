'use client';

import { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { useEncrypt } from '@zama-fhe/react-sdk';
import { bytesToHex, encodeAbiParameters } from 'viem';
import { ADDR, MARKETS, ERC7984_ABI, POOL_ABI, type Market } from '@/lib/lending';
import { PriceChart } from '@/components/app/PriceChart';

const DISP: Record<string, string> = { cWETH: 'ETH', cWBTC: 'BTC', cLINK: 'LINK', cUSDC: 'USD', cEUR: 'EUR' };
const disp = (s: string) => DISP[s] ?? s;

export function BorrowPanel() {
  const { address } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const [mid, setMid] = useState(0);
  const [depositAmt, setDepositAmt] = useState('1000');
  const [borrowAmt, setBorrowAmt] = useState('500');
  const [busy, setBusy] = useState('');
  const m: Market = MARKETS[mid];

  const marketData = () => encodeAbiParameters([{ type: 'uint256' }], [BigInt(mid)]);

  async function mint() {
    if (!address) return;
    setBusy('Minting…');
    try {
      await writeContractAsync({
        address: m.collateralToken, abi: ERC7984_ABI, functionName: 'mint',
        args: [address, 100_000n], gas: 3_000_000n,
      });
    } finally { setBusy(''); }
  }

  async function deposit() {
    if (!address) return;
    setBusy('Encrypting…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [{ value: BigInt(depositAmt || '0'), type: 'euint64' }],
        contractAddress: m.collateralToken, // proof bound to the TOKEN for a deposit
        userAddress: address,
      });
      setBusy('Depositing…');
      await writeContractAsync({
        address: m.collateralToken, abi: ERC7984_ABI, functionName: 'confidentialTransferAndCall',
        args: [ADDR.pool, bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof), marketData()],
        gas: 15_000_000n,
      });
    } finally { setBusy(''); }
  }

  async function borrow() {
    if (!address) return;
    setBusy('Encrypting…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [{ value: BigInt(borrowAmt || '0'), type: 'euint64' }],
        contractAddress: ADDR.pool,
        userAddress: address,
      });
      setBusy('Borrowing…');
      await writeContractAsync({
        address: ADDR.pool, abi: POOL_ABI, functionName: 'borrow',
        args: [BigInt(mid), bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
        gas: 15_000_000n,
      });
    } finally { setBusy(''); }
  }

  return (
    <div>
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 650, fontSize: 15 }}>
          {disp(m.collateral)} <span className="dim">/</span> {disp(m.debt)} <span className="dim" style={{ fontWeight: 400 }}>· live</span>
        </span>
        <span className="pill" style={{ padding: '4px 10px', fontSize: 11 }}>1m candles</span>
      </div>
      <PriceChart market={m} />
    </div>
    <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
      {/* markets */}
      <div className="card">
        <span className="eyebrow">Isolated markets</span>
        <h3 style={{ fontSize: 20, fontWeight: 650, margin: '10px 0 16px' }}>Choose a market</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {MARKETS.map((mk) => (
            <button key={mk.id} onClick={() => setMid(mk.id)}
              style={{
                textAlign: 'left', padding: '13px 15px', borderRadius: 'var(--radius-md)',
                border: `1px solid ${mid === mk.id ? 'var(--accent)' : 'var(--border)'}`,
                background: mid === mk.id ? 'rgba(22,163,74,0.08)' : 'var(--bg-input)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all .15s',
              }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{mk.collateral} <span className="dim">→</span> {mk.debt}</span>
              <span className="mono dim" style={{ fontSize: 12 }}>{mk.feed} · LLTV {mk.lltvBps / 100}%</span>
            </button>
          ))}
        </div>
      </div>

      {/* actions */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="eyebrow">{m.collateral} → {m.debt}</span>
        <h3 style={{ fontSize: 20, fontWeight: 650, margin: '10px 0 18px' }}>Deposit & borrow</h3>

        <label className="dim" style={{ fontSize: 12.5 }}>Deposit collateral ({m.collateral})</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input className="mono" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value.replace(/\D/g, ''))} style={inp} />
          <button className="btn btn-ghost" style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap' }} disabled={!address || !!busy} onClick={mint}>Get test</button>
        </div>
        <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} disabled={!address || !!busy} onClick={deposit}>
          {busy === 'Depositing…' || busy === 'Encrypting…' ? busy : `Deposit ${m.collateral}`}
        </button>

        <div style={{ height: 1, background: 'var(--border)', margin: '22px 0' }} />

        <label className="dim" style={{ fontSize: 12.5 }}>Borrow ({m.debt})</label>
        <input className="mono" value={borrowAmt} onChange={(e) => setBorrowAmt(e.target.value.replace(/\D/g, ''))} style={inp} />
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} disabled={!address || !!busy} onClick={borrow}>
          {busy === 'Borrowing…' ? busy : `Borrow ${m.debt}`}
        </button>
        <p className="dim" style={{ fontSize: 12, marginTop: 'auto', paddingTop: 14, textAlign: 'center' }}>
          The pool picks your ratio from your encrypted band. Under-collateralized → clamped to 0, never reverts.
        </p>
      </div>
    </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  flex: 1, width: '100%', padding: '11px 13px', fontSize: 15,
  background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
};
