'use client';

import Link from 'next/link';

import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { PageHeader, ConnectGate } from '@/components/app/ui';
import { ADDR, REP_ABI, NULL_HANDLE } from '@/lib/lending';

const CREDIT_PER_REP = 10; // must match LendingPool.CREDIT_PER_REP

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <div className="dim" style={{ fontSize: 12.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 32, fontWeight: 700, marginTop: 4, color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
    </div>
  );
}

function CreditLine() {
  const { address } = useAccount();
  const { data: repH } = useReadContract({
    address: ADDR.repTracker, abi: REP_ABI, functionName: 'reputationOf',
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 4000 },
  });

  const CONTRACTS: [`0x${string}`, ...`0x${string}`[]] = [ADDR.repTracker];
  const { mutateAsync: allow, isPending: allowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });
  const [reveal, setReveal] = useState(false);

  const handle = repH as `0x${string}` | undefined;
  const has = !!handle && handle !== NULL_HANDLE;
  const handles = has ? [{ handle: handle as `0x${string}`, contractAddress: ADDR.repTracker }] : [];
  const { data: dec } = useUserDecrypt({ handles }, { enabled: reveal && !!isAllowed && handles.length > 0 });
  const decMap = dec as Record<string, bigint> | undefined;
  const rep = has && decMap?.[handle!] !== undefined ? Number(decMap[handle!]) : undefined;
  const line = rep !== undefined ? rep * CREDIT_PER_REP : undefined;

  async function decrypt() {
    if (!isAllowed) await allow(CONTRACTS);
    setReveal(true);
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 18, background: 'radial-gradient(600px circle at 12% 0%, rgba(22,163,74,0.10), transparent 70%), var(--bg-surface)' }}>
        <span className="eyebrow">Reputation is your collateral</span>
        <h3 style={{ fontSize: 20, fontWeight: 700, margin: '8px 0 8px' }}>Your private credit line</h3>
        <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6, maxWidth: 640 }}>
          Every on-time repayment raises an <strong style={{ color: 'var(--text)' }}>encrypted reputation</strong> that unlocks an
          unsecured borrowing allowance — letting you borrow <strong style={{ color: 'var(--accent)' }}>below 100% collateral</strong>,
          even collateral-free. A miss decays it. Nobody can see your reputation, your line, or your history but you.
        </p>
      </div>

      {!has ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>🔓</div>
          <h3 style={{ fontSize: 19, fontWeight: 650 }}>No credit line yet</h3>
          <p className="muted" style={{ fontSize: 14.5, margin: '8px auto 20px', maxWidth: 420 }}>Take a small collateralized loan and repay it on time to start building your private credit history.</p>
          <Link className="btn btn-primary" href="/app/borrow">Borrow to build reputation →</Link>
        </div>
      ) : !reveal || rep === undefined ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>🔒</div>
          <p className="muted" style={{ fontSize: 14.5, marginBottom: 20 }}>Your reputation and credit line are encrypted onchain. Decrypt them privately.</p>
          <button className="btn btn-ghost" onClick={decrypt} disabled={allowing}>{allowing ? 'Signing…' : 'Decrypt my credit line'}</button>
        </div>
      ) : (
        <div>
          <div className="grid grid-3">
            <Tile label="Reputation" value={String(rep)} />
            <Tile label="Credit line (unsecured)" value={String(line)} accent />
            <Tile label="Repayments on record" value={String(Math.round(rep / 50))} />
          </div>
          <div className="card" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 650 }}>You can borrow up to <span style={{ color: 'var(--accent)' }}>{line}</span> with <span style={{ color: 'var(--accent)' }}>zero collateral</span>.</div>
              <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Each on-time repayment adds +50 reputation (+{50 * CREDIT_PER_REP} credit line). A miss decays it.</div>
            </div>
            <Link className="btn btn-primary" href="/app/borrow">Borrow now →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreditPage() {
  return (
    <div>
      <PageHeader title="Credit line" subtitle="Reputation-unlocked undercollateralized borrowing — the private credit layer, realized." />
      <ConnectGate><CreditLine /></ConnectGate>
    </div>
  );
}
