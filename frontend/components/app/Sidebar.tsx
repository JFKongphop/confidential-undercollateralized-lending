'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { NETWORK } from '@/lib/lending';

const NAV = [
  { href: '/app', label: 'Dashboard', icon: '▦' },
  { href: '/app/markets', label: 'Markets', icon: '☰' },
  { href: '/app/borrow', label: 'Borrow', icon: '↑' },
  { href: '/app/positions', label: 'Positions', icon: '◈' },
  { href: '/app/credit', label: 'Credit line', icon: '💳' },
  { href: '/app/guarantor', label: 'Guarantor', icon: '⛨' },
  { href: '/app/liquidations', label: 'Liquidations', icon: '⚖' },
  { href: '/app/compliance', label: 'Compliance', icon: '🕵' },
  { href: '/app/faucet', label: 'Faucet', icon: '⛲' },
  { href: '/app/attack', label: 'Attack demo', icon: '⚡' },
];

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function Sidebar() {
  const path = usePathname();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: 244, zIndex: 40,
      display: 'flex', flexDirection: 'column', padding: 18,
      borderRight: '1px solid var(--border)', background: 'rgba(255,255,255,0.5)',
      backdropFilter: 'blur(18px) saturate(1.3)', WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 20px' }}>
        <span className="lock-badge" style={{ width: 32, height: 32, fontSize: 16 }}>🔐</span>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>Credit<span style={{ color: 'var(--accent)' }}>Lend</span></span>
      </Link>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {NAV.map((n) => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href} prefetch
              style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10,
                fontSize: 14.5, fontWeight: active ? 650 : 500,
                color: active ? '#fff' : 'var(--text-muted)',
                background: active ? 'var(--accent)' : 'transparent', transition: 'all .12s',
              }}>
              <span style={{ width: 18, textAlign: 'center', fontSize: 14, opacity: active ? 1 : 0.8 }}>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: 12 }}>
        <div className="pill" style={{ width: '100%', justifyContent: 'center', marginBottom: 10, padding: '6px 10px', fontSize: 11.5 }}>
          <span className="dot" /> {NETWORK}
        </div>
        {mounted && isConnected ? (
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: 13.5 }} onClick={() => disconnect()}>
            <span className="mono">{short(address)}</span>
          </button>
        ) : (
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: 14 }} onClick={() => connect({ connector: injected() })} suppressHydrationWarning>
            Connect Wallet
          </button>
        )}
      </div>
    </aside>
  );
}
