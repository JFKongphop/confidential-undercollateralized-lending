'use client';

import { useReadContract } from 'wagmi';
import { PageHeader, ConnectGate } from '@/components/app/ui';
import { PoolPanel } from '@/components/app/PoolPanel';
import { PRIZE, PRIZE_ABI } from '@/lib/pool';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="dim" style={{ fontSize: 12.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function PrizePoolPage() {
  const { data: depositors } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'depositorCount', query: { refetchInterval: 5000 } });
  const { data: drawId } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'drawId', query: { refetchInterval: 5000 } });
  const { data: pending } = useReadContract({ address: PRIZE, abi: PRIZE_ABI, functionName: 'drawPending', query: { refetchInterval: 5000 } });

  return (
    <div>
      <PageHeader title="Prize Pool" subtitle="No-loss prize savings. Your deposit is lent out on the market; the interest is the prize. Win a fair FHE draw, never lose principal." />
      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <Stat label="Savers in the pool" value={depositors !== undefined ? String(depositors) : '—'} hint="addresses public · amounts encrypted" />
        <Stat label="Draws held" value={drawId !== undefined ? String(drawId) : '—'} hint={pending ? 'a draw is in progress…' : 'admin/keeper triggered'} />
        <Stat label="Loss risk" value="0%" hint="principal redeemable any time" />
      </div>
      <ConnectGate><PoolPanel /></ConnectGate>
      <div className="card muted" style={{ marginTop: 20, padding: '16px 20px', fontSize: 13.5 }}>
        <strong style={{ color: 'var(--text)' }}>How the prize is funded:</strong> your deposits are supplied into the confidential lending market as
        borrowable liquidity. Borrowers (see the Borrow page) pay encrypted interest; the admin harvests it (Draws page) and one saver wins it — all on ciphertext.
      </div>
    </div>
  );
}
