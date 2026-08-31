'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h1 style={{ fontSize: 30, fontWeight: 750, letterSpacing: '-0.03em' }}>{title}</h1>
      {subtitle && <p className="muted" style={{ fontSize: 15, marginTop: 5 }}>{subtitle}</p>}
    </div>
  );
}

/** Renders children only when a wallet is connected; otherwise a connect prompt. */
export function ConnectGate({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !isConnected) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '64px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
        <h3 style={{ fontSize: 20, fontWeight: 650 }}>Connect your wallet</h3>
        <p className="muted" style={{ fontSize: 14.5, margin: '8px auto 20px', maxWidth: 360 }}>Use a Sepolia wallet to interact with the confidential contracts.</p>
        <button className="btn btn-primary" onClick={() => connect({ connector: injected() })} suppressHydrationWarning>Connect Wallet</button>
      </div>
    );
  }
  return <>{children}</>;
}

export const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: '11px 13px', fontSize: 15,
  background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
};

export const labelStyle: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginTop: 14 };
