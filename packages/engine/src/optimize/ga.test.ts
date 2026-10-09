import { describe, expect, test } from 'bun:test';
import type { GeneSpec } from '../types.ts';
import { evolve, snapGene } from './ga.ts';

const box = (n: number, lo = -5.12, hi = 5.12): GeneSpec[] =>
  Array.from({ length: n }, (_, i) => ({ path: `/x${i}`, label: `x${i}`, min: lo, max: hi }));

const sphere = (v: number[]) => -v.reduce((s, x) => s + x * x, 0);
const rastrigin = (v: number[]) =>
  -(10 * v.length + v.reduce((s, x) => s + x * x - 10 * Math.cos(2 * Math.PI * x), 0));

describe('snapGene', () => {
  test('clamps, snaps to step and int', () => {
    expect(snapGene(12, { path: '', label: '', min: 0, max: 10 })).toBe(10);
    expect(snapGene(-3, { path: '', label: '', min: 0, max: 10 })).toBe(0);
    expect(snapGene(3.4, { path: '', label: '', min: 0, max: 10, int: true })).toBe(3);
    expect(snapGene(0.29, { path: '', label: '', min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapGene(1.3, { path: '', label: '', min: 0.5, max: 1.4, step: 0.25 })).toBe(1.25);
    expect(snapGene(NaN, { path: '', label: '', min: 2, max: 4 })).toBe(3);
    expect(snapGene(9.9, { path: '', label: '', min: 1.5, max: 9.5, int: true })).toBe(9);
  });
});

describe('evolve', () => {
  test('converges near the optimum of the sphere function', () => {
    const r = evolve(box(2), sphere, { seed: 1 });
    expect(r.bestFitness).toBeGreaterThan(-0.01);
    expect(r.history.length).toBe(25);
    expect(r.bestGenome.length).toBe(2);
  });

  test('finds the global basin of 2D Rastrigin', () => {
    for (const seed of [1, 2, 3]) {
      const r = evolve(box(2), rastrigin, { seed, population: 60, generations: 60 });
      expect(r.bestFitness).toBeGreaterThan(-0.5);
      for (const x of r.bestGenome) expect(Math.abs(x)).toBeLessThan(0.1);
    }
  });

  test('is deterministic for a seed and differs across seeds', () => {
    const a = evolve(box(3), rastrigin, { seed: 7 });
    const b = evolve(box(3), rastrigin, { seed: 7 });
    const c = evolve(box(3), rastrigin, { seed: 8 });
    expect(a).toEqual(b);
    expect(c.history).not.toEqual(a.history);
  });

  test('best fitness never decreases across generations', () => {
    const r = evolve(box(2), rastrigin, { seed: 3 });
    for (let i = 1; i < r.history.length; i++) {
      expect(r.history[i]!.best).toBeGreaterThanOrEqual(r.history[i - 1]!.best);
    }
  });

  test('int genes stay integral and in range; cache avoids duplicate evaluations', () => {
    const genes: GeneSpec[] = [
      { path: '/a', label: 'a', min: 1, max: 5, int: true },
      { path: '/b', label: 'b', min: 1, max: 4, int: true },
    ];
    let calls = 0;
    const seen = new Set<string>();
    const r = evolve(genes, (v) => {
      calls++;
      for (const [i, x] of v.entries()) {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(genes[i]!.min);
        expect(x).toBeLessThanOrEqual(genes[i]!.max);
      }
      const k = v.join(',');
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      return -((v[0]! - 4) ** 2) - (v[1]! - 2) ** 2;
    });
    expect(calls).toBe(r.evaluations);
    expect(calls).toBeLessThanOrEqual(20); // only 5x4 distinct genomes exist
    expect(r.bestGenome).toEqual([4, 2]);
  });

  test('step genes snap to the grid', () => {
    const genes: GeneSpec[] = [{ path: '/m', label: 'm', min: 0.5, max: 3, step: 0.25 }];
    const r = evolve(genes, (v) => -Math.abs(v[0]! - 1.8));
    expect(r.bestGenome[0]).toBe(1.75);
  });

  test('early stop when onGeneration returns false', () => {
    const seen: number[] = [];
    const r = evolve(box(2), sphere, { seed: 1 }, (g) => {
      seen.push(g.generation);
      return g.generation < 4;
    });
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(r.history.length).toBe(5);
  });

  test('NaN, -Infinity and throwing fitness never win', () => {
    const r = evolve(box(2), (v) => {
      if (v[0]! > 0) return NaN;
      if (v[1]! > 0) return -Infinity;
      if (v[0]! < -4) throw new Error('boom');
      return -Math.abs(v[0]! + 1);
    }, { seed: 5 });
    expect(Number.isFinite(r.bestFitness)).toBe(true);
    expect(r.bestGenome[0]!).toBeLessThanOrEqual(0);
    expect(r.bestGenome[1]!).toBeLessThanOrEqual(0);
    for (const g of r.history) expect(Number.isNaN(g.mean)).toBe(false);
  });

  test('all-invalid fitness still returns a result', () => {
    const r = evolve(box(2), () => NaN, { generations: 3 });
    expect(r.bestFitness).toBe(-Infinity);
    expect(r.bestGenome.length).toBe(2);
  });

  test('initial genomes are kept by elitism', () => {
    const r = evolve(box(2), sphere, { seed: 9, generations: 2, population: 4, initial: [[0, 0]] });
    expect(r.bestGenome).toEqual([0, 0]);
    expect(r.bestFitness === 0).toBe(true);
  });

  test('no genes evaluates once', () => {
    const r = evolve([], () => 3);
    expect(r).toMatchObject({ bestGenome: [], bestFitness: 3, evaluations: 1 });
  });
});
