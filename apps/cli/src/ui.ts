/** Tiny terminal helpers: ANSI colours (auto-off when not a TTY / NO_COLOR), tables, number formats. */

let enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function setColor(on: boolean): void {
  enabled = on;
}

const wrap = (open: number, close: number) => (s: string | number): string => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  pink: wrap(95, 39),
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export const visibleLength = (s: string): number => [...s.replace(ANSI, '')].length;

function pad(s: string, width: number, right = false): string {
  const gap = Math.max(0, width - visibleLength(s));
  return right ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

/** Render rows as an aligned table. Columns whose header starts with '>' are right-aligned. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const right = headers.map((h) => h.startsWith('>'));
  const heads = headers.map((h) => h.replace(/^>/, ''));
  const cells = rows.map((r) => r.map((v) => String(v)));
  const widths = heads.map((h, i) => Math.max(visibleLength(h), ...cells.map((r) => visibleLength(r[i] ?? ''))));
  const line = (r: string[]): string => r.map((v, i) => pad(v, widths[i]!, right[i])).join('  ');
  return [c.bold(line(heads)), c.dim(widths.map((w) => '─'.repeat(w)).join('  ')), ...cells.map(line)].join('\n');
}

/** Two-column key/value block. */
export function kv(pairs: [string, string | number][]): string {
  const w = Math.max(...pairs.map(([k]) => visibleLength(k)));
  return pairs.map(([k, v]) => `  ${c.gray(pad(k, w))}  ${v}`).join('\n');
}

export function money(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return String(n);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '-' : ''}$${s}`;
}

export function signedMoney(n: number): string {
  const s = money(n);
  return n > 0 ? c.green(`+${s}`) : n < 0 ? c.red(s) : s;
}

export function pct(n: number, digits = 2): string {
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : String(n);
}

export function num(n: number | undefined, digits = 2): string {
  if (n === undefined || Number.isNaN(n)) return c.gray('n/a');
  if (n === Infinity) return '∞';
  if (n === -Infinity) return '-∞';
  return n.toFixed(digits);
}

export function signedPct(n: number): string {
  const s = pct(n);
  return n > 0 ? c.green(`+${s}`) : n < 0 ? c.red(s) : s;
}

export function date(t: number): string {
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

export function day(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export const GRADE_COLOR: Record<string, (s: string) => string> = {
  S: (s) => c.magenta(c.bold(s)),
  A: (s) => c.green(c.bold(s)),
  B: (s) => c.cyan(c.bold(s)),
  C: (s) => c.yellow(c.bold(s)),
  D: (s) => c.red(c.bold(s)),
};

export function bar(fraction: number, width = 20): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const n = Math.round(f * width);
  return c.pink('█'.repeat(n)) + c.dim('░'.repeat(width - n));
}
