import type { GeneSpec, StrategySpec } from '../types.ts';

/** RFC 6901 pointer -> unescaped tokens. '' is the whole document. */
export function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error(`Invalid JSON pointer "${path}"`);
  return path.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Reads the value at an RFC 6901 pointer, or undefined when the path does not exist. */
export function getAtPointer(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const tok of parsePointer(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(tok)) return undefined;
      cur = cur[Number(tok)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, tok)) return undefined;
      cur = (cur as Record<string, unknown>)[tok];
    }
  }
  return cur;
}

/** Returns a copy of `obj` with `value` set at `path`. Only the nodes on the path are cloned. */
export function setAtPointer<T>(obj: T, path: string, value: unknown): T {
  const toks = parsePointer(path);
  if (toks.length === 0) return value as T;
  const rec = (node: unknown, k: number): unknown => {
    const tok = toks[k]!;
    const last = k === toks.length - 1;
    if (Array.isArray(node)) {
      const copy = node.slice();
      const idx = tok === '-' ? copy.length : Number(tok);
      if (!Number.isInteger(idx) || idx < 0) throw new Error(`Invalid array index "${tok}" in "${path}"`);
      copy[idx] = last ? value : rec(copy[idx], k + 1);
      return copy;
    }
    const base = node !== null && typeof node === 'object' ? (node as Record<string, unknown>) : {};
    return { ...base, [tok]: last ? value : rec(base[tok], k + 1) };
  };
  return rec(obj, 0) as T;
}

/** Snaps a gene value into [min, max], onto its step grid, and to an integer when `int`. */
export function clampGene(g: GeneSpec, v: number): number {
  let x = Number.isFinite(v) ? v : g.min;
  if (g.step && g.step > 0) x = g.min + Math.round((x - g.min) / g.step) * g.step;
  if (g.int) x = Math.round(x);
  x = Math.min(g.max, Math.max(g.min, x));
  // tidy floating error from the step grid
  return g.int ? x : Number(x.toFixed(10));
}

/** Writes each gene value into a copy of the spec, using `spec.genes` (in order). */
export function applyGenome(spec: StrategySpec, values: readonly number[]): StrategySpec {
  const genes = spec.genes ?? [];
  let out = spec;
  for (let k = 0; k < genes.length && k < values.length; k++) {
    const g = genes[k]!;
    const v = clampGene(g, values[k]!);
    out = setAtPointer(out, g.path, v);
    for (const link of g.linked ?? []) {
      out = setAtPointer(out, link.path, clampLinked(g, (link.offset ?? 0) + (link.scale ?? 1) * v));
    }
  }
  return out;
}

/** Linked leaves keep the gene's int/step rounding (mirrored ranges stay on the grid). */
function clampLinked(g: GeneSpec, v: number): number {
  return g.int ? Math.round(v) : Math.round(v * 1e6) / 1e6;
}
