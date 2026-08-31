'use client';
import { BorrowPanel } from '@/components/app/BorrowPanel';
import { PageHeader, ConnectGate } from '@/components/app/ui';
export default function BorrowPage() {
  return (
    <div>
      <PageHeader title="Borrow" subtitle="Deposit confidential collateral, borrow against your encrypted credit band." />
      <ConnectGate><BorrowPanel /></ConnectGate>
    </div>
  );
}
