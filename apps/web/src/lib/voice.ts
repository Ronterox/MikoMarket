/**
 * Miko's voice: a tiny formant synthesiser, no audio files.
 *
 * A bright sawtooth "voice box" (with vibrato and a little breath) goes through three
 * band-pass filters tuned to vowel formants. Consonants are short shaped noise bursts.
 * That is enough for cute game babble (one syllable every ~110 ms while she types,
 * shaped by her mood) and for short anime exclamations: "yatta!", "ehh?!", "kyaa~".
 */
import type { Mood } from '@miko/engine';
import { sound } from './sound.ts';

export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'n';
export type Consonant = 'k' | 't' | 's' | 'sh' | 'h' | 'f' | 'p' | 'm' | 'n' | 'r' | 'y' | 'w' | 'ky' | 'ny';

export interface Syllable {
  c?: Consonant;
  v: Vowel;
  /** Seconds, consonant included. */
  dur: number;
  /** Pitch at the start and end, as multiples of the base pitch. */
  p: number;
  pEnd?: number;
  vol?: number;
  /** Silence before this syllable (word gaps, the little stop in "ya-tta"). */
  gap?: number;
}

/** Formants (Hz) for a bright young voice. Japanese "u" is unrounded. "n" is a nasal hum. */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [950, 1450, 2950],
  i: [380, 2750, 3500],
  u: [420, 1500, 2700],
  e: [620, 2350, 3100],
  o: [600, 1000, 2850],
  n: [280, 1650, 2700],
};
const FORMANT_GAIN = [1, 0.6, 0.25];
const FORMANT_Q = [5, 9, 11];
/** Loudness per vowel: open vowels ring much louder through the formants than "i" or a hum. */
const VOWEL_GAIN: Record<Vowel, number> = { a: 0.7, e: 0.75, o: 0.9, i: 1.15, u: 0.8, n: 1.9 };

/** How each consonant sounds: a noise burst (band-pass) and/or a glide/hum before the vowel. */
const CONSONANT: Record<Consonant, { noise?: { f: number; q: number; dur: number; vol: number }; from?: Vowel; hum?: number }> = {
  k: { noise: { f: 2300, q: 2, dur: 0.018, vol: 0.5 } },
  t: { noise: { f: 4200, q: 2, dur: 0.014, vol: 0.45 } },
  p: { noise: { f: 900, q: 1.2, dur: 0.012, vol: 0.4 } },
  s: { noise: { f: 6800, q: 2.5, dur: 0.06, vol: 0.32 } },
  sh: { noise: { f: 3600, q: 1.6, dur: 0.06, vol: 0.32 } },
  f: { noise: { f: 1700, q: 0.8, dur: 0.05, vol: 0.2 } },
  h: { noise: { f: 1500, q: 0.7, dur: 0.045, vol: 0.22 } },
  m: { hum: 0.04, from: 'n' },
  n: { hum: 0.035, from: 'n' },
  r: { hum: 0.018, from: 'e' },
  y: { from: 'i' },
  w: { from: 'u' },
  ky: { noise: { f: 2800, q: 2, dur: 0.018, vol: 0.5 }, from: 'i' },
  ny: { hum: 0.03, from: 'i' },
};

interface VoiceStyle { f0: number; syl: number; swing: number; vib: number; breath: number; drift: number }

/** Base pitch, syllable length, pitch swing, vibrato depth, breathiness and phrase drift per mood. */
const STYLE: Record<Mood, VoiceStyle> = {
  happy: { f0: 500, syl: 0.105, swing: 0.09, vib: 0.016, breath: 0.05, drift: 0 },
  excited: { f0: 560, syl: 0.09, swing: 0.13, vib: 0.02, breath: 0.04, drift: 0.04 },
  cheer: { f0: 570, syl: 0.09, swing: 0.13, vib: 0.02, breath: 0.04, drift: 0.05 },
  proud: { f0: 520, syl: 0.1, swing: 0.1, vib: 0.018, breath: 0.05, drift: 0.02 },
  thinking: { f0: 470, syl: 0.12, swing: 0.05, vib: 0.012, breath: 0.07, drift: -0.02 },
  teaching: { f0: 480, syl: 0.11, swing: 0.06, vib: 0.014, breath: 0.05, drift: 0 },
  worried: { f0: 440, syl: 0.125, swing: 0.06, vib: 0.03, breath: 0.08, drift: -0.06 },
  sleepy: { f0: 390, syl: 0.16, swing: 0.04, vib: 0.01, breath: 0.14, drift: -0.08 },
};

export type Exclamation =
  | 'yatta' | 'ehh' | 'kyaa' | 'hmm' | 'ufufu' | 'ehehe' | 'uu' | 'hai' | 'fuwaa' | 'nya' | 'mou' | 'sugoi'
  | 'wa' | 'ara' | 'ganbatte' | 'daijoubu' | 'fufun';

