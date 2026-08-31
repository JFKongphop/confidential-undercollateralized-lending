'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CandlestickSeries,
  type IChartApi, type Time, type CandlestickData,
} from 'lightweight-charts';

// map our confidential-token symbols to Binance base assets
const SYM: Record<string, string> = { cWETH: 'ETH', cWBTC: 'BTC', cLINK: 'LINK', cUSDC: 'USDT', cEUR: 'EUR' };

function toCandle(k: any[]): CandlestickData {
  return { time: Math.floor(k[0] / 1000) as Time, open: +k[1], high: +k[2], low: +k[3], close: +k[4] };
}
const invert = (c: CandlestickData): CandlestickData => ({
  time: c.time, open: 1 / c.open, high: 1 / c.low, low: 1 / c.high, close: 1 / c.close,
});

async function fetchKlines(symbol: string): Promise<any[] | null> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=120`);
    const j = await r.json();
    return Array.isArray(j) ? j : null; // Binance returns an error object for invalid symbols
  } catch {
    return null;
  }
}

export function PriceChart({ market }: { market: { collateral: string; debt: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading');

  useEffect(() => {
    if (!ref.current) return;
    const base = SYM[market.collateral];
    const quote = SYM[market.debt];
    setStatus('loading');

    const chart: IChartApi = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#47695A', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(20,66,46,0.06)' }, horzLines: { color: 'rgba(20,66,46,0.06)' } },
      crosshair: { vertLine: { color: 'rgba(20,66,46,0.28)' }, horzLine: { color: 'rgba(20,66,46,0.28)' } },
      rightPriceScale: { borderColor: 'rgba(20,66,46,0.12)', minimumWidth: 76 },
      timeScale: { borderColor: 'rgba(20,66,46,0.12)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      autoSize: true,
      height: 300,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#34D399', downColor: '#F87171', borderVisible: false,
      wickUpColor: '#34D399', wickDownColor: '#F87171',
    });

    let ws: WebSocket | null = null;
    let cancelled = false;

    (async () => {
      let symbol = `${base}${quote}`;
      let doInvert = false;
      let klines = await fetchKlines(symbol);
      if (!klines) { symbol = `${quote}${base}`; doInvert = true; klines = await fetchKlines(symbol); }
      if (cancelled) return;
      if (!klines) { setStatus('unavailable'); return; }

      const data = klines.map(toCandle).map((c) => (doInvert ? invert(c) : c));
      const sample = data[data.length - 1].close;
      const prec = sample < 1 ? 6 : sample < 10 ? 4 : 2;
      series.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: 1 / 10 ** prec } });
      series.setData(data);
      chart.timeScale().fitContent();
      setStatus('ok');

      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`);
      ws.onmessage = (e) => {
        const k = JSON.parse(e.data).k;
        let c: CandlestickData = { time: Math.floor(k.t / 1000) as Time, open: +k.o, high: +k.h, low: +k.l, close: +k.c };
        if (doInvert) c = invert(c);
        series.update(c);
      };
    })();

    return () => { cancelled = true; ws?.close(); chart.remove(); };
  }, [market.collateral, market.debt]);

  return (
    <div style={{ position: 'relative', width: '100%', height: 300 }}>
      <div ref={ref} style={{ width: '100%', height: 300, opacity: status === 'ok' ? 1 : 0.25, transition: 'opacity .2s' }} />
      {status !== 'ok' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <span className="dim" style={{ fontSize: 13.5 }}>
            {status === 'loading' ? 'Loading price…' : 'Live chart unavailable for this pair'}
          </span>
        </div>
      )}
    </div>
  );
}
