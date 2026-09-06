'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { usePublicDecrypt } from '@zama-fhe/react-sdk';
import { wagmiConfig } from '@/lib/wagmi';
import { PageHeader, ConnectGate, inputStyle, labelStyle } from '@/components/app/ui';
import { SAVINGS, PRIZE, PRIZE_ABI, TOKEN_ABI, TOKEN, LENDING } from "@/lib/pool";

function DrawControl() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicDecrypt = usePublicDecrypt();
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState('');
  const [prize, setPrize] = useState('1000');

  const { data: admin } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'admin' });
  const { data: drawId } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'drawId', query: { refetchInterval: 4000 } });
  const { data: pending } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'drawPending', query: { refetchInterval: 4000 } });
  const { data: depositors } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'depositorCount', query: { refetchInterval: 4000 } });

  const isAdmin = !!address && !!admin && (admin as string).toLowerCase() === address.toLowerCase();

  async function runDraw() {
    setBusy('Requesting…');
    setLog('');
    try {
      // 1. reveal the aggregate total + freeze the pool — UNLESS a draw is already pending
      //    (e.g. a prior relayer hiccup left it frozen); in that case resume from the fulfill step.
      const alreadyPending = (await readContract(wagmiConfig, { address: PRIZE, abi: PRIZE_ABI, functionName: 'drawPending' })) as boolean;
      if (!alreadyPending) {
        await writeContractAsync({ address: PRIZE, abi: PRIZE_ABI, functionName: 'requestDraw', gas: 3_000_000n });
      }
      setBusy('Revealing total…');
      const handle = (await readContract(wagmiConfig, { address: PRIZE, abi: PRIZE_ABI, functionName: 'pendingTotalHandle' })) as `0x${string}`;
      // the Zama relayer can time out transiently — retry the decrypt a few times before giving up
      let dec: any;
      for (let i = 0; i < 5; i++) {
        try { dec = await publicDecrypt.mutateAsync([handle]); break; }
        catch (err) {
          if (i === 4) throw err;
          setBusy(`Revealing total… (relayer retry ${i + 1}/4)`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      setBusy('Drawing winner…');
      // 2. FHE-random, deposit-weighted winner selection over encrypted balances
      await writeContractAsync({
        address: PRIZE, abi: PRIZE_ABI, functionName: 'fulfillDraw',
        args: [dec.abiEncodedClearValues as `0x${string}`, dec.decryptionProof as `0x${string}`], gas: 15_000_000n,
      });
      setLog('Draw complete — the prize was credited to one winner’s encrypted balance. They learn it by decrypting on the Prize Pool page.');
    } catch (e: any) {
      setLog(`Draw step failed (often the Zama relayer timing out). The pool stays safely frozen — just click Run draw again to resume from where it stopped. Details: ${e?.shortMessage || e?.message || 'error'}`);
    } finally { setBusy(''); }
  }

  async function harvest() {
    setBusy('Harvesting…');
    setLog('');
    try {
      await writeContractAsync({ address: PRIZE, abi: PRIZE_ABI, functionName: 'harvest', gas: 5_000_000n });
      setLog('Harvested the realized lending interest into the prize reserve. Run a draw to award it.');
    } catch (e: any) {
      setLog(`Harvest failed: ${e?.shortMessage || e?.message || 'error'}`);
    } finally { setBusy(''); }
  }

  async function demoYield() {
    if (!prize) return;
    setBusy('Generating…');
    setLog('');
    try {
      // demo shortcut: inject interest into the lending reserve (as a borrower repayment would),
      // then harvest it through the REAL recognizeYield path into the prize.
      await writeContractAsync({ address: SAVINGS, abi: TOKEN_ABI, functionName: 'mint', args: [LENDING, BigInt(prize)], gas: 3_000_000n });
      await writeContractAsync({ address: PRIZE, abi: PRIZE_ABI, functionName: 'harvest', gas: 5_000_000n });
      setLog(`Injected ${prize} ${TOKEN.symbol} of interest into the lending market and harvested it as the prize.`);
    } catch (e: any) {
      setLog(`Failed: ${e?.shortMessage || e?.message || 'error'}`);
    } finally { setBusy(''); }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-3">
        <div className="card" style={{ padding: '18px 20px' }}><div className="dim" style={{ fontSize: 12.5 }}>Draws held</div><div style={{ fontSize: 26, fontWeight: 700 }}>{drawId !== undefined ? String(drawId) : '—'}</div></div>
        <div className="card" style={{ padding: '18px 20px' }}><div className="dim" style={{ fontSize: 12.5 }}>Savers</div><div style={{ fontSize: 26, fontWeight: 700 }}>{depositors !== undefined ? String(depositors) : '—'}</div></div>
        <div className="card" style={{ padding: '18px 20px' }}><div className="dim" style={{ fontSize: 12.5 }}>Status</div><div style={{ fontSize: 26, fontWeight: 700, color: pending ? 'var(--accent)' : 'var(--text)' }}>{pending ? 'drawing' : 'idle'}</div></div>
      </div>

      <div className="card">
        <span className="eyebrow">Trigger a draw</span>
        <h3 style={{ fontSize: 19, fontWeight: 650, margin: '8px 0 10px' }}>Run the confidential draw</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
          One click runs the whole flow: reveal the aggregate total (needed to bound the random ticket), draw an on-chain
          <span className="mono"> FHE.randEuint64</span> ticket, and credit the prize to the deposit-weighted winner — all over encrypted balances.
        </p>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!isAdmin || !!busy} onClick={runDraw}>
          {busy || (pending ? '⏯ Resume pending draw' : '🎲 Run draw')}
        </button>
        {!isAdmin && <p className="dim" style={{ fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>Connect the admin wallet to trigger draws.</p>}
      </div>

      <div className="card">
        <span className="eyebrow">Real yield → prize</span>
        <h3 style={{ fontSize: 19, fontWeight: 650, margin: '8px 0 10px' }}>Harvest lending interest</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
          The prize is the <strong style={{ color: 'var(--text)' }}>real interest</strong> borrowers paid on the pooled savings. Harvest recognizes it
          (<span className="mono">reserve − principal</span>, on ciphertext) into the prize reserve. Borrowers generate it on the Borrow page.
        </p>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 16 }} disabled={!isAdmin || !!busy} onClick={harvest}>
          {busy === 'Harvesting…' ? busy : 'Harvest yield → prize'}
        </button>
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 16px' }} />
        <label style={labelStyle}>Demo: inject borrower interest ({TOKEN.symbol})</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginTop: 6 }}>
          <input className="mono" value={prize} onChange={(e) => setPrize(e.target.value.replace(/\D/g, ''))} style={{ ...inputStyle, flex: 1 }} />
          <button className="btn btn-ghost" style={{ height: 44, whiteSpace: 'nowrap' }} disabled={!isAdmin || !!busy} onClick={demoYield}>Generate + harvest</button>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>Shortcut for the demo — routes through the same recognizeYield path a real repayment would.</p>
      </div>

      {log && <div className="card muted" style={{ padding: '14px 18px', fontSize: 14 }}>{log}</div>}
    </div>
  );
}

export default function DrawPage() {
  return (
    <div>
      <PageHeader title="Draws" subtitle="Fair, on-chain, deposit-weighted winner selection with FHE randomness — computed entirely over encrypted balances." />
      <ConnectGate><DrawControl /></ConnectGate>
    </div>
  );
}
