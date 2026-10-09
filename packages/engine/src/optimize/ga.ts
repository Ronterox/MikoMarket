import type { GAGeneration, GAOptions, GAResult, GeneSpec } from '../types.ts';
import { createRng, type Rng } from '../util/rng.ts';

export const DEFAULT_GA_OPTIONS: GAOptions = {
  population: 40,
  generations: 25,
  eliteCount: 2,
  mutationRate: 0.15,
  crossoverRate: 0.8,
  tournamentSize: 3,
  seed: 42,
};

/**
 * Engine-local extension of GAOptions (not part of the shared contract).
 * `initial`: genomes injected into generation 0 (e.g. the strategy's current
 * parameters), so with elitism the result is never worse than the starting point.
 */
export interface EvolveOptions extends Partial<GAOptions> {
  initial?: number[][];
}

/** Clamp to [min, max] and snap to `step` / integers. Pure, deterministic. */
export function snapGene(value: number, gene: GeneSpec): number {
  let lo = Math.min(gene.min, gene.max);
  let hi = Math.max(gene.min, gene.max);
  if (gene.int) {
    lo = Math.ceil(lo);
    hi = Math.max(lo, Math.floor(hi));
  }
  let v = Number.isFinite(value) ? value : (lo + hi) / 2;
  v = Math.min(hi, Math.max(lo, v));
  if (gene.step && gene.step > 0) {
    v = lo + Math.round((v - lo) / gene.step) * gene.step;
    if (v > hi + 1e-12) v -= gene.step;
    // kill float noise like 0.30000000000000004
    v = Number(v.toPrecision(12));
  }
  if (gene.int) v = Math.round(v);
  return Math.min(hi, Math.max(lo, v));
}

/** NaN / errors / -Infinity => -Infinity (always loses); +Infinity => MAX_VALUE. */
function sanitize(f: number): number {
  if (Number.isNaN(f)) return -Infinity;
  if (f === Infinity) return Number.MAX_VALUE;
  return f;
}

/**
 * Real-coded genetic algorithm, generic and deterministic for a given seed.
 * - Generation 0: `initial` genomes + uniform random genomes.
 * - Each following generation: elitism (top `eliteCount` copied), tournament
 *   selection, crossover (uniform or BLX-0.5 blend, chosen per pair), gaussian
 *   mutation with sigma = range * (0.2 decaying to 0.03), plus rare uniform resets
 *   to escape local optima. Every genome is snapped/clamped before evaluation.
 * - Fitness is cached by snapped genome, so duplicates are never re-evaluated
 *   (`evaluations` counts real calls). Total generations evaluated = `generations`.
 * - `onGeneration` returning `false` stops early.
 */