/** Short anime interjections as syllable scripts (pitch as multiples of the mood's base). */
export const EXCLAMATIONS: Record<Exclamation, { mood: Mood; s: Syllable[] }> = {
  yatta: { mood: 'excited', s: [{ c: 'y', v: 'a', dur: 0.1, p: 1.05 }, { c: 't', v: 'a', dur: 0.26, p: 1.3, pEnd: 1.5, gap: 0.06, vol: 1.1 }] },
  ehh: { mood: 'excited', s: [{ v: 'e', dur: 0.36, p: 0.95, pEnd: 1.65, vol: 1.1 }] },
  kyaa: { mood: 'excited', s: [{ c: 'ky', v: 'a', dur: 0.38, p: 1.5, pEnd: 1.28, vol: 1.05 }] },
  hmm: { mood: 'thinking', s: [{ c: 'm', v: 'n', dur: 0.24, p: 0.95, pEnd: 1.05 }, { v: 'n', dur: 0.24, p: 1.05, pEnd: 0.92 }] },
  ufufu: { mood: 'happy', s: [{ v: 'u', dur: 0.08, p: 1.2 }, { c: 'f', v: 'u', dur: 0.08, p: 1.32 }, { c: 'f', v: 'u', dur: 0.12, p: 1.22, pEnd: 1.15 }] },
  ehehe: { mood: 'happy', s: [{ v: 'e', dur: 0.08, p: 1.15 }, { c: 'h', v: 'e', dur: 0.08, p: 1.3 }, { c: 'h', v: 'e', dur: 0.12, p: 1.2, pEnd: 1.12 }] },
  uu: { mood: 'worried', s: [{ v: 'u', dur: 0.45, p: 1.02, pEnd: 0.82 }] },
  hai: { mood: 'happy', s: [{ c: 'h', v: 'a', dur: 0.11, p: 1.12 }, { v: 'i', dur: 0.14, p: 1.28, pEnd: 1.12 }] },
  fuwaa: { mood: 'sleepy', s: [{ c: 'f', v: 'u', dur: 0.13, p: 1.15 }, { c: 'w', v: 'a', dur: 0.62, p: 1.25, pEnd: 0.78 }] },
  nya: { mood: 'happy', s: [{ c: 'ny', v: 'a', dur: 0.28, p: 1.2, pEnd: 1.38 }] },
  mou: { mood: 'worried', s: [{ c: 'm', v: 'o', dur: 0.13, p: 1.25 }, { v: 'u', dur: 0.28, p: 1.42, pEnd: 1.12, vol: 1.1 }] },
  sugoi: { mood: 'excited', s: [{ c: 's', v: 'u', dur: 0.1, p: 1.1 }, { c: 'k', v: 'o', dur: 0.1, p: 1.25 }, { v: 'i', dur: 0.24, p: 1.42, pEnd: 1.55, vol: 1.1 }] },
  wa: { mood: 'excited', s: [{ c: 'w', v: 'a', dur: 0.2, p: 1.3, pEnd: 1.6 }] },
  ara: { mood: 'thinking', s: [{ v: 'a', dur: 0.11, p: 1.12 }, { c: 'r', v: 'a', dur: 0.22, p: 1.0, pEnd: 1.28 }] },
  ganbatte: { mood: 'cheer', s: [{ c: 'k', v: 'a', dur: 0.08, p: 1.1 }, { v: 'n', dur: 0.05, p: 1.12 }, { c: 'p', v: 'a', dur: 0.08, p: 1.2 }, { c: 't', v: 'e', dur: 0.24, p: 1.38, pEnd: 1.3, gap: 0.05, vol: 1.1 }] },
  daijoubu: { mood: 'teaching', s: [{ c: 't', v: 'a', dur: 0.08, p: 1.1 }, { v: 'i', dur: 0.06, p: 1.14 }, { c: 'y', v: 'o', dur: 0.13, p: 1.2 }, { c: 'p', v: 'u', dur: 0.16, p: 1.12, pEnd: 1.0 }] },
  fufun: { mood: 'proud', s: [{ c: 'f', v: 'u', dur: 0.08, p: 1.15 }, { c: 'f', v: 'u', dur: 0.08, p: 1.3 }, { v: 'n', dur: 0.2, p: 1.32, pEnd: 1.1 }] },
};

const LETTER_C: Record<string, Consonant> = {
  k: 'k', c: 'k', q: 'k', g: 'k', t: 't', d: 't', s: 's', z: 's', x: 's', h: 'h', f: 'f', v: 'f',
  p: 'p', b: 'p', m: 'm', n: 'n', r: 'r', l: 'r', y: 'y', j: 'y', w: 'w',
};
const LETTER_V: Record<string, Vowel> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u' };

