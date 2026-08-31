'use client';

import Link from 'next/link';
import { CreditPanel } from '@/components/app/CreditPanel';
import { PageHeader, ConnectGate } from '@/components/app/ui';
import { MARKETS } from '@/lib/lending';

const QUICK = [
  { href: '/app/borrow', icon: '↑', title: 'Borrow', body: 'Deposit collateral and borrow against your encrypted band.' },
  { href: '/app/positions', icon: '◈', title: 'Positions', body: 'Decrypt your debt & collateral, repay to build reputation.' },
  { href: '/app/markets', icon: '☰', title: 'Markets', body: `${MARKETS.length} isolated markets priced by live Chainlink feeds.` },
  { href: '/app/attack', icon: '⚡', title: 'Attack demo', body: 'See why the borrow rate must stay encrypted.' },
];

export default function Dashboard() {
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your private credit report, computed on ciphertext." />
      <ConnectGate>
        <CreditPanel />
        <div className="grid grid-2" style={{ marginTop: 20 }}>
          {QUICK.map((q) => (
            <Link key={q.href} href={q.href} prefetch className="card card-hover" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <span className="lock-badge">{q.icon}</span>
              <div>
                <div style={{ fontWeight: 650, fontSize: 16 }}>{q.title}</div>
                <div className="muted" style={{ fontSize: 13.5 }}>{q.body}</div>
              </div>
            </Link>
          ))}
        </div>
      </ConnectGate>
    </div>
  );
}
