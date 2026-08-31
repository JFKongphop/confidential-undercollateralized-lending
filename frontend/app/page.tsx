import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';

const FEATURES = [
  { icon: '🧮', title: 'Encrypted credit scoring', body: 'A weighted score → risk band (1–5) computed entirely on ciphertext. You decrypt your own private credit report; nobody else can read it.' },
  { icon: '📈', title: 'Risk-priced encrypted rates', body: 'Your borrow rate is derived from the encrypted band and stays encrypted end-to-end — so it can never be inverted back to your score.' },
  { icon: '🎯', title: 'Dynamic collateral ratios', body: 'The collateral ratio is chosen by your encrypted band, not a fixed LLTV. Better credit → less collateral, all without revealing the score.' },
  { icon: '🤝', title: 'Confidential guarantors', body: 'A third party posts encrypted backing to lift your limit — without revealing who backed whom, or for how much.' },
  { icon: '⚖️', title: 'Sealed-bid liquidations', body: 'Liquidators bid on ciphertext; the winner is selected via an encrypted running-max. Only the outcome is ever revealed — no front-running.' },
  { icon: '🕵️', title: 'Scoped compliance', body: 'Grant an auditor consent-based, per-handle decrypt access to exactly one field — and prove they can read nothing else.' },
];

const STEPS = [
  { n: '01', t: 'Prove funds, privately', d: 'Submit encrypted balances + account age. The oracle computes your score and risk band on ciphertext.' },
  { n: '02', t: 'Deposit collateral', d: 'Move ERC-7984 confidential tokens into a market. Amounts are encrypted from the first byte.' },
  { n: '03', t: 'Borrow against your band', d: 'The pool picks your ratio from the encrypted band, values collateral via Chainlink, and disburses — or clamps to zero, never reverting on your balance.' },
  { n: '04', t: 'Repay & build reputation', d: 'On-time repayments raise an encrypted reputation that decays on a miss — private, portable credit history.' },
  { n: '05', t: 'Liquidate at the trigger', d: 'Only the true health bit is ever revealed, and only at the moment it flips. A keeper settles the sealed-bid auction automatically.' },
];

const HIDDEN = ['Credit score & risk band', 'Reputation history', 'Collateral, debt & borrow rate', 'Guarantor amounts & identities', 'Every bid in a liquidation auction'];
const PUBLIC = ['Which market you use', 'Chainlink prices & LLTVs', 'That a liquidation occurred', 'The winning bid at settle only', 'One health bit, at the trigger'];

const section: CSSProperties = { padding: '96px 0', position: 'relative', zIndex: 1 };

