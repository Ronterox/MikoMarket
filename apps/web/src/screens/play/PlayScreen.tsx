import { useEffect, useMemo, useRef, useState } from 'react';
import { listIndicators, type Instrument, type Timeframe } from '@miko/engine';
import { Hud } from '../../components/Hud.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Help } from '../../components/Help.tsx';
import { PlayChart, SLOT_COLORS } from './PlayChart.tsx';
import { PositionCard } from './PositionCard.tsx';
import { SPEED_MS, usePlay, type RiskPct, type Speed } from '../../state/play.ts';
import { useApp } from '../../state/app.ts';
import { displaySymbol, emojiFor, TIMEFRAMES } from '../../lib/instruments.ts';
import { dateFmt } from '../../lib/format.ts';
import { sound } from '../../lib/sound.ts';

const FAVORITES = ['ema', 'sma', 'bb', 'vwap', 'supertrend', 'rsi', 'macd', 'donchian'];
const HIDDEN = new Set(['ha']);

export function PlayScreen() {
  const s = usePlay();
  const [picker, setPicker] = useState(false);
  const [gear, setGear] = useState(false);
  const [moreInd, setMoreInd] = useState(false);
  const timer = useRef(0);

  useEffect(() => { void usePlay.getState().init(); }, []);

  // Replay clock: drives session.step() at the chosen speed.
  useEffect(() => {
    window.clearInterval(timer.current);
    if (s.speed === 0 || !s.session) return;
    timer.current = window.setInterval(() => usePlay.getState().step(), SPEED_MS[s.speed]);
    return () => window.clearInterval(timer.current);
  }, [s.speed, s.session]);

  const allInd = useMemo(() => listIndicators().filter((m) => !HIDDEN.has(m.id)), []);
  const favs = useMemo(() => {
    const list = FAVORITES.map((id) => allInd.find((m) => m.id === id)).filter((m) => !!m);
    for (const id of s.indicators) if (!list.some((m) => m.id === id)) { const m = allInd.find((x) => x.id === id); if (m) list.unshift(m); }
    return list;
  }, [allInd, s.indicators]);

  const session = s.session;
  const pos = session?.state.position;
  const barTime = session ? session.series.bars[session.index]?.t : undefined;
  const barsLeft = session ? session.endIndex - session.index : 0;

  return (
    <div className="screen play-screen">
      <Hud />

      <div className="market-bar">
        <button className="market-btn" onClick={() => { sound.play('tick'); setPicker(true); }} aria-label="Change market">
          <span className="market-emoji">{emojiFor(s.instrument)}</span>
          <span className="market-sym">{displaySymbol(s.instrument.symbol)}</span>
          <span className="market-tf">{s.tf}</span>
          <span className="market-caret">▾</span>
        </button>
        <div className="market-meta">
          {s.demo && <span className="badge demo" title="Server unreachable: synthetic demo data">🧪 Demo data</span>}
          {s.mystery ? <span className="badge mystery">🎭 ???</span> : barTime !== undefined && <span className="badge date">{dateFmt(barTime, s.tf !== '1d' && s.tf !== '1w')}</span>}
          {s.botSpec && <button className="badge bot" onClick={() => s.clearBot()} title="Remove bot">🤖 {s.botSpec.icon ?? ''} ✕</button>}
        </div>
        <button className="icon-btn" aria-label="Round settings" onClick={() => { sound.play('tick'); setGear(true); }}>⚙️</button>
      </div>

      <div className="chart-zone">
        {session && !s.loading ? (
          <PlayChart
            session={session} botSession={s.botSession} version={s.version} round={s.round}
            speedMs={SPEED_MS[s.speed]} indicators={s.indicators} mystery={s.mystery} onBracket={s.moveBracket}
          />
        ) : (
          <div className="chart-loading"><span className="loader-candles"><i /><i /><i /><i /></span><span>Loading market…</span></div>
        )}
        {session && !s.live && s.speed === 0 && session.index === session.startIndex && !s.loading && (
          <button className="start-hint" onClick={() => s.setSpeed(1)}>▶ Tap to start</button>
        )}
        <div className={`bars-left num ${s.live ? 'live' : ''}`} title={s.live ? 'Live market' : 'Bars left in this round'}>{s.live ? `📡 ${s.liveStatus === 'live' ? 'LIVE' : s.liveStatus}` : `⏳ ${barsLeft}`}</div>
      </div>

      <div className="chip-row" role="toolbar" aria-label="Indicators">
        {favs.map((m) => {
          const slot = s.indicators.indexOf(m.id);
          return (
            <button key={m.id} className={`chip ${slot >= 0 ? 'on' : ''}`} style={slot >= 0 ? { ['--chip-c' as string]: SLOT_COLORS[slot % 2]![0] } : undefined} onClick={() => s.toggleIndicator(m.id)} title={m.blurb}>
              <span>{m.icon}</span>{m.name.length > 8 ? m.id.toUpperCase() : m.name}
            </button>
          );
        })}
        <button className="chip more" onClick={() => setMoreInd(true)} aria-label="All indicators">＋</button>
      </div>

      {session && <PositionCard session={session} botSession={s.botSession} />}

      <div className="control-row">
        {s.live ? <button className="step-btn" onClick={() => s.stopLive()}>🎮 Replay</button> : <div className="speed-ctl" role="radiogroup" aria-label="Replay speed">
          {([0, 1, 2, 3] as Speed[]).map((sp) => (
            <button key={sp} role="radio" aria-checked={s.speed === sp} className={`speed ${s.speed === sp ? 'on' : ''}`} onClick={() => s.setSpeed(sp)}>
              {sp === 0 ? '⏸' : '▶'.repeat(sp)}
            </button>
          ))}
        </div>}
        {s.speed === 0 && !s.live && <button className="step-btn" onClick={() => { sound.play('tick'); s.step(); }} aria-label="Next bar">+1</button>}
        <button className="finish-btn" onClick={() => s.finish()} disabled={!session || s.finishing}>🏁 Finish</button>
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
            <button className={`seg-btn ${!s.mystery ? 'on' : ''}`} onClick={() => s.setMystery(false)}>📅 Show</button>
            <button className={`seg-btn ${s.mystery ? 'on' : ''}`} onClick={() => s.setMystery(true)}>🎭 Hide</button>
          </div>
        </div>
        <button className="wide-btn" onClick={() => { setGear(false); s.newRound(); }}>🎲 New random round</button>
        {!s.demo && !s.live && <button className="wide-btn live" onClick={() => { setGear(false); s.goLive(); }}>📡 Trade it live</button>}
      </Sheet>

      <Sheet open={moreInd} onClose={() => setMoreInd(false)} title="📈 Indicators">
        <div className="ind-grid">
          {allInd.map((m) => {
            const on = s.indicators.includes(m.id);
            return (
              <button key={m.id} className={`ind-card ${on ? 'on' : ''}`} onClick={() => s.toggleIndicator(m.id)}>
                <span className="ind-ico">{m.icon}</span>
                <span className="ind-name">{m.name}</span>
                <span className="ind-blurb">{m.blurb}</span>
              </button>
            );
          })}
        </div>
      </Sheet>
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
    sound.play('whoosh');
    onClose();
    void setMarket(inst, selTf);
    useApp.getState().sayText(`${emojiFor(inst)} ${displaySymbol(inst.symbol)} it is! Press ▶ when ready.`, 'excited', 35);
  };
  return (
    <Sheet open={open} onClose={onClose} title="🌍 Pick a market">
      <div className="seg tf-row">
        {TIMEFRAMES.map((t) => (
          <button key={t} className={`seg-btn ${selTf === t ? 'on' : ''}`} onClick={() => { sound.play('tick'); setSelTf(t); }}>{t}</button>
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
