import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CreditLend — Confidential Lending + No-Loss Prize Savings on Zama FHEVM',
  description:
    'A confidential lending market whose interest funds a no-loss prize pool. Encrypted credit scores, risk-priced rates, and sealed-bid liquidations — and savers win the yield in a provably-fair FHE draw. Computed entirely on ciphertext with Zama FHEVM.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: '#E9F4EE', colorScheme: 'light' }}>
      <body style={{ background: '#E9F4EE', color: '#0F241A' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
