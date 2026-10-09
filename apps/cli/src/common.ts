import { existsSync, readFileSync } from 'node:fs';
import { STRATEGY_TEMPLATES, validateStrategy, type StrategySpec } from '@miko/engine';
import { getBars, parseTimeframe, type LoadedSeries } from '@miko/data';

export type Args = Record<string, string | boolean | undefined>;

export class CliError extends Error {}

export function str(args: Args, key: string, fallback?: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : fallback;
}

export function int(args: Args, key: string, fallback?: number): number | undefined {
  const v = args[key];
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new CliError(`--${key} must be a number (got "${v}")`);
  return n;
}

function parseDate(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new CliError(`Bad date "${v}" (use YYYY-MM-DD or ISO)`);
  return t;
}

/** Bars for --symbol/--tf/--bars/--from/--to (TradeStation when configured and not --offline). */
export async function loadSeries(args: Args, defaults: { symbol?: string; tf?: string } = {}): Promise<LoadedSeries> {
  const symbol = str(args, 'symbol', defaults.symbol ?? 'SPY')!;
  const timeframe = parseTimeframe(str(args, 'tf', defaults.tf ?? '15m')!);
  try {
    return await getBars(
      { symbol, timeframe, bars: int(args, 'bars'), from: parseDate(str(args, 'from')), to: parseDate(str(args, 'to')) },
      { client: args.offline ? null : undefined, log: (m) => { if (!args.json) console.error(m); } },
    );
  } catch (err) {
    throw new CliError((err as Error).message);
  }
}

/** --strategy as a template id ("tpl_ema_cross", "ema_cross", or the name) or a path to a JSON StrategySpec. */
export function resolveStrategy(ref: string | undefined): StrategySpec {
  if (!ref) {
    const ids = STRATEGY_TEMPLATES.map((t) => t.id).join(', ');
    throw new CliError(`--strategy is required: a template id (${ids}) or a path to a strategy JSON file`);
  }
  const want = ref.toLowerCase();
  const tpl = STRATEGY_TEMPLATES.find((t) =>
    t.id.toLowerCase() === want || t.id.toLowerCase() === `tpl_${want}` || t.name.toLowerCase() === want);
  let spec: StrategySpec;
  if (tpl) {
    spec = structuredClone(tpl);
  } else if (existsSync(ref)) {
    try {
      const parsed = JSON.parse(readFileSync(ref, 'utf8')) as StrategySpec | { spec?: StrategySpec; best?: StrategySpec };
      spec = ('version' in parsed ? parsed : (parsed as { spec?: StrategySpec }).spec ?? (parsed as { best?: StrategySpec }).best) as StrategySpec;
    } catch (err) {
      throw new CliError(`Could not read strategy ${ref}: ${(err as Error).message}`);
    }
  } else {
    throw new CliError(`Unknown strategy "${ref}". Templates: ${STRATEGY_TEMPLATES.map((t) => t.id).join(', ')} (or pass a .json path)`);
  }
  const problems = validateStrategy(spec);
  if (problems.length) throw new CliError(`Strategy "${ref}" is invalid:\n  - ${problems.join('\n  - ')}`);
  return spec;
}

/** JSON.stringify that survives Infinity/NaN (as strings) and typed arrays. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v as unknown as ArrayLike<number>);
    return v;
  }, 2);
}
