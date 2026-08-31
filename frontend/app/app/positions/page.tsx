'use client';
import { PositionsPanel } from '@/components/app/PositionsPanel';
import { PageHeader, ConnectGate } from '@/components/app/ui';
export default function PositionsPage() {
  return (
    <div>
      <PageHeader title="Positions" subtitle="Decrypt your debt & collateral per market, and repay." />
      <ConnectGate><PositionsPanel /></ConnectGate>
    </div>
  );
}
