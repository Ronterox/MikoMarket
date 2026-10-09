import { create } from 'zustand';
import {
  autoGenes, BLOCK_CATALOG, describeCondition, emptyMetrics, linkMirrorGenes, listIndicators, mirrorCondition, mirrorGenes,
  STRATEGY_TEMPLATES, validateStrategy, getAtPointer, setAtPointer,
  type BacktestResult, type BlockCard, type Condition, type ExitRules, type GAGeneration, type GeneSpec,
  type RobustnessReport, type Sizing, type StrategySpec,
} from '@miko/engine';
import { runInWorker } from '../workers/client.ts';
import type { EvolveOutput } from '../workers/protocol.ts';
import { coach, todayLocal, useApp } from './app.ts';
import { usePlay } from './play.ts';
import { sound } from '../lib/sound.ts';
import { fx } from '../lib/fx.ts';
import { lsGet, lsSet } from '../lib/storage.ts';

/**
 * Builder model. The UI edits "cards" (long-form conditions with relative genes);
 * `buildSpec` turns them into a StrategySpec using the engine's mirror/gene helpers.
 */
export type Dir = 'long' | 'short' | 'both';
export type ExitPreset = 'safe' | 'balanced' | 'aggressive' | 'custom';

export interface CardInst {
  uid: string;
  blockId?: string;
  icon: string;
  label: string;
  cond: Condition;
  genes: GeneSpec[]; // paths relative to `cond`
}

export interface Draft {
  id: string;
  name: string;
  icon: string;
  dir: Dir;
  cards: CardInst[];
  exitPreset: ExitPreset;
  exits: ExitRules;
  sizing: Sizing;
}

export const EXIT_PRESETS: Record<Exclude<ExitPreset, 'custom'>, { icon: string; label: string; exits: ExitRules }> = {
  safe: { icon: '🛡️', label: 'Safe', exits: { stopLoss: { kind: 'atr', mult: 1.5, period: 14 }, takeProfit: { kind: 'rr', ratio: 1.5 } } },
  balanced: { icon: '⚖️', label: 'Balanced', exits: { stopLoss: { kind: 'atr', mult: 2, period: 14 }, takeProfit: { kind: 'rr', ratio: 2 } } },
  aggressive: { icon: '🔥', label: 'Aggressive', exits: { stopLoss: { kind: 'atr', mult: 3, period: 14 }, takeProfit: { kind: 'rr', ratio: 3 }, trailing: { kind: 'atr', mult: 3, period: 14 } } },
};

