import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listIndicators, type ParamSpec, type Params, type ParamValue } from '@miko/engine';
import { useMedia } from '../../lib/useMedia.ts';
import { sound } from '../../lib/sound.ts';
import { usePlay } from '../../state/play.ts';
import { BAR_KEY, lineColors, mainColor, PALETTE, palVar, usesBars, visibleOutputs, type PalKey } from '../../lib/indStyle.ts';

const WIDE = '(min-width: 768px)';
const POP_W = 300;

/** Decimal places that match a slider step (0.1 → 1, 0.005 → 3). */
const decimals = (step = 1) => (step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));

/**
 * A small, cute settings bubble for one indicator: one slider per numeric param, pill toggles for
 * source/enum params, live chart preview while dragging, and ↺ default. A bubble anchored to its chip
 * on wide screens; a compact bottom sheet on phones.
 */
export function IndicatorPopover({ id, anchor, onClose }: { id: string; anchor: HTMLElement | null; onClose: () => void }) {
  const wide = useMedia(WIDE);
  const meta = useMemo(() => listIndicators().find((m) => m.id === id), [id]);
  const stored = usePlay((s) => s.indParams[id]);
  const active = usePlay((s) => s.indicators.includes(id));
  const slot = usePlay((s) => s.indicators.indexOf(id));
  const style = usePlay((s) => s.indStyle[id]);
  const { setIndParams, commitIndParams, toggleIndicator, setIndStyle } = usePlay.getState();
  const defaults = useMemo(() => Object.fromEntries((meta?.params ?? []).map((p) => [p.key, p.default])) as Params, [meta]);
  const [vals, setVals] = useState<Params>(() => ({ ...defaults, ...(stored ?? {}) }));
  const push = useRef(0);
  const settle = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean; arrow: number } | null>(null);

  useEffect(() => { sound.play('open'); }, []);

  useEffect(() => { setVals({ ...defaults, ...(stored ?? {}) }); /* re-sync when switching indicators */ }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(push.current); window.clearTimeout(settle.current); };
  }, [onClose]);

  // Anchor the bubble under (or above) its chip, clamped to the viewport.
  useLayoutEffect(() => {
    if (!wide || !anchor) { setPos(null); return; }
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = box.current?.offsetHeight ?? 280;
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(10, Math.min(vw - POP_W - 10, r.left + r.width / 2 - POP_W / 2));
      const above = r.bottom + 12 + h > vh - 10 && r.top - 12 - h > 10;
      const top = above ? r.top - 12 - h : r.bottom + 12;
      setPos({ left, top, above, arrow: Math.max(18, Math.min(POP_W - 18, r.left + r.width / 2 - left)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [wide, anchor, id, vals]);

  if (!meta) return null;

  /** Only non-default values are stored, so ↺ default is just "store nothing". */
  const diff = (v: Params): Params | null => {
    const out: Params = {};
    for (const p of meta.params) if (v[p.key] !== p.default) out[p.key] = v[p.key]!;
    return Object.keys(out).length ? out : null;
  };

  const change = (key: string, value: ParamValue, immediate = false) => {
    const next = { ...vals, [key]: value };
    setVals(next);
    window.clearTimeout(push.current);
    window.clearTimeout(settle.current);
    const send = () => setIndParams(id, diff(next));
    if (immediate) send(); else push.current = window.setTimeout(send, 90);
    settle.current = window.setTimeout(() => commitIndParams(id), 900);
  };

  const reset = () => {
    sound.play('tap');
    setVals({ ...defaults });
    setIndParams(id, null);
    setIndStyle(id, null);
    settle.current = window.setTimeout(() => commitIndParams(id), 400);
  };

  const close = () => { sound.play('dismiss'); onClose(); };
  const isDefault = diff(vals) === null && !style;
  const color = slot >= 0 ? palVar(mainColor(meta, slot, style)) : 'var(--brand)';
  const bars = usesBars(id, style);
  const barKey = !meta.overlay && bars ? BAR_KEY[id] : undefined;
  const colors = lineColors(meta, Math.max(0, slot), style);
  const outputs = visibleOutputs(meta).filter((o) => o.key !== barKey);
  const pickColor = (key: string, c: PalKey) => { sound.play('select'); setIndStyle(id, { colors: { [key]: c } }); };
  const setBars = (on: boolean) => { if (on === bars) return; sound.play(on ? 'chipOn' : 'chipOff'); setIndStyle(id, { bars: on }); };

  const body = (
    <div
      ref={box}
      className={`ind-pop ${wide ? 'bubble' : 'sheetish'} ${pos?.above ? 'above' : ''}`}
      style={{ ['--pop-c' as string]: color, ...(wide && pos ? { left: pos.left, top: pos.top, ['--arrow-x' as string]: `${pos.arrow}px` } : wide ? { visibility: 'hidden' } : {}) }}
      role="dialog" aria-label={`${meta.name} settings`} onClick={(e) => e.stopPropagation()}
    >
      {!wide && <div className="sheet-grip" />}
      <div className="ind-pop-head">
        <span className="ind-pop-ico" aria-hidden>{meta.icon}</span>
        <div className="ind-pop-title">
          <b>{meta.name}</b>
          <small>{meta.blurb}</small>
        </div>
        <button className="ind-pop-x" onClick={close} aria-label="Close">✕</button>
      </div>

      {meta.params.length === 0 ? (
        <div className="ind-pop-empty">No knobs here, it just works ✨</div>
      ) : (
        <div className="ind-pop-params">
          {meta.params.map((p) => <ParamControl key={p.key} spec={p} value={vals[p.key] ?? p.default} onChange={change} />)}
        </div>
      )}

      {active && (
        <div className="ind-pop-look">
          {BAR_KEY[id] && !meta.overlay && (
            <div className="pp-row pills">
              <span className="pp-lbl">Style</span>
              <div className="pp-pills">
                <button className={`pp-pill ${!bars ? 'on' : ''}`} onClick={() => setBars(false)}>〰 Line</button>
                <button className={`pp-pill ${bars ? 'on' : ''}`} onClick={() => setBars(true)}>▮ Bars</button>
              </div>
            </div>
          )}
          {outputs.map((o) => (
            <div key={o.key} className="pp-row swatches">
              <span className="pp-lbl">{outputs.length > 1 ? o.label : 'Color'}</span>
              <div className="pp-swatches" role="radiogroup" aria-label={`${o.label} color`}>
                {PALETTE.map((c) => (
                  <button
                    key={c} role="radio" aria-checked={colors[o.key] === c} aria-label={c}
                    className={`swatch ${colors[o.key] === c ? 'on' : ''}`} style={{ ['--sw' as string]: palVar(c) }}
                    onClick={() => pickColor(o.key, c)}
                  />
                ))}
              </div>
            </div>
          ))}
          {barKey && <div className="pp-note">▮ Bars: green above zero, orange below. Faded while they shrink.</div>}
        </div>
      )}

      <div className="ind-pop-foot">
        <button className="pop-btn" onClick={reset} disabled={isDefault}>↺ default</button>
        <button className={`pop-btn ${active ? 'on' : ''}`} onClick={() => { toggleIndicator(id); if (active) onClose(); }}>
          {active ? <><span className="pop-dot" /> On chart</> : '＋ Show on chart'}
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div className={`ind-pop-backdrop ${wide ? 'clear' : ''}`} onClick={close}>{body}</div>,
    document.getElementById('overlay-root') ?? document.body,
  );
}

function ParamControl({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue; onChange: (key: string, v: ParamValue, immediate?: boolean) => void }) {
  if (spec.type === 'source' || spec.type === 'enum') {
    return (
      <div className="pp-row pills">
        <span className="pp-lbl">{spec.label}</span>
        <div className="pp-pills">
          {(spec.options ?? []).map((o) => (
            <button key={o} className={`pp-pill ${value === o ? 'on' : ''}`} onClick={() => { sound.play('select'); onChange(spec.key, o, true); }}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  const min = spec.min ?? 1, max = spec.max ?? 100, step = spec.step ?? (spec.type === 'int' ? 1 : 0.1);
  const v = typeof value === 'number' ? value : Number(value);
  const pct = ((v - min) / (max - min)) * 100;
  const d = decimals(step);
  return (
    <label className="pp-row">
      <span className="pp-lbl">{spec.label}</span>
      <input
        type="range" min={min} max={max} step={step} value={v} style={{ ['--p' as string]: `${pct}%` }}
        onChange={(e) => { sound.play('slide', max > min ? (Number(e.target.value) - min) / (max - min) : 0); onChange(spec.key, spec.type === 'int' ? Math.round(Number(e.target.value)) : Number(Number(e.target.value).toFixed(d))); }}
      />
      <span className="pp-val num">{v.toFixed(d)}</span>
    </label>
  );
}
