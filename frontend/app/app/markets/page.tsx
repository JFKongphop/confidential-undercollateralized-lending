'use client';

import Link from 'next/link';
import { useReadContract } from 'wagmi';
import { PageHeader } from '@/components/app/ui';
import { MARKETS, ORACLE_ABI, type Market } from '@/lib/lending';

function MarketCard({ m }: { m: Market }) {
  const { data: price } = useReadContract({ address: m.oracle, abi: ORACLE_ABI, functionName: 'price', query: { refetchInterval: 15000 } });
  const { data: scale } = useReadContract({ address: m.oracle, abi: ORACLE_ABI, functionName: 'PRICE_SCALE' });

  let priceStr = '—';
  if (price !== undefined && scale) {
    const p = Number(price) / Number(scale);
    priceStr = p >= 100 ? p.toLocaleString(undefined, { maximumFractionDigits: 0 }) : p.toFixed(p < 1 ? 4 : 2);
  }

  return (
    <div className="card card-hover">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 17, fontWeight: 650 }}>{m.collateral} <span className="dim">→</span> {m.debt}</span>
        <span className="pill" style={{ padding: '4px 10px', fontSize: 11 }}>#{m.id}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="dim" style={{ fontSize: 12 }}>Price ({m.collateral} in {m.debt})</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{priceStr}</div>
        </div>
        <div>
          <div className="dim" style={{ fontSize: 12 }}>Max LTV</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2, color: 'var(--accent)' }}>{m.lltvBps / 100}%</div>
        </div>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span className="dim mono" style={{ fontSize: 12 }}>{m.feed}</span>
        <Link href="/app/borrow" style={{ fontSize: 12.5, color: 'var(--accent-dim)', fontWeight: 600 }}>Borrow →</Link>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  return (
    <div>
      <PageHeader title="Markets" subtitle="Isolated markets priced by live Chainlink feeds. Collateral and debt are ERC-7984 confidential tokens." />
      <div className="grid grid-2">
        {MARKETS.map((m) => (
          <MarketCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}
