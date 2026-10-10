import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BLOCK_CATALOG, describeCondition, splitInOut, STRATEGY_TEMPLATES,
  type BarSeries, type BlockCard, type GeneSpec, type Metrics, type StrategySpec,
} from '@miko/engine';
import { useLab, EXIT_PRESETS, DEPTH_BARS, geneValue, buildSpec, type CardInst, type Dir, type ExitPreset, type LabDepth } from '../../state/lab.ts';
import { usePlay } from '../../state/play.ts';
import { useApp } from '../../state/app.ts';
import { Sheet } from '../../components/Sheet.tsx';
import { Help } from '../../components/Help.tsx';
import { EquityCurve, FitnessChart, FanChart, CompareBars } from '../../components/MiniCharts.tsx';
import { BacktestChart } from './BacktestChart.tsx';
import { GradeReveal } from './GradeReveal.tsx';
import { arrow, compactMoney, num, pct, signedMoney } from '../../lib/format.ts';
import { displaySymbol, emojiFor } from '../../lib/instruments.ts';
import { sound } from '../../lib/sound.ts';
import { DESKTOP, useMedia } from '../../lib/useMedia.ts';

const GROUP_ICON: Record<string, string> = { trend: '📈', momentum: '⚡', volatility: '🎈', candles: '🕯️', time: '⏰' };
const BOT_ICONS = ['🤖', '🦊', '🐉', '🦄', '🐙', '🚀', '🧠', '👾', '🐝', '⚔️'];
const DEPTHS: [LabDepth, string][] = [['short', 'Short'], ['long', 'Long'], ['max', 'Max']];

const nyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const nyShort = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const nyYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit' });

/** "Jul 15 '26" in New York time. */
function nyDate(t: number, withYear = true): string {
  return withYear ? `${nyShort.format(t)} '${nyYear.format(t)}` : nyShort.format(t);
}

/** Distinct New York calendar dates covered by the bars. */
function tradingDays(series: BarSeries): number {
  const days = new Set<string>();
  for (const b of series.bars) days.add(nyDay.format(b.t));
  return days.size;
}

function HistoryRow() {
  const instrument = usePlay((s) => s.instrument);
  const tf = usePlay((s) => s.tf);
  const depth = useLab((s) => s.depth);
  const series = useLab((s) => s.series);
  const demo = useLab((s) => s.seriesDemo);
  const loading = useLab((s) => s.seriesLoading);
  const setDepth = useLab((s) => s.setDepth);
  const ensureSeries = useLab((s) => s.ensureSeries);
  useEffect(() => { void ensureSeries(); }, [ensureSeries, instrument.symbol, tf, depth]);
  const days = useMemo(() => (series ? tradingDays(series) : 0), [series]);

  let text = '📅 Loading history…';
  if (!loading && series && series.bars.length) {
    const n = series.bars.length;
    text = `📅 ${nyDate(series.bars[0]!.t)} → ${nyDate(series.bars[n - 1]!.t)} · ${n.toLocaleString('en-US')} bars · ${days} days`;
    if (n < DEPTH_BARS[depth]) text += ' · all we have';
    if (demo) text += ' · 🧪';
  }
  return (
    <section className="lab-history">
      <span className="lab-history-text num">{text}</span>
      <div className="lab-history-ctrl">
        <div className="seg small" role="radiogroup" aria-label="History depth">
          {DEPTHS.map(([k, lbl]) => (
            <button key={k} role="radio" aria-checked={depth === k} className={`seg-btn ${depth === k ? 'on' : ''}`} title={`${DEPTH_BARS[k].toLocaleString('en-US')} bars`} onClick={() => setDepth(k)}>{lbl}</button>
          ))}
        </div>
        <Help text="TEST and EVOLVE learn on the older 70% of this history. STRESS grades the newest 30%, which the bot never saw. More history means more trades and a fairer grade." />
      </div>
    </section>
  );
}

