import { evolveStrategy, runBacktest, splitInOut, stressTest } from '@miko/engine';
import { generateDemoSeries } from '../lib/demoData.ts';
import type { WorkerMessage, WorkerProgress, WorkerRequest } from './protocol.ts';

const post = (m: WorkerMessage) => (self as unknown as { postMessage(m: WorkerMessage): void }).postMessage(m);

self.onmessage = (e: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = e.data;
  const progress = (p: WorkerProgress) => post({ id, type: 'progress', progress: p });
  try {
    const result = run(req, progress);
    post({ id, type: 'done', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function run(req: WorkerRequest, progress: (p: WorkerProgress) => void): unknown {
  switch (req.kind) {
    case 'demo':
      return generateDemoSeries(req.instrument, req.timeframe, req.count, req.seed, req.startPrice);
    case 'backtest': {
      const split = splitInOut(req.series, 0.3);
      const range = req.range ?? 'in';
      const [startIndex, endIndex] = range === 'in' ? split.inSample : range === 'out' ? split.outOfSample : [0, req.series.bars.length - 1];
      return runBacktest(req.series, req.spec, { startIndex, endIndex });
    }
    case 'evolve': {
      const split = splitInOut(req.series, 0.3);
      const before = runBacktest(req.series, req.spec, { startIndex: split.inSample[0], endIndex: split.inSample[1] });
      const out = evolveStrategy(req.series, req.spec, {
        fitness: 'robust',
        oosFraction: 0.3,
        ga: { generations: req.generations, population: req.population, seed: req.seed },
        onGeneration: (gen) => progress({ kind: 'generation', gen, total: req.generations }),
      });
      return { ...out, before };
    }
    case 'stress':
      progress({ kind: 'stage', label: 'monteCarlo', pct: 0.2 });
      return stressTest(req.series, req.spec, { oosFraction: 0.3, monteCarlo: { runs: 1000, seed: req.seed } });
  }
}