/** Cheap deterministic hash: the same line always babbles the same way. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Turns a line into babble syllables shaped by mood: CV syllables from the letters, gaps at word
 * and comma breaks, a rise for "?" and a lift for "!". Capped so long tips don't talk forever.
 */
export function babbleSyllables(text: string, mood: Mood, maxSyllables = 14): Syllable[] {
  const st = STYLE[mood] ?? STYLE.happy;
  const out: Syllable[] = [];
  let seed = hash(text);
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let pendingC: Consonant | undefined;
  let gap = 0;
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length && out.length < maxSyllables; i++) {
    const ch = lower[i]!;
    const v = LETTER_V[ch];
    if (v) {
      const k = out.length;
      const wobble = (rnd() * 2 - 1) * st.swing + (k % 2 ? st.swing * 0.4 : -st.swing * 0.4);
      out.push({ c: pendingC, v, dur: st.syl * (0.85 + rnd() * 0.3), p: 1 + wobble + st.drift * (k / maxSyllables), gap: gap || undefined });
      pendingC = undefined;
      gap = 0;
    } else if (LETTER_C[ch]) {
      pendingC = LETTER_C[ch];
    } else if (ch === ' ') {
      if (out.length) gap = Math.max(gap, 0.035);
      pendingC = undefined;
    } else if (ch === ',' || ch === ':' || ch === ';') {
      gap = 0.09;
    } else if (ch === '!' || ch === '?' || ch === '.' || ch === '…') {
      const last = out[out.length - 1];
      if (last && last.pEnd === undefined) {
        if (ch === '?') last.pEnd = last.p * 1.25;
        else if (ch === '!') { last.p *= 1.08; last.pEnd = last.p * 1.06; last.vol = 1.1; }
        else last.pEnd = last.p * 0.9;
        last.dur *= 1.25;
      }
      gap = 0.12;
    }
  }
  return out;
}

class Voice {
  enabled = true;
  private current: { stop: (at: number) => void; end: number; kind: 'babble' | 'exclaim' } | null = null;

  /**
   * Speaks syllables now. Babble waits for an exclamation still in progress ("Ehh?! …") but cuts
   * off older babble; an exclamation always cuts in. Returns when it will end (ctx time), or 0.
   */
  speak(syllables: Syllable[], mood: Mood, opts: { kind?: 'babble' | 'exclaim'; vol?: number } = {}): number {
    if (!this.enabled || syllables.length === 0) return 0;
    const out = sound.voiceOut();
    if (!out) return 0;
    const { ctx, bus, reverb } = out;
    const st = STYLE[mood] ?? STYLE.happy;
    const now = ctx.currentTime + 0.01;
    let t = now;
    const kind = opts.kind ?? 'exclaim';
    if (this.current) {
      if (kind === 'babble' && this.current.kind === 'exclaim' && this.current.end > now) t = this.current.end + 0.05;
      else this.current.stop(now);
    }
    const total = syllables.reduce((a, s) => a + s.dur + (s.gap ?? 0), 0);
    const end = t + total + 0.08;
    const f0 = st.f0;
    const vol = 0.13 * (opts.vol ?? 1);

    // Voice box: sawtooth + a soft sine for body, vibrato on both.
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const body = ctx.createOscillator();
    body.type = 'sine';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.6;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = f0 * st.vib;
    vib.connect(vibDepth);
    vibDepth.connect(saw.frequency);
    vibDepth.connect(body.frequency);
    const src = ctx.createGain();
    src.gain.value = 0.0001;
    saw.connect(src);
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.35;
    body.connect(bodyGain).connect(src);
    // Breath: noise through the same formants, following the same envelope.
    const nb = ctx.createBufferSource();
    nb.buffer = breathBuffer(ctx);
    nb.loop = true;
    const breath = ctx.createGain();
    breath.gain.value = st.breath * 3;
    nb.connect(breath).connect(src);

    const formants = FORMANTS.a.map((f, k) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = FORMANT_Q[k]!;
      const g = ctx.createGain();
      g.gain.value = FORMANT_GAIN[k]! * 2.2;
      src.connect(bp).connect(g);
      return { bp, g };
    });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    const outGain = ctx.createGain();
    outGain.gain.value = 1;
    for (const { g } of formants) g.connect(lp);
    lp.connect(outGain).connect(bus);
    const send = ctx.createGain();
    send.gain.value = 0.18;
    outGain.connect(send).connect(reverb);

    const setFormants = (v: Vowel, at: number, tc = 0.012) => {
      FORMANTS[v].forEach((f, k) => formants[k]!.bp.frequency.setTargetAtTime(f, at, tc));
    };