let uidSeq = 0;
const uid = () => `c${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

const INDICATOR_ICONS = new Map(listIndicators().map((m) => [m.id, m.icon]));

/** Structural signature ignoring numbers, to recognise catalog cards inside templates. */
function shape(c: unknown): string {
  return JSON.stringify(c, (_k, v) => (typeof v === 'number' ? 0 : v));
}

function iconFor(c: Condition): string {
  const find = (x: unknown): string | undefined => {
    if (!x || typeof x !== 'object') return undefined;
    const o = x as Record<string, unknown>;
    if (o.kind === 'indicator' && typeof o.id === 'string') return INDICATOR_ICONS.get(o.id);
    for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return undefined;
  };
  if (c.kind === 'candle') return '🕯️';
  if (c.kind === 'time') return '⏰';
  return find(c) ?? '🧩';
}

export function cardFromBlock(b: BlockCard): CardInst {
  return { uid: uid(), blockId: b.id, icon: b.icon, label: b.label, cond: structuredClone(b.condition), genes: b.genes.map((g) => ({ ...g })) };
}

function cardFromCondition(cond: Condition, genes: GeneSpec[]): CardInst {
  const sig = shape(cond);
  const block = BLOCK_CATALOG.find((b) => shape(b.condition) === sig);
  const label = block?.label ?? shortLabel(describeCondition(cond));
  return { uid: uid(), blockId: block?.id, icon: block?.icon ?? iconFor(cond), label, cond, genes: genes.length ? genes : block?.genes.map((g) => ({ ...g })) ?? [] };
}

function shortLabel(s: string): string {
  const words = s.split(' ');
  return words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : s;
}

function presetOf(exits: ExitRules): ExitPreset {
  for (const [k, p] of Object.entries(EXIT_PRESETS)) if (JSON.stringify(p.exits) === JSON.stringify(exits)) return k as ExitPreset;
  return 'custom';
}

/** Loads any StrategySpec (template, saved bot, evolved result) into builder cards. */
export function draftFromSpec(spec: StrategySpec, keepId = true): Draft {
  const dir: Dir = spec.long && spec.short ? 'both' : spec.short ? 'short' : 'long';
  const side = spec.long ? 'long' : 'short';
  const enter = spec.long?.enter ?? (spec.short ? mirrorCondition(spec.short.enter) : { kind: 'all', of: [] } as Condition);
  const genes = spec.genes ?? [];
  const multi = enter.kind === 'all';
  const conds: Condition[] = enter.kind === 'all' ? enter.of : [enter];
  const cards = conds.map((cond, i) => {
    const base = multi ? `/${side}/enter/of/${i}` : `/${side}/enter`;
    const rel = genes
      .filter((g) => g.path === base || g.path.startsWith(`${base}/`))
      .map((g) => {
        const out: GeneSpec = { ...g, path: g.path.slice(base.length), label: g.label.replace(/ \((long|short)\)$/, '') };
        const linked = (g.linked ?? []).filter((l) => l.path.startsWith(`${base}/`)).map((l) => ({ ...l, path: l.path.slice(base.length) }));
        if (linked.length) out.linked = linked; else delete out.linked;
        return out;
      });
    // Short-only specs were mirrored back to long form; their genes no longer match, use catalog genes.
    return cardFromCondition(structuredClone(cond), side === 'long' ? rel : []);
  });
  return {
    id: keepId ? spec.id : `bot_${Date.now().toString(36)}`,
    name: spec.name,
    icon: spec.icon ?? '🤖',
    dir,
    cards,
    exitPreset: presetOf(spec.exits),
    exits: structuredClone(spec.exits),
    sizing: structuredClone(spec.sizing),
  };
}

export function buildSpec(d: Draft): StrategySpec {
  const longEnter: Condition = { kind: 'all', of: d.cards.map((c) => c.cond) };
  const shortEnter: Condition = { kind: 'all', of: d.cards.map((c) => mirrorCondition(c.cond)) };
  const longGenes: GeneSpec[] = d.cards.flatMap((c, i) => c.genes.map((g) => {
    const base = `/long/enter/of/${i}`;
    const out: GeneSpec = { ...g, path: base + g.path };
    if (g.linked) out.linked = g.linked.map((l) => ({ ...l, path: base + l.path }));
    return out;
  }));
  const both: StrategySpec = { id: d.id, name: d.name, icon: d.icon, version: 1, long: { enter: longEnter }, short: { enter: shortEnter }, exits: d.exits, sizing: d.sizing };
  const exitGenes = autoGenes({ ...both, long: undefined, short: undefined }).filter((g) => g.path.startsWith('/exits'));
  if (d.dir === 'both') return { ...both, genes: [...linkMirrorGenes(both, longGenes), ...exitGenes] };
  if (d.dir === 'long') { const { short: _s, ...rest } = both; return { ...rest, genes: [...longGenes, ...exitGenes] }; }
  const sg = mirrorGenes(both, longGenes);
  const { long: _l, ...rest } = both;
  return { ...rest, genes: [...sg, ...exitGenes] };
}

export function geneValue(card: CardInst, g: GeneSpec): number {
  const v = getAtPointer(card.cond, g.path);
  return typeof v === 'number' ? v : g.min;
}

export type LabPanel = 'none' | 'test' | 'evolve' | 'stress';

interface LabState {
  draft: Draft;
  busy: 'none' | 'test' | 'evolve' | 'stress';
  panel: LabPanel;
  test: BacktestResult | null;
  gens: GAGeneration[];
  genTotal: number;
  evolved: EvolveOutput | null;
  stress: RobustnessReport | null;
  error: string | null;

  loadSpec(spec: StrategySpec, asNew?: boolean): void;
  setName(name: string): void;
  setDir(dir: Dir): void;
  addCard(b: BlockCard): void;
  removeCard(uid: string): void;
  setGene(uid: string, g: GeneSpec, v: number): void;
  setPreset(p: ExitPreset): void;
  setCustomExit(patch: { stop?: number; rr?: number; trail?: number | null }): void;
  runTest(): Promise<void>;
  runEvolve(): Promise<void>;
  keepEvolved(): void;
  runStress(): Promise<void>;
  save(): void;
  closePanel(): void;
}

const initialDraft = (): Draft => {
  const saved = lsGet<Draft>('miko.lab.draft');
  if (saved && Array.isArray(saved.cards)) return saved;
  return draftFromSpec(STRATEGY_TEMPLATES[0]!, false);
};

function lazySeries() {
  return usePlay.getState().series;
}

function celebrateXp(xp: number) {
  const { x, y } = fx.centerOf(document.querySelector('[data-fx="lab-actions"]'));
  fx.float(`+${xp} XP`, x, y - 30, '#ffd23f', 26);
  fx.burst(x, y - 20, 'spark', 16);
}

function commitLabEvent(event: 'strategyBuilt' | 'evolution' | 'stressTest', report?: RobustnessReport) {
  const app = useApp.getState();
  const series = lazySeries();
  const now = new Date();
  const res = app.commitSession({
    summary: { id: `lab-${now.getTime()}`, t: now.getTime(), mode: 'bot', symbol: series?.instrument.symbol ?? 'DEMO', timeframe: series?.timeframe ?? '5m', metrics: emptyMetrics() },
    trades: [], event, report, today: todayLocal(now), localHour: now.getHours(),
  });
  const xp = res.awards.reduce((a, w) => a + w.amount, 0);
  setTimeout(() => celebrateXp(xp), 300);
  if (res.achievements.length) {
    setTimeout(() => { sound.play('achievement'); fx.confetti(80); app.sayText(`${res.achievements[0]!.icon} Achievement: ${res.achievements[0]!.name}!`, 'excited', 85); }, 900);
  }
  const lvl = res.levelUp;
  if (lvl) setTimeout(() => { app.setOverlay({ kind: 'levelUp', level: lvl, then: null }); app.say(coach.onLevelUp(lvl)); }, event === 'stressTest' ? 4200 : 1600);
}

export const useLab = create<LabState>((set, get) => {
  const update = (fn: (d: Draft) => Draft) => {
    const draft = fn(get().draft);
    lsSet('miko.lab.draft', draft);
    set({ draft, test: null, stress: null, panel: get().busy === 'none' ? 'none' : get().panel });
  };

  const prep = (): StrategySpec | null => {
    const series = lazySeries();
    if (!series) { useApp.getState().sayText('Loading market data… one sec! ⏳', 'thinking', 50); return null; }
    if (get().draft.cards.length === 0) { sound.play('error'); useApp.getState().sayText('Add at least one WHEN card so your bot knows when to trade 🃏', 'teaching', 60); return null; }
    const spec = buildSpec(get().draft);
    const errors = validateStrategy(spec);
    if (errors.length) { sound.play('error'); useApp.getState().sayText(errors[0]!, 'worried', 60); return null; }
    return spec;
  };

  return {
    draft: initialDraft(),
    busy: 'none',
    panel: 'none',
    test: null,
    gens: [],
    genTotal: 20,
    evolved: null,
    stress: null,
    error: null,

    loadSpec: (spec, asNew = false) => {
      sound.play('whoosh');
      const draft = draftFromSpec(spec, !asNew);
      lsSet('miko.lab.draft', draft);
      set({ draft, test: null, stress: null, evolved: null, panel: 'none' });
    },
    setName: (name) => update((d) => ({ ...d, name: name.slice(0, 22) || 'My Bot' })),
    setDir: (dir) => { sound.play('tick'); update((d) => ({ ...d, dir })); },
    addCard: (b) => { sound.play('buy'); update((d) => ({ ...d, cards: [...d.cards, cardFromBlock(b)].slice(0, 5) })); },
    removeCard: (id) => { sound.play('whoosh'); update((d) => ({ ...d, cards: d.cards.filter((c) => c.uid !== id) })); },
    setGene: (id, g, v) => update((d) => ({
      ...d,
      cards: d.cards.map((c) => {
        if (c.uid !== id) return c;
        let cond = setAtPointer(c.cond, g.path, v);
        for (const l of g.linked ?? []) cond = setAtPointer(cond, l.path, (l.offset ?? 0) + (l.scale ?? 1) * v);
        return { ...c, cond };
      }),
    })),
    setPreset: (p) => {
      sound.play('tick');
      update((d) => ({ ...d, exitPreset: p, exits: p === 'custom' ? d.exits : structuredClone(EXIT_PRESETS[p].exits) }));
    },
    setCustomExit: ({ stop, rr, trail }) => update((d) => {
      const exits: ExitRules = { ...d.exits };
      if (stop !== undefined) exits.stopLoss = { kind: 'atr', mult: stop, period: 14 };
      if (rr !== undefined) exits.takeProfit = { kind: 'rr', ratio: rr };
      if (trail === null) delete exits.trailing; else if (trail !== undefined) exits.trailing = { kind: 'atr', mult: trail, period: 14 };
      return { ...d, exitPreset: 'custom', exits };
    }),

    runTest: async () => {
      const spec = prep();
      if (!spec || get().busy !== 'none') return;
      sound.play('whoosh');
      set({ busy: 'test', panel: 'test', test: null });
      try {
        const test = await runInWorker({ kind: 'backtest', series: lazySeries()!, spec, range: 'in' });
        set({ test });
        const m = test.metrics;
        if (m.trades === 0) useApp.getState().sayText('No trades fired. Try looser cards or another market 🔍', 'thinking', 55);
        else if (m.netProfit > 0) { sound.play('win'); useApp.getState().sayText(`${m.trades} trades, ${Math.round(m.winRate * 100)}% wins. Now 🧪 STRESS it to see if it's real!`, 'excited', 55); }
        else { sound.play('loss'); useApp.getState().sayText('Not profitable yet. Try 🧬 EVOLVE to tune the sliders!', 'teaching', 55); }
      } catch (e) {
        useApp.getState().sayText(`Oops: ${(e as Error).message}`, 'worried', 70);
      } finally {
        set({ busy: 'none' });
      }
    },

    runEvolve: async () => {
      const spec = prep();
      if (!spec || get().busy !== 'none') return;
      if (!spec.genes?.length) { sound.play('error'); useApp.getState().sayText('These cards have no sliders to evolve. Add a card with numbers!', 'teaching', 60); return; }
      sound.play('reveal');
      const total = 20;
      set({ busy: 'evolve', panel: 'evolve', gens: [], genTotal: total, evolved: null });
      useApp.getState().sayText('Breeding bot babies… survival of the fittest! 🧬', 'excited', 50);
      try {
        const out = await runInWorker({ kind: 'evolve', series: lazySeries()!, spec, generations: total, population: 28, seed: Math.floor(Math.random() * 1e9) }, (p) => {
          if (p.kind === 'generation') { set((s) => ({ gens: [...s.gens, p.gen] })); sound.play('gen', p.gen.generation); }
        });
        set({ evolved: out });
        sound.play('levelUp');
        commitLabEvent('evolution');
        const better = out.inSample.metrics.netProfit > out.before.metrics.netProfit;
        useApp.getState().sayText(better ? 'Evolution found better genes! Check the unseen data too 👀' : 'The original was already pretty tuned 💡', better ? 'proud' : 'thinking', 60);
      } catch (e) {
        useApp.getState().sayText(`Evolution hiccup: ${(e as Error).message}`, 'worried', 70);
      } finally {
        set({ busy: 'none' });
      }
    },

    keepEvolved: () => {
      const ev = get().evolved;
      if (!ev) return;
      sound.play('achievement');
      const draft = { ...draftFromSpec(ev.best), name: get().draft.name, icon: get().draft.icon, id: get().draft.id };
      lsSet('miko.lab.draft', draft);
      set({ draft, evolved: null, panel: 'none', test: null, stress: null });
    },

    runStress: async () => {
      const spec = prep();
      if (!spec || get().busy !== 'none') return;
      sound.play('whoosh');
      set({ busy: 'stress', panel: 'stress', stress: null });
      try {
        const [report] = await Promise.all([
          runInWorker({ kind: 'stress', series: lazySeries()!, spec, seed: Math.floor(Math.random() * 1e9) }),
          new Promise((r) => setTimeout(r, 1400)), // let the gacha build-up breathe
        ]);
        set({ stress: report });
        // Attach report to the saved bot if this draft is in the deck.
        const app = useApp.getState();
        const p = app.profile;
        const idx = p.strategies.findIndex((s) => s.spec.id === spec.id);
        if (idx >= 0) app.saveProfile({ ...p, strategies: p.strategies.map((s, i) => (i === idx ? { ...s, spec, report } : s)) });
        commitLabEvent('stressTest', report);
        setTimeout(() => app.say(coach.onReport(report)), 1500);
      } catch (e) {
        useApp.getState().sayText(`Stress test hiccup: ${(e as Error).message}`, 'worried', 70);
      } finally {
        set({ busy: 'none' });
      }
    },

    save: () => {
      const spec = prep();
      if (!spec) return;
      const app = useApp.getState();
      const p = app.profile;
      const existing = p.strategies.findIndex((s) => s.spec.id === spec.id);
      const isTemplate = STRATEGY_TEMPLATES.some((t) => t.id === spec.id);
      const finalSpec = isTemplate ? { ...spec, id: `bot_${Date.now().toString(36)}` } : spec;
      if (isTemplate) {
        const draft = { ...get().draft, id: finalSpec.id };
        lsSet('miko.lab.draft', draft);
        set({ draft });
      }
      const report = get().stress ?? undefined;
      if (existing >= 0 && !isTemplate) {
        app.saveProfile({ ...p, strategies: p.strategies.map((s, i) => (i === existing ? { ...s, spec: finalSpec, report: report ?? s.report } : s)) });
        sound.play('close');
        app.sayText('Bot updated in your deck 🃏', 'happy', 40);
        return;
      }
      app.saveProfile({ ...p, strategies: [{ spec: finalSpec, createdAt: Date.now(), report }, ...p.strategies].slice(0, 30) });
      sound.play('achievement');
      commitLabEvent('strategyBuilt');
      app.sayText(`${finalSpec.icon ?? '🤖'} ${finalSpec.name} joined your deck!`, 'proud', 55);
    },

    closePanel: () => set({ panel: 'none' }),
  };
});
