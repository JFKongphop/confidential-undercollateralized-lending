import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CreditLend — Confidential Credit-Based Lending on Zama FHEVM',
  description:
    'The private credit layer for onchain lending. Encrypted credit scores, risk-priced rates, and sealed-bid liquidations — computed entirely on ciphertext with Zama FHEVM.',
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