export function evolve(
  genes: GeneSpec[],
  fitness: (values: number[]) => number,
  opts: EvolveOptions = {},
  onGeneration?: (g: GAGeneration) => void | boolean,
): GAResult {
  const o = { ...DEFAULT_GA_OPTIONS, ...stripUndefined(opts) };
  const popSize = Math.max(2, Math.floor(o.population));
  const generations = Math.max(1, Math.floor(o.generations));
  const eliteCount = Math.min(popSize, Math.max(0, Math.floor(o.eliteCount)));
  const tourSize = Math.min(popSize, Math.max(1, Math.floor(o.tournamentSize)));
  const rng = createRng(o.seed);

  const cache = new Map<string, number>();
  let evaluations = 0;
  const evaluate = (genome: number[]): number => {
    const key = genome.join(',');
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let f: number;
    try {
      f = sanitize(fitness(genome.slice()));
    } catch {
      f = -Infinity;
    }
    evaluations++;
    cache.set(key, f);
    return f;
  };

  const snap = (g: number[]) => g.map((v, i) => snapGene(v, genes[i]!));
  const random = () => genes.map((gene) => snapGene(rng.float(gene.min, gene.max), gene));

  let best: { genome: number[]; fitness: number } = { genome: [], fitness: -Infinity };
  const history: GAGeneration[] = [];

  if (genes.length === 0) {
    const f = evaluate([]);
    const g: GAGeneration = { generation: 0, best: f, mean: f, bestGenome: [] };
    history.push(g);
    onGeneration?.(g);
    return { bestGenome: [], bestFitness: f, history, evaluations };
  }

  let pop: number[][] = [];
  for (const init of opts.initial ?? []) {
    if (pop.length >= popSize) break;
    if (init.length === genes.length) pop.push(snap(init));
  }
  while (pop.length < popSize) pop.push(random());

  for (let gen = 0; gen < generations; gen++) {
    const fit = pop.map(evaluate);
    // stable ranking: by fitness desc, index asc (determinism)
    const order = fit.map((_, i) => i).sort((a, b) => cmp(fit[b]!, fit[a]!) || a - b);
    const top = order[0]!;
    if (best.genome.length === 0 || fit[top]! > best.fitness) {
      best = { genome: pop[top]!.slice(), fitness: fit[top]! };
    }
    let sum = 0;
    let finite = 0;
    for (const f of fit) if (Number.isFinite(f)) { sum += f; finite++; }
    const g: GAGeneration = {
      generation: gen,
      best: best.fitness,
      mean: finite ? sum / finite : -Infinity,
      bestGenome: best.genome.slice(),
    };
    history.push(g);
    if (onGeneration?.(g) === false) break;
    if (gen === generations - 1) break;

    const progress = generations > 1 ? gen / (generations - 1) : 1;
    const sigmaScale = 0.2 - (0.2 - 0.03) * progress;
    const next: number[][] = [];
    for (let e = 0; e < eliteCount; e++) next.push(pop[order[e]!]!.slice());

    const pick = (): number[] => {
      let w = rng.int(0, popSize - 1);
      for (let t = 1; t < tourSize; t++) {
        const c = rng.int(0, popSize - 1);
        if (cmp(fit[c]!, fit[w]!) > 0) w = c;
      }
      return pop[w]!;
    };

    while (next.length < popSize) {
      const a = pick();
      const b = pick();
      let [c1, c2] = rng.next() < o.crossoverRate ? crossover(a, b, rng) : [a.slice(), b.slice()];
      c1 = snap(mutate(c1, genes, o.mutationRate, sigmaScale, rng));
      c2 = snap(mutate(c2, genes, o.mutationRate, sigmaScale, rng));
      next.push(c1);
      if (next.length < popSize) next.push(c2);
    }
    pop = next;
  }

  return { bestGenome: best.genome, bestFitness: best.fitness, history, evaluations };
}

function cmp(a: number, b: number): number {
  return a === b ? 0 : a > b ? 1 : -1;
}

function crossover(a: number[], b: number[], rng: Rng): [number[], number[]] {
  const c1 = a.slice();
  const c2 = b.slice();
  if (rng.next() < 0.5) {
    for (let i = 0; i < a.length; i++) {
      if (rng.next() < 0.5) { c1[i] = b[i]!; c2[i] = a[i]!; }
    }
  } else {
    // BLX-alpha blend, alpha = 0.5: sample in the parents' interval widened by 50%
    for (let i = 0; i < a.length; i++) {
      const lo = Math.min(a[i]!, b[i]!);
      const hi = Math.max(a[i]!, b[i]!);
      const d = (hi - lo) * 0.5;
      c1[i] = rng.float(lo - d, hi + d);
      c2[i] = rng.float(lo - d, hi + d);
    }
  }
  return [c1, c2];
}

function mutate(g: number[], genes: GeneSpec[], rate: number, sigmaScale: number, rng: Rng): number[] {
  for (let i = 0; i < g.length; i++) {
    if (rng.next() >= rate) continue;
    const gene = genes[i]!;
    const range = Math.abs(gene.max - gene.min);
    if (rng.next() < 0.1) {
      g[i] = rng.float(gene.min, gene.max); // rare reset: escape local optima
    } else {
      let delta = rng.gaussian() * range * sigmaScale;
      // make sure an int/step gene actually moves when mutated
      const minMove = gene.step && gene.step > 0 ? gene.step : gene.int ? 1 : 0;
      if (minMove && Math.abs(delta) < minMove) delta = delta < 0 ? -minMove : minMove;
      g[i] = g[i]! + delta;
    }
  }
  return g;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
