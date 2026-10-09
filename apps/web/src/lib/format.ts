/** Display-only formatting helpers. No trading logic lives here. */

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(v: number, cents = false): string {
  if (!Number.isFinite(v)) return '—';
  return (cents ? usd2 : usd0).format(v);
}

export function signedMoney(v: number, cents = false): string {
  if (!Number.isFinite(v)) return '—';
  const s = money(Math.abs(v), cents);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function compactMoney(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

export function pct(v: number, digits = 1, signed = false): string {
  if (!Number.isFinite(v)) return '—';
  const s = `${Math.abs(v).toFixed(digits)}%`;
  if (!signed) return v < 0 ? `−${s}` : s;
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '∞';
  if (v === Infinity) return '∞';
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/** ▲ / ▼ glyph so up/down never relies on colour alone. */
export function arrow(v: number): string {
  return v > 0 ? '▲' : v < 0 ? '▼' : '•';
}

export function priceFmt(v: number, tick = 0.01): string {
  const d = tick >= 1 ? 0 : Math.max(0, Math.min(5, Math.ceil(-Math.log10(tick))));
  return v.toFixed(d);
}

export function dateFmt(t: number, withTime = true): string {
  const d = new Date(t);
  return withTime
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
