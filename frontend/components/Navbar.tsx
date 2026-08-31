'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

export function Navbar() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 64, zIndex: 50,
        borderBottom: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(16px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
      }}
    >
      <div className="container" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span className="lock-badge" style={{ width: 34, height: 34, fontSize: 17 }}>🔐</span>
          <span style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: '-0.02em' }}>
            Credit<span style={{ color: 'var(--accent)' }}>Lend</span>
          </span>
        </Link>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 28 }} className="nav-links">
          <a className="muted" style={{ fontSize: 14.5, fontWeight: 500 }} href="#how">How it works</a>
          <a className="muted" style={{ fontSize: 14.5, fontWeight: 500 }} href="#features">Features</a>
          <a className="muted" style={{ fontSize: 14.5, fontWeight: 500 }} href="#privacy">Privacy</a>
        </nav>

        {mounted && isConnected ? (
          <button className="btn btn-ghost" style={{ padding: '9px 16px', fontSize: 14 }} onClick={() => disconnect()}>
            <span className="dot" /> <span className="mono">{short(address)}</span>
          </button>
        ) : (
          <button
            className="btn btn-primary"
            style={{ padding: '9px 18px', fontSize: 14 }}
            onClick={() => connect({ connector: injected() })}
            suppressHydrationWarning
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