export function LabScreen() {
  const lab = useLab();
  const instrument = usePlay((s) => s.instrument);
  const tf = usePlay((s) => s.tf);
  const demo = usePlay((s) => s.demo);
  const [deck, setDeck] = useState(false);
  const [adding, setAdding] = useState(false);
  const wide = useMedia(DESKTOP);
  const d = lab.draft;

  return (
    <div className="screen lab-screen">
      <div className="lab-build">
      <div className="lab-scroll scroll">
        <header className="lab-head">
          <div className="lab-title">🤖 Bot Lab</div>
          <span className="badge">{emojiFor(instrument)} {displaySymbol(instrument.symbol)} · {tf}{demo ? ' · 🧪' : ''}</span>
          <button className="deck-btn" onClick={() => { sound.play('shuffle'); setDeck(true); }}>🃏 Deck</button>
        </header>

        <HistoryRow />

        <section className="bot-id">
          <button className="bot-icon" aria-label="Change bot icon" onClick={() => { sound.play('swap'); const i = BOT_ICONS.indexOf(d.icon); useLab.setState({ draft: { ...d, icon: BOT_ICONS[(i + 1) % BOT_ICONS.length]! } }); }}>{d.icon}</button>
          <input className="bot-name" value={d.name} onChange={(e) => lab.setName(e.target.value)} aria-label="Bot name" maxLength={22} />
          <div className="seg small" role="radiogroup" aria-label="Direction">
            {([['long', '▲', 'Long'], ['both', '↕', 'Both'], ['short', '▼', 'Short']] as [Dir, string, string][]).map(([k, ico, lbl]) => (
              <button key={k} className={`seg-btn ${d.dir === k ? 'on' : ''} dir-${k}`} onClick={() => lab.setDir(k)} aria-label={lbl}>{ico} {lbl}</button>
            ))}
          </div>
        </section>

        <section className="lane when">
          <div className="lane-head"><span className="lane-tag">WHEN</span><Help text="Your bot enters when ALL these cards are true. Short side mirrors them automatically." /></div>
          <div className="lane-cards">
            {d.cards.map((c, i) => (
              <div key={c.uid} className="card-wrap">
                {i > 0 && <div className="and-pill">AND</div>}
                <CondCard card={c} />
              </div>
            ))}
            {d.cards.length < 5 && (
              <button className="add-card" onClick={() => setAdding(true)}>
                <span className="add-plus">＋</span><span>Add card</span>
              </button>
            )}
          </div>
        </section>

        <section className="lane exit">
          <div className="lane-head"><span className="lane-tag exit">EXIT</span><Help text="Where the bot takes the loss (stop) and the win (target). Measured in ATR, the market's typical move." /></div>
          <div className="preset-row">
            {(Object.keys(EXIT_PRESETS) as Exclude<ExitPreset, 'custom'>[]).map((k) => (
              <button key={k} className={`preset ${d.exitPreset === k ? 'on' : ''}`} onClick={() => lab.setPreset(k)}>
                <span className="preset-ico">{EXIT_PRESETS[k].icon}</span><span>{EXIT_PRESETS[k].label}</span>
              </button>
            ))}
            <button className={`preset ${d.exitPreset === 'custom' ? 'on' : ''}`} onClick={() => lab.setPreset('custom')}>
              <span className="preset-ico">🎛️</span><span>Custom</span>
            </button>
          </div>
          {d.exitPreset === 'custom' && <CustomExit />}
        </section>

        {!wide && <ResultsPanel />}
        <div className="lab-spacer" />
      </div>

      <div className="lab-actions" data-fx="lab-actions">
        <button className="act test" onClick={() => void lab.runTest()} disabled={lab.busy !== 'none'}>
          <span className="act-ico">▶</span><span>TEST</span>
        </button>
        <button className="act evolve" onClick={() => void lab.runEvolve()} disabled={lab.busy !== 'none'}>
          <span className="act-ico">🧬</span><span>EVOLVE</span>
        </button>
        <button className="act stress" onClick={() => void lab.runStress()} disabled={lab.busy !== 'none'}>
          <span className="act-ico">🧪</span><span>STRESS</span>
        </button>
      </div>
      </div>
      {wide && (
        <aside className="lab-side scroll">
          {lab.panel === 'none' ? <LabEmpty /> : <ResultsPanel />}
        </aside>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="🃏 Add a WHEN card">
        <BlockPicker onPick={(b) => { lab.addCard(b); setAdding(false); }} />
      </Sheet>
      <Sheet open={deck} onClose={() => setDeck(false)} title="🃏 Your deck">
        <Deck onPick={() => setDeck(false)} />
      </Sheet>
    </div>
  );
}

function CondCard({ card }: { card: CardInst }) {
  const setGene = useLab((s) => s.setGene);
  const remove = useLab((s) => s.removeCard);
  const genes = card.genes.slice(0, 2);
  return (
    <div className="cond-card">
      <div className="cond-top">
        <span className="cond-ico">{card.icon}</span>
        <div className="cond-text">
          <span className="cond-label">{card.label}</span>
          <span className="cond-desc">{describeCondition(card.cond)}</span>
        </div>
        <button className="cond-x" aria-label="Remove card" onClick={() => remove(card.uid)}>✕</button>
      </div>
      {genes.map((g) => <GeneSlider key={g.path} card={card} g={g} onChange={(v) => setGene(card.uid, g, v)} />)}
    </div>
  );
}

function GeneSlider({ card, g, onChange }: { card: CardInst; g: GeneSpec; onChange: (v: number) => void }) {
  const v = geneValue(card, g);
  const step = g.step ?? (g.int ? 1 : (g.max - g.min) / 40);
  return (
    <label className="gene">
      <span className="gene-lbl">{g.label}</span>
      <input type="range" min={g.min} max={g.max} step={step} value={v} onChange={(e) => { sound.play('slide', (Number(e.target.value) - g.min) / (g.max - g.min || 1)); onChange(Number(e.target.value)); }}
        style={{ ['--p' as string]: `${((v - g.min) / (g.max - g.min || 1)) * 100}%` }} />
      <span className="gene-val num">{g.int ? Math.round(v) : num(v, step < 0.1 ? 2 : 1)}</span>
    </label>
  );
}

function CustomExit() {
  const exits = useLab((s) => s.draft.exits);
  const set = useLab((s) => s.setCustomExit);
  const stop = exits.stopLoss?.kind === 'atr' ? exits.stopLoss.mult : 2;
  const rr = exits.takeProfit?.kind === 'rr' ? exits.takeProfit.ratio : 2;
  const trail = exits.trailing?.kind === 'atr' ? exits.trailing.mult : null;
  const slider = (label: string, value: number, min: number, max: number, step: number, fn: (v: number) => void, suffix: string) => (
    <label className="gene">
      <span className="gene-lbl">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => { sound.play('slide', (Number(e.target.value) - min) / (max - min)); fn(Number(e.target.value)); }} style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }} />
      <span className="gene-val num">{num(value, 2).replace(/\.?0+$/, '')}{suffix}</span>
    </label>
  );
  return (
    <div className="cond-card custom-exit">
      {slider('🛡️ Stop', stop, 0.5, 5, 0.25, (v) => set({ stop: v }), ' ATR')}
      {slider('🎯 Target', rr, 0.5, 6, 0.25, (v) => set({ rr: v }), 'R')}
      <div className="gene">
        <span className="gene-lbl">🪢 Trail</span>
        <button className={`mini-toggle ${trail !== null ? 'on' : ''}`} onClick={() => { sound.play(trail === null ? 'toggleOn' : 'toggleOff'); set({ trail: trail === null ? 3 : null }); }}>{trail !== null ? 'ON' : 'OFF'}</button>
        {trail !== null && <input type="range" min={1} max={6} step={0.25} value={trail} onChange={(e) => { sound.play('slide', (Number(e.target.value) - 1) / 5); set({ trail: Number(e.target.value) }); }} style={{ ['--p' as string]: `${((trail - 1) / 5) * 100}%` }} />}
      </div>
    </div>
  );
}

