'use client';

import { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { PageHeader, ConnectGate } from '@/components/app/ui';
import { TOKENS, ADDR, ERC7984_ABI } from '@/lib/lending';

function TokenRow({ sym }: { sym: string }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const addr = ADDR[sym];

  async function mint() {
    if (!address) return;
    setBusy(true);
    try {
      await writeContractAsync({ address: addr, abi: ERC7984_ABI, functionName: 'mint', args: [address, 100_000n], gas: 3_000_000n });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="lock-badge">{sym[1]}</span>
        <div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{sym}</div>
          <div className="dim mono" style={{ fontSize: 11.5 }}>{addr?.slice(0, 10)}…{addr?.slice(-6)}</div>
        </div>
      </div>
      <button className="btn btn-ghost" onClick={mint} disabled={!address || busy}>{busy ? 'Minting…' : 'Mint 100,000'}</button>
    </div>
  );
}

export default function FaucetPage() {
  return (
    <div>
      <PageHeader title="Faucet" subtitle="Mint confidential (ERC-7984) test tokens to your wallet — balances stay encrypted." />
      <ConnectGate>
        <div className="grid" style={{ gap: 12 }}>
          {TOKENS.map((t) => (
            <TokenRow key={t} sym={t} />
          ))}
        </div>
      </ConnectGate>
    </div>
  );
}
