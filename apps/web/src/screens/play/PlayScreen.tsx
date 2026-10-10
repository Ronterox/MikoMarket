import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listIndicators, type IndicatorMeta, type Instrument, type Timeframe } from '@miko/engine';
import { Hud } from '../../components/Hud.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Help } from '../../components/Help.tsx';
import { PlayChart } from './PlayChart.tsx';
import { mainColor, palVar } from '../../lib/indStyle.ts';
import { PositionCard } from './PositionCard.tsx';
import { IndicatorPopover } from './IndicatorPopover.tsx';
import { SPEED_MS, usePlay, type RiskPct, type Speed } from '../../state/play.ts';
import { useApp } from '../../state/app.ts';
import { displaySymbol, emojiFor, TIMEFRAMES } from '../../lib/instruments.ts';
import { sound } from '../../lib/sound.ts';

/** Heikin-Ashi is a candle style (the 🕯️/HA switch), not a line indicator. */
const HIDDEN = new Set(['ha']);
const SPEEDS: { sp: Speed; label: string; name: string }[] = [
  { sp: 0, label: '⏸', name: 'Pause' }, { sp: 1, label: '🐢', name: 'Slow' }, { sp: 2, label: '▶', name: 'Normal' },
  { sp: 3, label: '▶▶', name: 'Fast' }, { sp: 4, label: '▶▶▶', name: 'Turbo' },
];

const nyDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: '2-digit' });
const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const CLOCKS = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'];
const HALF = ['🕧', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦'];
/** "Sep 24 '26" + "🕛 12:00 NY" for the bar's open time in New York. */
function nyClock(t: number) {
  const parts = nyParts.formatToParts(new Date(t));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const face = (m >= 15 && m < 45 ? HALF : CLOCKS)[(m >= 45 ? h + 1 : h) % 12]!;
  return { date: nyDate.format(new Date(t)).replace(/, (\d\d)$/, " '$1"), time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, face };
}

export function PlayScreen() {
  const s = usePlay();
  const [picker, setPicker] = useState(false);
  const [gear, setGear] = useState(false);
  const [moreInd, setMoreInd] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pop, setPop] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const timer = useRef(0);
  const press = useRef<{ t: number; fired: boolean }>({ t: 0, fired: false });
  const setStage = useApp((a) => a.setMikoStage);
  const stageRef = useCallback((el: HTMLDivElement | null) => setStage(el), [setStage]);
  const closePop = useCallback(() => setPop(null), []);

  useEffect(() => { void usePlay.getState().init(); }, []);

  // Replay clock: drives session.step() at the chosen speed.
  useEffect(() => {
    window.clearInterval(timer.current);
    if (s.speed === 0 || !s.session) return;
    timer.current = window.setInterval(() => usePlay.getState().step(), SPEED_MS[s.speed]);
    return () => window.clearInterval(timer.current);
  }, [s.speed, s.session]);

  const allInd = useMemo(() => listIndicators().filter((m) => !HIDDEN.has(m.id)), []);
  const row = useMemo(() => s.chipRow.map((id) => allInd.find((m) => m.id === id)).filter((m): m is IndicatorMeta => !!m), [allInd, s.chipRow]);
  useEffect(() => { if (row.length === 0) setEditing(false); }, [row.length]);
  // Long-press can start edit mode anywhere in the row: keep the ✓ (done) button in view.
  useEffect(() => {
    if (!editing) return;
    const id = window.setTimeout(() => document.querySelector('.chip.more.edit')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }), 60);
    return () => window.clearTimeout(id);
  }, [editing]);

  // Long-press a chip to enter edit mode (like a phone home screen).
  const pressStart = () => {
    window.clearTimeout(press.current.t);
    press.current.fired = false;
    press.current.t = window.setTimeout(() => {
      press.current.fired = true;
      sound.play('pickup');
      try { navigator.vibrate?.(12); } catch { /* not supported */ }
      setEditing(true);
    }, 480);
  };
  const pressEnd = () => window.clearTimeout(press.current.t);
  const onChip = (m: IndicatorMeta, el: HTMLElement) => {
    if (press.current.fired) { press.current.fired = false; return; }
    if (editing) return;
    // Active chip → its settings bubble. Inactive chip → draw it.
    if (s.indicators.includes(m.id)) setPop({ id: m.id, anchor: el });
    else s.toggleIndicator(m.id);
  };

  const session = s.session;
  const pos = session?.state.position;
  const barTime = session ? session.series.bars[session.index]?.t : undefined;
  const barsLeft = session ? session.endIndex - session.index : 0;
  const intraday = s.tf !== '1d' && s.tf !== '1w';
  const clock = barTime !== undefined ? nyClock(barTime) : null;

  return (
    <div className="screen play-screen">
      <div className="play-main">
        <div className="market-bar">
          <button className="market-btn" onClick={() => setPicker(true)} aria-label="Change market">
            <span className="market-emoji">{emojiFor(s.instrument)}</span>
            <span className="market-sym">{displaySymbol(s.instrument.symbol)}</span>
            <span className="market-tf">{s.tf}</span>
            <span className="market-caret">▾</span>
          </button>
          <div className="market-meta">
            {s.demo && <span className="badge demo" title="Server unreachable: synthetic demo data">🧪 Demo data</span>}
            {s.mystery ? <span className="badge mystery">🎭 ???</span> : clock && (
              <span className="badge date" title="Bar time in New York">
                {intraday && <b className="ny-clock num"><span aria-hidden>{clock.face}</span> {clock.time} <small>NY</small></b>}
                <span className="ny-date">{clock.date}</span>
              </span>
            )}
            {s.botSpec && <button className="badge bot" onClick={() => { sound.play('tap'); s.clearBot(); }} title="Remove bot">🤖 {s.botSpec.icon ?? ''} ✕</button>}
          </div>
          <button className="icon-btn" aria-label="Round settings" onClick={() => setGear(true)}>⚙️</button>
        </div>

        <div className="chart-zone">
          {session && !s.loading ? (
            <PlayChart
              session={session} botSession={s.botSession} version={s.version} round={s.round}
              speedMs={SPEED_MS[s.speed]} indicators={s.indicators} indParams={s.indParams} indStyle={s.indStyle} candleMode={s.candleMode}
              mystery={s.mystery} onBracket={s.moveBracket} onRemoveStop={s.removeStop}
            />
          ) : (
            <div className="chart-loading"><span className="loader-candles"><i /><i /><i /><i /></span><span>Loading market…</span></div>
          )}
          {session && !s.live && s.speed === 0 && session.index === session.startIndex && !s.loading && (
            <button className="start-hint" onClick={() => s.setSpeed(s.lastSpeed)}>{SPEEDS[s.lastSpeed]!.label} Tap to start</button>
          )}
          <div className="chart-tl">
            <div className={`bars-left num ${s.live ? 'live' : ''}`} title={s.live ? 'Live market' : 'Bars left in this round'}>{s.live ? `📡 ${s.liveStatus === 'live' ? 'LIVE' : s.liveStatus}` : `⏳ ${barsLeft}`}</div>
            <div className="candle-switch" role="radiogroup" aria-label="Candle style">
              <button role="radio" aria-checked={s.candleMode === 'candles'} className={s.candleMode === 'candles' ? 'on' : ''} onClick={() => s.setCandleMode('candles')} title="Regular candles (real prices)">🕯️</button>
              <button role="radio" aria-checked={s.candleMode === 'ha'} className={s.candleMode === 'ha' ? 'on' : ''} onClick={() => s.setCandleMode('ha')} title="Heikin-Ashi: smoothed candles, display only">HA</button>
            </div>
          </div>
          <div ref={stageRef} className="miko-stage" />
        </div>

      </div>
      <aside className="play-side">
        <Hud />

        <div className={`chip-row ${editing ? 'editing' : ''}`} role="toolbar" aria-label="Indicators">
          {row.map((m, i) => {
            const slot = s.indicators.indexOf(m.id);
            const on = slot >= 0;
            return (
              <span key={m.id} className="chip-wrap" style={{ ['--i' as string]: i }}>
                <button
                  className={`chip ${on ? 'on' : ''}`} style={on ? { ['--chip-c' as string]: palVar(mainColor(m, slot, s.indStyle[m.id])) } : undefined}
                  onClick={(e) => onChip(m, e.currentTarget)} onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  title={on ? `${m.name}: tap for settings` : `${m.blurb}`} aria-pressed={on}
                >
                  {on && <i className="chip-dot" aria-hidden />}<span>{m.icon}</span>{m.name.length > 8 ? m.id.toUpperCase() : m.name}
                  {on && !editing && <span className="chip-gear" aria-hidden>⚙</span>}
                </button>
                {editing && <button className="chip-x" onClick={() => s.removeChip(m.id)} aria-label={`Remove ${m.name} from the row`}>✕</button>}
              </span>
            );
          })}
          {!editing && <button className="chip more" onClick={() => setMoreInd(true)} aria-label="Add indicators">＋</button>}
          {row.length > 0 && (
            <button className={`chip more edit ${editing ? 'on' : ''}`} onClick={() => { sound.play(editing ? 'drop' : 'tap'); setEditing((e) => !e); }} aria-label={editing ? 'Done editing' : 'Edit indicator row'}>
              {editing ? '✓' : '✎'}
            </button>
          )}
        </div>

        {session && <PositionCard session={session} botSession={s.botSession} />}

        <div className="control-row">
          {s.live ? <button className="step-btn" onClick={() => { sound.play('tap'); s.stopLive(); }}>🎮 Replay</button> : <div className="speed-ctl" role="radiogroup" aria-label="Replay speed">
            {SPEEDS.map(({ sp, label, name }) => (
              <button key={sp} role="radio" aria-checked={s.speed === sp} aria-label={name} title={name} className={`speed ${sp === 1 ? 'slow' : ''} ${s.speed === sp ? 'on' : ''}`} onClick={() => s.setSpeed(sp)}>
                {label}
              </button>
            ))}
          </div>}
          {s.speed === 0 && !s.live && <button className="step-btn" onClick={() => { sound.play('tap'); s.step(); }} aria-label="Next bar">+1</button>}
          <button className="finish-btn" onClick={() => { sound.play('tap'); s.finish(); }} disabled={!session || s.finishing}>🏁 Finish</button>
        </div>

        <div className="trade-row">
          <button className="bigbtn buy" onClick={(e) => s.trade('buy', e.currentTarget)} disabled={!session || (session.done && !s.live)}>
            <span className="bigbtn-ico">▲</span><span>BUY</span>
          </button>
          <button className="bigbtn close" onClick={(e) => s.close(e.currentTarget)} disabled={!pos && !(session?.state.workingOrders.length)}>
            <span className="bigbtn-ico">✕</span><span>CLOSE</span>
          </button>
          <button className="bigbtn sell" onClick={(e) => s.trade('sell', e.currentTarget)} disabled={!session || (session.done && !s.live)}>
            <span className="bigbtn-ico">▼</span><span>SELL</span>
          </button>
        </div>

        <div className="miko-slot" aria-hidden="true" />
      </aside>

      <MarketPicker open={picker} onClose={() => setPicker(false)} />

      <Sheet open={gear} onClose={() => setGear(false)} title="⚙️ Round">
        <div className="sheet-section">
          <div className="sheet-label">Risk per trade <Help text="How much you lose if the stop is hit. 1% is a pro habit." /></div>
          <div className="seg">
            {([0.5, 1, 2] as RiskPct[]).map((r) => (
              <button key={r} className={`seg-btn ${s.riskPct === r ? 'on' : ''}`} onClick={() => s.setRisk(r)}>{r === 0.5 ? '½' : r}%</button>
            ))}
          </div>
        </div>
        <div className="sheet-section">
          <div className="sheet-label">Mystery date <Help text="Hides the date so you can't remember what happened next." /></div>
          <div className="seg">
            <button className={`seg-btn ${!s.mystery ? 'on' : ''}`} onClick={() => { sound.play('select'); s.setMystery(false); }}>📅 Show</button>
            <button className={`seg-btn ${s.mystery ? 'on' : ''}`} onClick={() => { sound.play('select'); s.setMystery(true); }}>🎭 Hide</button>
          </div>
        </div>
        <button className="wide-btn" onClick={() => { sound.play('whoosh'); setGear(false); s.newRound(); }}>🎲 New random round</button>
        {!s.demo && !s.live && <button className="wide-btn live" onClick={() => { setGear(false); s.goLive(); }}>📡 Trade it live</button>}
      </Sheet>

      <Sheet open={moreInd} onClose={() => setMoreInd(false)} title="📈 Indicators">
        <div className="ind-legend"><span><i className="lg-dot on" /> on chart</span><span><i className="lg-dot row" /> in your row</span></div>
        <div className="ind-grid">
          {allInd.map((m) => {
            const on = s.indicators.includes(m.id);
            const inRow = s.chipRow.includes(m.id);
            return (
              <button key={m.id} className={`ind-card ${on ? 'on' : ''} ${inRow ? 'in-row' : ''}`} onClick={() => (inRow ? s.toggleIndicator(m.id) : s.addChip(m.id))}>
                <span className="ind-ico">{m.icon}</span>
                <span className="ind-name">{m.name}{inRow && <span className="ind-badge">{on ? '● on' : '✓ row'}</span>}</span>
                <span className="ind-blurb">{m.blurb}</span>
              </button>
            );
          })}
        </div>
      </Sheet>

      {pop && <IndicatorPopover id={pop.id} anchor={pop.anchor} onClose={closePop} />}
    </div>
  );
}

function MarketPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const instruments = usePlay((s) => s.instruments);
  const cur = usePlay((s) => s.instrument);
  const tf = usePlay((s) => s.tf);
  const setMarket = usePlay((s) => s.setMarket);
  const [selTf, setSelTf] = useState<Timeframe>(tf);
  useEffect(() => { if (open) setSelTf(tf); }, [open, tf]);
  const pick = (inst: Instrument) => {
    sound.play('select');
    onClose();
    void setMarket(inst, selTf);
    useApp.getState().sayText(`${emojiFor(inst)} ${displaySymbol(inst.symbol)} it is! Press ▶ when ready.`, 'excited', 35);
  };
  return (
    <Sheet open={open} onClose={onClose} title="🌍 Pick a market">
      <div className="seg tf-row">
        {TIMEFRAMES.map((t) => (
          <button key={t} className={`seg-btn ${selTf === t ? 'on' : ''}`} onClick={() => { sound.play('select'); setSelTf(t); }}>{t}</button>
        ))}
      </div>
      <div className="market-grid">
        {instruments.map((inst) => (
          <button key={inst.symbol} className={`market-card ${inst.symbol === cur.symbol ? 'on' : ''}`} onClick={() => pick(inst)}>
            <span className="mc-emoji">{emojiFor(inst)}</span>
            <span className="mc-sym">{displaySymbol(inst.symbol)}</span>
            <span className="mc-name">{inst.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