function BlockPicker({ onPick }: { onPick: (b: BlockCard) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, BlockCard[]>();
    for (const b of BLOCK_CATALOG) { const arr = m.get(b.group) ?? []; arr.push(b); m.set(b.group, arr); }
    return [...m.entries()];
  }, []);
  return (
    <div className="block-picker">
      {groups.map(([g, cards]) => (
        <div key={g} className="block-group">
          <div className="block-group-title">{GROUP_ICON[g] ?? '🧩'} {g}</div>
          <div className="block-grid">
            {cards.map((b) => (
              <button key={b.id} className={`block-card g-${b.group}`} onClick={() => onPick(b)} title={b.blurb}>
                <span className="block-ico">{b.icon}</span>
                <span className="block-label">{b.label}</span>
                <span className="block-blurb">{b.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Deck({ onPick }: { onPick: () => void }) {
  const strategies = useApp((s) => s.profile.strategies);
  const loadSpec = useLab((s) => s.loadSpec);
  const sendBot = usePlay((s) => s.sendBot);
  const setTab = useApp((s) => s.setTab);
  const pick = (spec: StrategySpec, asNew: boolean) => { loadSpec(spec, asNew); onPick(); };
  return (
    <div className="deck">
      {strategies.length > 0 && (
        <>
          <div className="deck-title">⭐ My bots</div>
          <div className="deck-grid">
            {strategies.map((s) => (
              <div key={s.spec.id} className={`collect-card mine grade-${s.report?.grade ?? 'none'}`}>
                <button className="collect-main" onClick={() => pick(s.spec, false)}>
                  <span className="collect-ico">{s.spec.icon ?? '🤖'}</span>
                  <span className="collect-name">{s.spec.name}</span>
                  {s.report && <span className="collect-grade">{s.report.grade}</span>}
                </button>
                <button className="collect-play" onClick={() => { sound.play('roundStart'); sendBot(s.spec); setTab('play'); onPick(); useApp.getState().sayText(`${s.spec.icon ?? '🤖'} ${s.spec.name} will trade next to you. Race it!`, 'excited', 60); }}>▶ Play</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="deck-title">🎴 Starter cards</div>
      <div className="deck-grid">
        {STRATEGY_TEMPLATES.map((t, i) => (
          <button key={t.id} className="collect-card template" style={{ animationDelay: `${i * 50}ms` }} onClick={() => pick(t, false)}>
            <span className="collect-ico">{t.icon ?? '🤖'}</span>
            <span className="collect-name">{t.name}</span>
            <span className="collect-rarity">{'★'.repeat(1 + (i % 3))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricChips({ m }: { m: Metrics }) {
  return (
    <div className="metric-chips">
      <span className={`mchip ${m.netProfit >= 0 ? 'up' : 'down'}`}><b className="num"><small className="mchip-arrow">{arrow(m.netProfit)}</small>{compactMoney(m.netProfit)}</b><small>Profit</small></span>
      <span className="mchip"><b className="num">{Math.round(m.winRate * 100)}%</b><small>Wins</small></span>
      <span className="mchip"><b className="num">{m.trades}</b><small>Trades</small></span>
      <span className="mchip"><b className="num">{m.profitFactor === Infinity || m.profitFactor === null ? '∞' : num(m.profitFactor, 2)}</b><small>PF</small></span>
      <span className="mchip"><b className="num">{pct(m.maxDrawdownPct, 0)}</b><small>Max dip</small></span>
    </div>
  );
}

function ResultsPanel() {
  const lab = useLab();
  const series = lab.series;
  const sendBot = usePlay((s) => s.sendBot);
  const setTab = useApp((s) => s.setTab);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (lab.panel !== 'none') requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [lab.panel, lab.test, lab.stress, lab.evolved]);
  if (lab.panel === 'none') return null;

  const sendToPlay = () => {
    const spec = buildSpec(lab.draft);
    sound.play('roundStart');
    sendBot(spec);
    setTab('play');
    useApp.getState().sayText(`${spec.icon ?? '🤖'} ${spec.name} joins your round. Race it!`, 'excited', 60);
  };

  return (
    <section ref={ref} className={`result-panel panel-${lab.panel}`}>
      <button className="panel-x" onClick={() => { sound.play('dismiss'); lab.closePanel(); }} aria-label="Close results">✕</button>
      {lab.panel === 'test' && (
        lab.test && series ? (
          <>
            <div className="rp-title">▶ Test run <Help text={trainedText(series)} /></div>
            <EquityCurve values={lab.test.equity.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 300)) === 0).map((e) => e.equity)} base={lab.test.initialCash} />
            <MetricChips m={lab.test.metrics} />
            <BacktestChart series={series} result={lab.test} />
            <div className="rp-actions">
              <button className="ghost-btn" onClick={() => lab.save()}>💾 Save</button>
              <button className="ghost-btn" onClick={sendToPlay}>▶ Race it</button>
            </div>
          </>
        ) : <Busy label="Running the bot through history…" />
      )}

      {lab.panel === 'evolve' && <EvolvePanel />}

      {lab.panel === 'stress' && (
        lab.stress ? (
          <>
            <GradeReveal report={lab.stress} />
            <div className="rp-sub">🎲 1000 random replays</div>
            <FanChart curves={lab.stress.monteCarlo.sampleCurves} base={lab.stress.monteCarlo.sampleCurves[0]?.[0] ?? 10_000} />
            <div className="mc-stats">
              <span className="mchip up"><b className="num">{Math.round(lab.stress.monteCarlo.probabilityOfProfit * 100)}%</b><small>Profit chance</small></span>
              <span className="mchip"><b className="num">{pct(lab.stress.monteCarlo.maxDrawdownPct.p50, 0)}</b><small>Typical dip</small></span>
              <span className={`mchip ${lab.stress.monteCarlo.riskOfRuin > 0.05 ? 'down' : ''}`}><b className="num">{Math.round(lab.stress.monteCarlo.riskOfRuin * 100)}%</b><small>Ruin risk</small></span>
            </div>
            <div className="rp-sub">📚 Training vs 🆕 unseen data <Help text="A real edge keeps working on data the bot never saw. Big drop = overfitting." /></div>
            <CompareBars a={lab.stress.inSample.netProfitPct} b={lab.stress.outOfSample.netProfitPct} format={(v) => pct(v, 1, true)} />
            <div className="rp-actions">
              <button className="ghost-btn" onClick={() => lab.save()}>💾 Save</button>
              <button className="ghost-btn" onClick={sendToPlay}>▶ Race it</button>
            </div>
          </>
        ) : <GachaCharge />
      )}
    </section>
  );
}

function trainedText(series: BarSeries): string {
  const [a, b] = splitInOut(series, 0.3).inSample;
  const from = series.bars[a];
  const to = series.bars[b];
  if (!from || !to) return 'Tested on the older 70% of the data (training part). STRESS checks the unseen 30%.';
  return `Trained on ${nyDate(from.t, false)} → ${nyDate(to.t, false)} (the older 70%). STRESS checks the unseen 30%.`;
}

function EvolvePanel() {
  const gens = useLab((s) => s.gens);
  const total = useLab((s) => s.genTotal);
  const ev = useLab((s) => s.evolved);
  const keep = useLab((s) => s.keepEvolved);
  const close = useLab((s) => s.closePanel);
  const best = gens.map((g) => g.best);
  const mean = gens.map((g) => g.mean);
  const cur = gens.length;
  return (
    <>
      <div className="rp-title">🧬 Evolution <span className="gen-count num">Gen {cur}/{total}</span></div>
      {!ev && <Dna progress={cur / total} />}
      <FitnessChart best={best} mean={mean} total={total} />
      {ev && (
        <div className="before-after">
          <div className="ba-card before">
            <div className="ba-tag">Before</div>
            <b className={`num ${ev.before.metrics.netProfit >= 0 ? 'up-text' : 'down-text'}`}>{signedMoney(ev.before.metrics.netProfit)}</b>
            <small>{Math.round(ev.before.metrics.winRate * 100)}% wins · {ev.before.metrics.trades} trades</small>
          </div>
          <div className="ba-arrow">➜</div>
          <div className="ba-card after">
            <div className="ba-tag">After ✨</div>
            <b className={`num ${ev.inSample.metrics.netProfit >= 0 ? 'up-text' : 'down-text'}`}>{signedMoney(ev.inSample.metrics.netProfit)}</b>
            <small>{Math.round(ev.inSample.metrics.winRate * 100)}% wins · {ev.inSample.metrics.trades} trades</small>
          </div>
          <div className="ba-oos">🆕 Unseen data: <b className={`num ${ev.outOfSample.metrics.netProfit >= 0 ? 'up-text' : 'down-text'}`}>{signedMoney(ev.outOfSample.metrics.netProfit)}</b></div>
          <div className="rp-actions">
            <button className="cta small" onClick={keep}>✅ Keep genes</button>
            <button className="ghost-btn" onClick={() => { sound.play('cardRemove'); close(); }}>↩︎ Discard</button>
          </div>
        </div>
      )}
    </>
  );
}

function Dna({ progress }: { progress: number }) {
  const n = 18;
  return (
    <div className="dna" aria-label={`Evolving ${Math.round(progress * 100)}%`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`dna-rung ${i / n <= progress ? 'lit' : ''}`} style={{ animationDelay: `${-i * 0.12}s` }}>
          <i className="dna-a" /><i className="dna-b" />
        </span>
      ))}
    </div>
  );
}

function LabEmpty() {
  const run = useLab();
  return (
    <div className="lab-empty">
      <div className="lab-empty-title">Pick a move</div>
      <button className="lab-empty-card test" onClick={() => void run.runTest()}><span>▶</span><b>TEST</b><small>History run</small></button>
      <button className="lab-empty-card evolve" onClick={() => void run.runEvolve()}><span>🧬</span><b>EVOLVE</b><small>Auto-tune genes</small></button>
      <button className="lab-empty-card stress" onClick={() => void run.runStress()}><span>🧪</span><b>STRESS</b><small>Grade S → D</small></button>
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return <div className="busy"><span className="loader-candles"><i /><i /><i /><i /></span><span>{label}</span></div>;
}

function GachaCharge() {
  return (
    <div className="gacha-charge">
      <div className="gacha-card-back"><span>?</span></div>
      <div className="gacha-label">Shuffling 1000 futures…</div>
    </div>
  );
}