export default function Home() {
  return (
    <div style={{ paddingTop: 64 }}>
      <Navbar />

      {/* Hero */}
      <section style={{ ...section, paddingTop: 120, paddingBottom: 72 }}>
        <div className="container" style={{ display: 'grid', gap: 56, gridTemplateColumns: '1.15fr 0.85fr', alignItems: 'center' }}>
          <div>
            <div className="pill"><span className="dot" /> Live on Zama FHEVM · Sepolia</div>
            <h1 style={{ fontSize: 58, lineHeight: 1.04, letterSpacing: '-0.035em', fontWeight: 800, margin: '22px 0 20px' }}>
              The private <span className="grad-text">credit layer</span> for onchain lending.
            </h1>
            <p className="muted" style={{ fontSize: 19, lineHeight: 1.55, maxWidth: 540 }}>
              Every lending position onchain is a public broadcast — your size, debt, and liquidation price. CreditLend
              encrypts <em style={{ color: 'var(--text)', fontStyle: 'normal' }}>creditworthiness itself</em>, so lending
              can be credit-based, not just over-collateralized. Computed end-to-end on ciphertext.
            </p>
            <div style={{ display: 'flex', gap: 14, marginTop: 34 }}>
              <Link className="btn btn-primary" href="/app">Launch app →</Link>
              <a className="btn btn-ghost" href="#how">See how it works</a>
            </div>
          </div>

          {/* floating encrypted credit-report card */}
          <div className="card" style={{ padding: 26, position: 'relative', boxShadow: '0 30px 60px -24px rgba(20,66,46,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span className="eyebrow">Private credit report</span>
              <span className="pill" style={{ padding: '4px 10px', fontSize: 11 }}>🔓 you only</span>
            </div>
            <div style={{ display: 'grid', gap: 13 }}>
              {[['Balance', '+200', '58%'], ['Account age', '+200', '58%'], ['History', '+0', '4%']].map(([k, v, w]) => (
                <div key={k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 6 }}>
                    <span className="muted">{k}</span><span className="mono" style={{ color: 'var(--accent)' }}>{v}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 6, background: 'var(--bg-input)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: w as string, background: 'linear-gradient(90deg, var(--accent-dim), var(--accent))', borderRadius: 6 }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div><div className="dim" style={{ fontSize: 12 }}>Score</div><div style={{ fontSize: 30, fontWeight: 700 }}>400</div></div>
              <div style={{ textAlign: 'right' }}><div className="dim" style={{ fontSize: 12 }}>Risk band</div><div style={{ fontSize: 30, fontWeight: 700, color: 'var(--accent)' }}>3<span className="dim" style={{ fontSize: 16 }}>/5</span></div></div>
            </div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 16, wordBreak: 'break-all' }}>
              handle 0x8f2a…7c14 · onchain: <span style={{ color: 'var(--purple)' }}>euint32</span> (encrypted)
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={section}>
        <div className="container">
          <div className="eyebrow">What makes it different</div>
          <h2 style={{ fontSize: 38, letterSpacing: '-0.03em', fontWeight: 700, margin: '12px 0 8px' }}>Confidential creditworthiness, end to end</h2>
          <p className="muted" style={{ fontSize: 17, maxWidth: 560, marginBottom: 44 }}>A private credit layer no transparent lender — or amount-only confidential lender — can offer.</p>
          <div className="grid grid-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card card-hover">
                <span className="lock-badge">{f.icon}</span>
                <h3 style={{ fontSize: 18, fontWeight: 650, margin: '16px 0 8px', letterSpacing: '-0.01em' }}>{f.title}</h3>
                <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.55 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={section}>
        <div className="container">
          <div className="eyebrow">The loop</div>
          <h2 style={{ fontSize: 38, letterSpacing: '-0.03em', fontWeight: 700, margin: '12px 0 44px' }}>How a confidential loan works</h2>
          <div className="grid" style={{ gap: 14 }}>
            {STEPS.map((s) => (
              <div key={s.n} className="card" style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 20, alignItems: 'center', padding: '22px 26px' }}>
                <span className="mono" style={{ fontSize: 26, fontWeight: 500, color: 'var(--accent-dim)' }}>{s.n}</span>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.01em' }}>{s.t}</h3>
                  <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.5, marginTop: 4 }}>{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy ledger */}
      <section id="privacy" style={section}>
        <div className="container">
          <div className="eyebrow">The threat model</div>
          <h2 style={{ fontSize: 38, letterSpacing: '-0.03em', fontWeight: 700, margin: '12px 0 44px' }}>What&apos;s hidden vs. public</h2>
          <div className="grid grid-2">
            <div className="card" style={{ borderColor: 'rgba(22,163,74,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
                <span style={{ fontSize: 18 }}>🔒</span><span style={{ fontWeight: 650, fontSize: 17 }}>Encrypted</span>
              </div>
              {HIDDEN.map((h) => (
                <div key={h} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)', fontSize: 14.5 }}>
                  <span style={{ color: 'var(--green)' }}>✓</span> {h}
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
                <span style={{ fontSize: 18 }}>🌐</span><span style={{ fontWeight: 650, fontSize: 17 }}>Public</span>
              </div>
              {PUBLIC.map((p) => (
                <div key={p} className="muted" style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)', fontSize: 14.5 }}>
                  <span className="dim">·</span> {p}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ ...section, paddingBottom: 40 }}>
        <div className="container">
          <div className="card" style={{ textAlign: 'center', padding: '60px 24px', background: 'radial-gradient(600px circle at 50% 0%, rgba(22,163,74,0.10), transparent 70%), var(--bg-surface)' }}>
            <h2 style={{ fontSize: 34, letterSpacing: '-0.03em', fontWeight: 750 }}>Borrow with your credit — not your privacy.</h2>
            <p className="muted" style={{ fontSize: 17, margin: '14px auto 30px', maxWidth: 480 }}>Connect a Sepolia wallet and decrypt your own private credit report in seconds.</p>
            <Link className="btn btn-primary" href="/app" style={{ padding: '14px 28px', fontSize: 16 }}>Launch app →</Link>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '28px 0', position: 'relative', zIndex: 1 }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span className="dim" style={{ fontSize: 13.5 }}>CreditLend · Confidential lending on Zama FHEVM</span>
          <span className="dim mono" style={{ fontSize: 12.5 }}>ERC-7984 · Chainlink · FHEVM Sepolia</span>
        </div>
      </footer>
    </div>
  );
}
