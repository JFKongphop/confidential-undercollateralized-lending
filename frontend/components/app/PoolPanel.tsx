'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { useEncrypt, useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { SAVINGS, TOKEN, TOKEN_ABI, PRIZE_ABI, PRIZE, NULL_HANDLE } from '@/lib/pool';

const inp: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: '11px 13px', fontSize: 15,
  background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
};

export function PoolPanel() {
  const { address } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const [depositAmt, setDepositAmt] = useState('1000');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [busy, setBusy] = useState('');
  const [reveal, setReveal] = useState(false);

  // encrypted pool balance handle (principal + any winnings)
  const { data: balH } = useReadContract({
    address: PRIZE, abi: PRIZE_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 4000 },
  });
  const { data: isDep } = useReadContract({
    address: PRIZE, abi: PRIZE_ABI, functionName: 'isDepositor',
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 4000 },
  });

  const CONTRACTS: [`0x${string}`, ...`0x${string}`[]] = [PRIZE];
  const { mutateAsync: allow, isPending: allowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });
  const handle = balH as `0x${string}` | undefined;
  const handles = handle && handle !== NULL_HANDLE ? [{ handle, contractAddress: PRIZE }] : [];
  const { data: dec } = useUserDecrypt({ handles }, { enabled: reveal && !!isAllowed && handles.length > 0 });
  const decMap = dec as Record<string, bigint> | undefined;
  const balance = handle && decMap?.[handle] !== undefined ? decMap[handle] : undefined;

  async function deposit() {
    if (!address || !depositAmt) return;
    setBusy('Encrypting…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [{ value: BigInt(depositAmt), type: 'euint64' }],
        contractAddress: SAVINGS, // proof bound to the TOKEN for a confidentialTransferAndCall
        userAddress: address,
      });
      setBusy('Depositing…');
      await writeContractAsync({
        address: SAVINGS, abi: TOKEN_ABI, functionName: 'confidentialTransferAndCall',
        args: [PRIZE, bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof), '0x'], gas: 15_000_000n,
      });
    } finally { setBusy(''); }
  }

  async function withdraw() {
    if (!address || !withdrawAmt) return;
    setBusy('Encrypting…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [{ value: BigInt(withdrawAmt), type: 'euint64' }],
        contractAddress: PRIZE, userAddress: address,
      });
      setBusy('Withdrawing…');
      await writeContractAsync({
        address: PRIZE, abi: PRIZE_ABI, functionName: 'withdraw',
        args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)], gas: 15_000_000n,
      });
      setWithdrawAmt('');
    } finally { setBusy(''); }
  }

  async function decryptBalance() {
    if (!isAllowed) await allow(CONTRACTS);
    setReveal(true);
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
      {/* Deposit / Withdraw */}
      <div className="card">
        <span className="eyebrow">Save into the pool</span>
        <h3 style={{ fontSize: 20, fontWeight: 650, margin: '10px 0 6px' }}>Deposit & withdraw</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
          Your deposit is encrypted in the browser — the pool never sees the amount. Principal is withdrawable any time, no loss.
        </p>

        <label className="dim" style={{ fontSize: 12.5 }}>Deposit ({TOKEN.symbol})</label>
        <input className="mono" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value.replace(/\D/g, ''))} style={inp} />
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} disabled={!address || !!busy} onClick={deposit}>
          {busy === 'Encrypting…' || busy === 'Depositing…' ? busy : `Deposit ${TOKEN.symbol}`}
        </button>

        <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />

        <label className="dim" style={{ fontSize: 12.5 }}>Withdraw ({TOKEN.symbol})</label>
        <input className="mono" placeholder="amount" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value.replace(/\D/g, ''))} style={inp} />
        <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} disabled={!address || !withdrawAmt || !!busy} onClick={withdraw}>
          {busy === 'Withdrawing…' ? busy : `Withdraw ${TOKEN.symbol}`}
        </button>
        <p className="dim" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>Over-withdraw is clamped to your balance — never reverts, never leaks.</p>
      </div>

      {/* Confidential balance */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span className="eyebrow">Your confidential balance</span>
          <span className="pill" style={{ padding: '4px 10px', fontSize: 11 }}>🔓 you only</span>
        </div>

        {!isDep ? (
          <div className="dim" style={{ fontSize: 14, padding: '48px 0', textAlign: 'center' }}>No deposit yet — deposit to join the pool.</div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>Principal + any winnings</div>
              <div className="mono" style={{ fontSize: 46, fontWeight: 700, color: reveal && balance !== undefined ? 'var(--accent)' : 'var(--text)' }}>
                {!reveal ? '••••••' : balance !== undefined ? balance.toLocaleString() : '…'}
              </div>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>{TOKEN.symbol}</div>
            </div>
            <div style={{ marginTop: 'auto' }}>
              {!reveal ? (
                <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={decryptBalance} disabled={allowing}>
                  {allowing ? 'Signing…' : 'Decrypt my balance'}
                </button>
              ) : (
                <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setReveal(false)}>Hide</button>
              )}
              <p className="dim" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
                Win a draw and this number jumps — <strong style={{ color: 'var(--text)' }}>only you</strong> learn the outcome (EIP-712).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
