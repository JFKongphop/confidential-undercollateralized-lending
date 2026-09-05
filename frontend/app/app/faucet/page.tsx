'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { PageHeader, ConnectGate } from '@/components/app/ui';
import { TOKENS, ADDR, ERC7984_ABI, NULL_HANDLE } from '@/lib/lending';

function TokenRow({ sym }: { sym: string }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const addr = ADDR[sym];

  // encrypted balance handle (re-read after every mint)
  const { data: balH } = useReadContract({
    address: addr,
    abi: ERC7984_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 4000 },
  });

  const CONTRACTS: [`0x${string}`, ...`0x${string}`[]] = [addr];
  const { mutateAsync: allow, isPending: allowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });

  const handle = balH as `0x${string}` | undefined;
  const handles = handle && handle !== NULL_HANDLE ? [{ handle, contractAddress: addr }] : [];
  const { data: dec } = useUserDecrypt({ handles }, { enabled: reveal && !!isAllowed && handles.length > 0 });
  const decMap = dec as Record<string, bigint> | undefined;
  const balance = handle && decMap?.[handle] !== undefined ? decMap[handle] : undefined;

  async function mint() {
    if (!address) return;
    setBusy(true);
    try {
      await writeContractAsync({ address: addr, abi: ERC7984_ABI, functionName: 'mint', args: [address, 100_000n], gas: 3_000_000n });
    } finally {
      setBusy(false);
    }
  }

  async function decryptBalance() {
    if (!isAllowed) await allow(CONTRACTS);
    setReveal(true);
  }

  const noBalance = !handle || handle === NULL_HANDLE;
  const balanceText = !reveal
    ? '••••••'
    : noBalance
    ? '0'
    : balance !== undefined
    ? balance.toLocaleString()
    : 'decrypting…';

  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="lock-badge">{sym[1]}</span>
        <div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{sym}</div>
          <div className="dim mono" style={{ fontSize: 11.5 }}>{addr?.slice(0, 10)}…{addr?.slice(-6)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* encrypted balance — decrypt in place */}
        <div style={{ textAlign: 'right', minWidth: 120 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
            {reveal ? '🔓 your balance' : '🔒 balance (encrypted)'}
          </div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: reveal && balance !== undefined ? 'var(--accent)' : 'var(--text)' }}>
            {balanceText}
          </div>
        </div>
        {!reveal ? (
          <button className="btn btn-ghost" onClick={decryptBalance} disabled={!address || allowing} style={{ whiteSpace: 'nowrap' }}>
            {allowing ? 'Signing…' : 'Decrypt balance'}
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => setReveal(false)} style={{ whiteSpace: 'nowrap' }}>
            Hide
          </button>
        )}
        <button className="btn btn-primary" onClick={mint} disabled={!address || busy} style={{ whiteSpace: 'nowrap' }}>
          {busy ? 'Minting…' : 'Mint 100,000'}
        </button>
      </div>
    </div>
  );
}

export default function FaucetPage() {
  return (
    <div>
      <PageHeader title="Faucet" subtitle="Mint confidential (ERC-7984) test tokens to your wallet — balances stay encrypted, and only you can decrypt them." />
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
