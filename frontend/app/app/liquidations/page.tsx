'use client';

import { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { useEncrypt, usePublicDecrypt } from '@zama-fhe/react-sdk';
import { bytesToHex, isAddress } from 'viem';
import { wagmiConfig } from '@/lib/wagmi';
import { PageHeader, ConnectGate, inputStyle, labelStyle } from '@/components/app/ui';
import { MARKETS, ADDR, ENGINE_ABI, AUCTION_ABI, NULL_HANDLE } from '@/lib/lending';

function Card({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <span className="eyebrow">{eyebrow}</span>
      <h3 style={{ fontSize: 18, fontWeight: 650, margin: '8px 0 14px' }}>{title}</h3>
      {children}
    </div>
  );
}

function Liquidations() {
  const { address } = useAccount();
  const encrypt = useEncrypt();
  const publicDecrypt = usePublicDecrypt();
  const { writeContractAsync } = useWriteContract();

  const [mid, setMid] = useState(0);
  const [borrower, setBorrower] = useState('');
  const [reqId, setReqId] = useState('0');
  const [aucId, setAucId] = useState('0');
  const [bid, setBid] = useState('900');
  const [log, setLog] = useState('');
  const [busy, setBusy] = useState('');

  async function request() {
    if (!isAddress(borrower)) return;
    setBusy('Requesting…');
    try {
      await writeContractAsync({ address: ADDR.engine, abi: ENGINE_ABI, functionName: 'requestLiquidation', args: [BigInt(mid), borrower as `0x${string}`], gas: 15_000_000n });
      setLog('Liquidation requested — note the requestId (increments from 0), then Fulfill.');
    } finally { setBusy(''); }
  }

  async function fulfill() {
    setBusy('Revealing…');
    try {
      const req: any = await readContract(wagmiConfig, { address: ADDR.engine, abi: ENGINE_ABI, functionName: 'pendingLiquidations', args: [BigInt(reqId)] });
      const flag = req[2] as `0x${string}`;
      if (!flag || flag === NULL_HANDLE) { setLog('No pending request at that id.'); return; }
      const dec = await publicDecrypt.mutateAsync([flag]);
      await writeContractAsync({ address: ADDR.engine, abi: ENGINE_ABI, functionName: 'fulfillLiquidation', args: [BigInt(reqId), dec.abiEncodedClearValues as `0x${string}`, dec.decryptionProof as `0x${string}`], gas: 5_000_000n });
      setLog('Fulfilled — if liquidatable, collateral was seized and an auction opened.');
    } finally { setBusy(''); }
  }

  async function placeBid() {
    if (!address) return;
    setBusy('Bidding…');
    try {
      const enc = await encrypt.mutateAsync({ values: [{ value: BigInt(bid || '0'), type: 'euint64' }], contractAddress: ADDR.auction, userAddress: address });
      await writeContractAsync({ address: ADDR.auction, abi: AUCTION_ABI, functionName: 'bid', args: [BigInt(aucId), bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)], gas: 15_000_000n });
      setLog('Sealed bid placed on the encrypted running-max.');
    } finally { setBusy(''); }
  }

  async function settle() {
    setBusy('Settling…');
    try {
      await writeContractAsync({ address: ADDR.auction, abi: AUCTION_ABI, functionName: 'settle', args: [BigInt(aucId)], gas: 5_000_000n });
      const info: any = await readContract(wagmiConfig, { address: ADDR.auction, abi: AUCTION_ABI, functionName: 'auctionInfo', args: [BigInt(aucId)] });
      const dec = await publicDecrypt.mutateAsync([info[1], info[2]]);
      await writeContractAsync({ address: ADDR.auction, abi: AUCTION_ABI, functionName: 'fulfillSettle', args: [BigInt(aucId), dec.abiEncodedClearValues as `0x${string}`, dec.decryptionProof as `0x${string}`], gas: 5_000_000n });
      setLog('Auction settled — the winning liquidator was paid the seized collateral.');
    } finally { setBusy(''); }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
        <Card eyebrow="Trigger" title="Request liquidation">
          <label style={labelStyle}>Market</label>
          <select value={mid} onChange={(e) => setMid(Number(e.target.value))} style={inputStyle}>
            {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.collateral} → {m.debt}</option>)}
          </select>
          <label style={labelStyle}>Borrower address</label>
          <input className="mono" placeholder="0x…" value={borrower} onChange={(e) => setBorrower(e.target.value.trim())} style={inputStyle} />
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} disabled={!isAddress(borrower) || !!busy} onClick={request}>{busy === 'Requesting…' ? busy : 'Request'}</button>
        </Card>

        <Card eyebrow="Reveal one bit" title="Fulfill liquidation">
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>KMS-decrypts only the health bit, then seizes if liquidatable.</p>
          <label style={labelStyle}>Request id</label>
          <input className="mono" value={reqId} onChange={(e) => setReqId(e.target.value.replace(/\D/g, ''))} style={inputStyle} />
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }} disabled={!!busy} onClick={fulfill}>{busy === 'Revealing…' ? busy : 'Fulfill'}</button>
        </Card>
      </div>

      <Card eyebrow="Sealed-bid auction" title="Bid on ciphertext, then settle">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 10, alignItems: 'end' }}>
          <div><label style={labelStyle}>Auction id</label><input className="mono" value={aucId} onChange={(e) => setAucId(e.target.value.replace(/\D/g, ''))} style={inputStyle} /></div>
          <div><label style={labelStyle}>Your bid</label><input className="mono" value={bid} onChange={(e) => setBid(e.target.value.replace(/\D/g, ''))} style={inputStyle} /></div>
          <button className="btn btn-ghost" style={{ height: 44 }} disabled={!address || !!busy} onClick={placeBid}>{busy === 'Bidding…' ? busy : 'Place bid'}</button>
          <button className="btn btn-primary" style={{ height: 44 }} disabled={!!busy} onClick={settle}>{busy === 'Settling…' ? busy : 'Settle + pay'}</button>
        </div>
      </Card>

      {log && <div className="card muted" style={{ padding: '14px 18px', fontSize: 14 }}>{log}</div>}
    </div>
  );
}

export default function LiquidationsPage() {
  return (
    <div>
      <PageHeader title="Liquidations" subtitle="Reveal-only-at-trigger liquidation, then a sealed-bid auction settled on ciphertext. (A keeper can automate all of this.)" />
      <ConnectGate><Liquidations /></ConnectGate>
    </div>
  );
}