    let at = t;
    saw.frequency.setValueAtTime(f0 * syllables[0]!.p, at);
    body.frequency.setValueAtTime(f0 * syllables[0]!.p, at);
    for (const s of syllables) {
      at += s.gap ?? 0;
      const con = s.c ? CONSONANT[s.c] : undefined;
      const pStart = f0 * s.p, pEnd = f0 * (s.pEnd ?? s.p);
      let vStart = at;
      if (con?.noise) {
        burst(ctx, bus, at, con.noise.f, con.noise.q, con.noise.dur, con.noise.vol * vol);
        vStart = at + con.noise.dur * (s.c === 's' || s.c === 'sh' || s.c === 'f' || s.c === 'h' ? 0.8 : 0.6);
      }
      if (con?.hum || con?.from) {
        setFormants(con.from ?? 'n', at, 0.004);
        vStart = Math.max(vStart, at + (con.hum ?? 0.015));
      }
      // Pitch glide over the syllable.
      saw.frequency.setValueAtTime(pStart, at);
      saw.frequency.linearRampToValueAtTime(pEnd, at + s.dur);
      body.frequency.setValueAtTime(pStart, at);
      body.frequency.linearRampToValueAtTime(pEnd, at + s.dur);
      // Envelope: hums start voiced at a lower level; bursts leave the voice silent until the vowel.
      const peak = vol * (s.vol ?? 1) * VOWEL_GAIN[s.v];
      src.gain.setTargetAtTime(con?.hum ? peak * 0.45 : 0.0001, at, 0.006);
      setFormants(s.v, vStart, con?.from ? 0.022 : 0.01);
      src.gain.setTargetAtTime(peak, vStart, 0.012);
      src.gain.setTargetAtTime(0.0001, at + s.dur - 0.025, 0.012);
      at += s.dur;
    }

    saw.start(t); body.start(t); vib.start(t); nb.start(t);
    const stopAt = (when: number) => {
      src.gain.cancelScheduledValues(when);
      src.gain.setTargetAtTime(0.0001, when, 0.015);
      for (const n of [saw, body, vib, nb]) { try { n.stop(when + 0.1); } catch { /* already stopped */ } }
    };
    stopAt(end);
    sound.duck(end - now + 0.3, 0.55);
    const handle = { stop: stopAt, end, kind };
    this.current = handle;
    saw.onended = () => { if (this.current === handle) this.current = null; };
    return end;
  }

  /** Babbles along with a line of text while it types out. */
  babble(text: string, mood: Mood): void {
    this.speak(babbleSyllables(text, mood), mood, { kind: 'babble', vol: 0.85 });
  }

  exclaim(name: Exclamation): void {
    const e = EXCLAMATIONS[name];
    this.speak(e.s, e.mood, { kind: 'exclaim' });
  }

  /** Stops talking right away (tip skipped or dismissed). */
  hush(): void {
    const out = sound.voiceOut();
    if (out && this.current) this.current.stop(out.ctx.currentTime);
    this.current = null;
  }
}

let breathBuf: AudioBuffer | null = null;
function breathBuffer(ctx: AudioContext): AudioBuffer {
  if (breathBuf && breathBuf.sampleRate === ctx.sampleRate) return breathBuf;
  breathBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = breathBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
  return breathBuf;
}

function burst(ctx: AudioContext, dest: AudioNode, at: number, f: number, q: number, dur: number, vol: number): void {
  const src = ctx.createBufferSource();
  src.buffer = breathBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + Math.min(0.006, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(dest);
  src.start(at, Math.random() * 0.5, dur + 0.03);
}

export const voice = new Voice();

/** Picks an exclamation that fits a mood (or null to just babble). `roll` in [0, 1). */
export function exclamationFor(mood: Mood, roll: number): Exclamation | null {
  const table: Partial<Record<Mood, { p: number; pick: Exclamation[] }>> = {
    excited: { p: 0.45, pick: ['yatta', 'sugoi', 'kyaa', 'wa'] },
    cheer: { p: 0.45, pick: ['yatta', 'ganbatte', 'sugoi'] },
    proud: { p: 0.35, pick: ['fufun', 'ehehe', 'ufufu'] },
    worried: { p: 0.35, pick: ['uu', 'ara', 'daijoubu'] },
    thinking: { p: 0.3, pick: ['hmm', 'ara'] },
    teaching: { p: 0.15, pick: ['hai', 'hmm'] },
    happy: { p: 0.15, pick: ['ehehe', 'hai', 'ufufu'] },
    sleepy: { p: 0.5, pick: ['fuwaa'] },
  };
  const row = table[mood];
  if (!row || roll >= row.p) return null;
  return row.pick[Math.floor((roll / row.p) * row.pick.length) % row.pick.length]!;
}
