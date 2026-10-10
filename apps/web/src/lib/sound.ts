/**
 * Synthesised WebAudio SFX: no audio files. Every sound is a tiny recipe of
 * oscillators, filtered noise and envelopes. The context is created lazily on
 * the first user gesture (browsers block autoplay before that).
 *
 * Routing:  ui ─┐
 *          sfx ─┼─► master ─► compressor ─► speakers
 *        voice ─┤      ▲
 *        music ─┘   reverb (sparkles / bells only)
 *
 * Style rule: cute and soft. Pentatonic, rounded waves, nothing harsh or alarming,
 * even for losses and warnings.
 */

export type Sfx =
  // UI
  | 'tick' | 'tap' | 'tab' | 'open' | 'dismiss' | 'toggleOn' | 'toggleOff' | 'slide' | 'chipOn' | 'chipOff'
  | 'select' | 'swap' | 'pickup' | 'drop' | 'pop' | 'speed' | 'pause'
  // Play
  | 'buy' | 'sell' | 'close' | 'fill' | 'win' | 'loss' | 'stopHit' | 'breakeven' | 'warn' | 'bar'
  | 'combo' | 'streak' | 'roundStart' | 'roundEnd' | 'xp' | 'star' | 'live'
  // Lab
  | 'cardAdd' | 'cardRemove' | 'shuffle' | 'scan' | 'evolve' | 'gen' | 'evolveDone' | 'stress' | 'grade' | 'reveal'
  // Meta
  | 'levelUp' | 'achievement' | 'podium' | 'crown' | 'whoosh' | 'error';

type Wave = OscillatorType;

/** Sounds that go to the quieter UI bus. */
const UI_SFX = new Set<Sfx>(['tick', 'tap', 'tab', 'open', 'dismiss', 'toggleOn', 'toggleOff', 'slide', 'chipOn', 'chipOff', 'select', 'swap', 'speed', 'pause']);

/** Minimum seconds between two plays of the same sound (fast replays must not machine-gun). */
const MIN_GAP: Partial<Record<Sfx, number>> = {
  tick: 0.03, tap: 0.03, slide: 0.04, bar: 0.11, gen: 0.04, xp: 0.045, chipOn: 0.05, chipOff: 0.05, pop: 0.03, fill: 0.06,
};

/** C major pentatonic, C5 up. */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];

interface ToneOpts { wave?: Wave; vol?: number; slideTo?: number; attack?: number; dest?: AudioNode; rev?: number; detune?: number }
interface NoiseOpts { type?: BiquadFilterType; freq?: number; q?: number; slideTo?: number; vol?: number; dest?: AudioNode; attack?: number }

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private reverb: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private out: AudioNode | null = null;
  private last = new Map<Sfx, number>();
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicLevel = 0.35;
  enabled = true;
  musicEnabled = false;

  /** Call from any pointerdown; safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        // Creating it before any gesture only yields a suspended context (and a console warning).
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        this.ctx = ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.004;
        comp.release.value = 0.18;
        comp.connect(ctx.destination);
        this.master = ctx.createGain();
        this.master.gain.value = 0.62;
        this.master.connect(comp);
        this.uiBus = this.bus(0.7);
        this.sfxBus = this.bus(1);
        this.voiceBus = this.bus(0.95);
        this.musicGain = this.bus(0);
        this.reverb = this.makeReverb(ctx);
        this.noiseBuf = this.makeNoise(ctx);
        if (this.musicEnabled) this.startMusic();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio unavailable: stay silent */
    }
  }

  private bus(gain: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = gain;
    g.connect(this.master!);
    return g;
  }

  /** A soft generated room: stereo noise with an exponential tail. */
  private makeReverb(ctx: AudioContext): GainNode {
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const send = ctx.createGain();
    send.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    send.connect(conv).connect(wet).connect(this.master!);
    return send;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setEnabled(on: boolean): void { this.enabled = on; }

  setMusic(on: boolean): void {
    this.musicEnabled = on;
    if (on) this.startMusic(); else this.stopMusic();
  }

  /** For the voice synth: the shared context and its bus, or null when silent/unavailable. */
  voiceOut(): { ctx: AudioContext; bus: GainNode; reverb: GainNode } | null {
    if (!this.enabled) return null;
    this.unlock();
    if (this.ctx?.state !== 'running') return null; // before the first gesture: stay quiet, never queue
    return this.voiceBus && this.reverb ? { ctx: this.ctx, bus: this.voiceBus, reverb: this.reverb } : null;
  }

  /** Lower the music briefly (Miko talking, big moments). */
  duck(seconds = 1.2, to = 0.4): void {
    const ctx = this.ctx, g = this.musicGain;
    if (!ctx || !g || !this.musicEnabled) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(this.musicLevel * to, t, 0.05);
    g.gain.setTargetAtTime(this.musicLevel, t + seconds, 0.4);
  }

  // ── building blocks ──

  private tone(freq: number, start: number, dur: number, opts: ToneOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.wave ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.detune) osc.detune.value = opts.detune;
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    const vol = opts.vol ?? 0.3;
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(opts.dest ?? this.out ?? this.master!);
    if (opts.rev && this.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.rev;
      g.connect(s).connect(this.reverb);
    }
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private noise(start: number, dur: number, opts: NoiseOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'highpass';
    f.frequency.setValueAtTime(opts.freq ?? 2000, start);
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const vol = opts.vol ?? 0.15;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(opts.dest ?? this.out ?? this.master!);
    src.start(start, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
  }

  /** Soft bell: sine plus a quiet inharmonic partial, with a touch of room. */
  private bell(freq: number, start: number, dur = 0.6, vol = 0.12): void {
    this.tone(freq, start, dur, { vol, rev: 0.5 });
    this.tone(freq * 2.76, start, dur * 0.45, { vol: vol * 0.25, rev: 0.5 });
  }

  /** Round, short pluck (coins, bubbles). */
  private pluck(freq: number, start: number, vol = 0.12): void {
    this.tone(freq, start, 0.14, { wave: 'triangle', vol });
    this.tone(freq * 2, start, 0.08, { vol: vol * 0.5 });
  }

  /** Bubbly "bloop": a sine that bends up fast. */
  private bloop(from: number, to: number, start: number, vol = 0.14, dur = 0.09): void {
    this.tone(from, start, dur, { vol, slideTo: to, attack: 0.003 });
  }

  play(name: Sfx, intensity = 1): void {
    if (!this.enabled) return;
    this.unlock();
    const ctx = this.ctx;
    // A suspended context (no user gesture yet) would replay everything in a burst later: skip instead.
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap !== undefined && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);
    this.out = UI_SFX.has(name) ? this.uiBus : this.sfxBus;
    const t = now + 0.005;
    const I = Number.isFinite(intensity) ? intensity : 1;

    switch (name) {
      // ───────────── UI ─────────────
      case 'tick':
        this.tone(1400, t, 0.04, { wave: 'triangle', vol: 0.08 });
        break;
      case 'tap': // soft rounded button press
        this.bloop(620, 900, t, 0.1, 0.06);
        break;
      case 'tab': // page flip + little pop
        this.noise(t, 0.09, { type: 'bandpass', freq: 1800, slideTo: 3600, q: 1.2, vol: 0.06 });
        this.bloop(700, 1050, t + 0.03, 0.09, 0.07);
        break;
      case 'open': // bubble rising
        this.bloop(440, 880, t, 0.1, 0.1);
        this.pluck(1318.5, t + 0.07, 0.05);
        break;
      case 'dismiss': // bubble settling
        this.bloop(900, 520, t, 0.08, 0.1);
        break;
      case 'toggleOn':
        this.pluck(880, t, 0.08);
        this.pluck(1318.5, t + 0.06, 0.08);
        break;
      case 'toggleOff':
        this.pluck(1046.5, t, 0.07);
        this.pluck(659.25, t + 0.06, 0.07);
        break;
      case 'slide': { // detent; pitch follows the slider (intensity 0..1)
        const k = Math.max(0, Math.min(1, I));
        this.tone(700 + k * 900, t, 0.03, { wave: 'triangle', vol: 0.06 });
        break;
      }
      case 'chipOn':
        this.bloop(660, 1320, t, 0.1, 0.08);
        this.tone(1975.5, t + 0.06, 0.18, { vol: 0.04, rev: 0.4 });
        break;
      case 'chipOff':
        this.bloop(1100, 520, t, 0.09, 0.08);
        break;
      case 'select':
        this.pluck(1046.5, t, 0.08);
        this.pluck(1567.98, t + 0.05, 0.07);
        break;
      case 'swap': // flip: two quick blips crossing
        this.bloop(600, 1000, t, 0.07, 0.06);
        this.bloop(1000, 600, t + 0.06, 0.07, 0.06);
        break;
      case 'speed': { // one notch per speed level (0 = pause … 4 = fastest)
        const lvl = Math.max(0, Math.min(4, Math.round(I)));
        for (let i = 0; i <= lvl; i++) this.pluck(PENTA[2 + i * 2]!, t + i * 0.035, 0.06);
        break;
      }
      case 'pause':
        this.pluck(880, t, 0.07);
        this.pluck(659.25, t + 0.07, 0.06);
        break;
      case 'pickup': // lifted: rising whistle
        this.tone(700, t, 0.16, { wave: 'triangle', vol: 0.08, slideTo: 1500 });
        this.noise(t, 0.12, { type: 'bandpass', freq: 1200, slideTo: 3000, q: 2, vol: 0.04 });
        break;
      case 'drop': // landed: soft boing
        this.tone(320, t, 0.18, { vol: 0.16, slideTo: 180 });
        this.tone(640, t + 0.05, 0.12, { vol: 0.05, slideTo: 420 });
        break;
      case 'pop':
        this.bloop(500 + Math.random() * 300, 1400 + Math.random() * 400, t, 0.08, 0.05);
        break;

      // ───────────── Play ─────────────
      case 'buy': // bright upward "pew"
        this.tone(520, t, 0.16, { wave: 'square', vol: 0.1, slideTo: 1560 });
        this.tone(1040, t + 0.02, 0.12, { vol: 0.12, slideTo: 2080 });
        this.tone(2093, t + 0.1, 0.25, { vol: 0.03, rev: 0.5 });
        break;
      case 'sell': // downward "pew"
        this.tone(1300, t, 0.16, { wave: 'square', vol: 0.09, slideTo: 420 });
        this.tone(880, t + 0.02, 0.12, { vol: 0.1, slideTo: 300 });
        break;
      case 'close':
        this.tone(660, t, 0.08, { wave: 'triangle', vol: 0.16 });
        this.tone(990, t + 0.06, 0.1, { wave: 'triangle', vol: 0.12 });
        break;
      case 'fill': // order filled: a clean "click-ding"
        this.noise(t, 0.025, { type: 'bandpass', freq: 3500, q: 3, vol: 0.08 });
        this.bell(I >= 0 ? 1567.98 : 1174.66, t + 0.015, 0.35, 0.07);
        break;
      case 'win': { // cash register: ka-ching + bell sparkle
        this.noise(t, 0.06, { freq: 3000, vol: 0.18 });
        const notes = [1318.5, 1760, 2637];
        notes.forEach((f, i) => this.tone(f, t + 0.05 + i * 0.07, 0.5, { vol: 0.17 * Math.min(1.5, I), rev: 0.35 }));
        this.tone(2637 * 1.5, t + 0.3, 0.6, { vol: 0.06, rev: 0.6 });
        break;
      }
      case 'loss': // soft, friendly bonk
        this.tone(330, t, 0.22, { vol: 0.22, slideTo: 196 });
        this.tone(165, t, 0.18, { wave: 'triangle', vol: 0.12 });
        this.tone(523, t + 0.2, 0.25, { vol: 0.07, rev: 0.3 }); // a hopeful little ping after
        break;
      case 'stopHit': // the shield caught it: a muted clang, then a calm ping
        this.noise(t, 0.08, { type: 'bandpass', freq: 2400, q: 6, vol: 0.12 });
        this.tone(740, t, 0.3, { wave: 'triangle', vol: 0.12, slideTo: 700 });
        this.tone(1110, t, 0.22, { vol: 0.05 });
        this.bell(1046.5, t + 0.22, 0.5, 0.06);
        break;
      case 'breakeven': // shield shimmer
        [1046.5, 1318.5, 1567.98, 2093].forEach((f, i) => this.tone(f, t + i * 0.04, 0.4, { vol: 0.06, rev: 0.6 }));
        this.noise(t, 0.3, { type: 'highpass', freq: 6000, vol: 0.03, attack: 0.1 });
        break;
      case 'warn': // gentle "hm?" two-tone, never an alarm
        this.tone(587.33, t, 0.12, { wave: 'triangle', vol: 0.1 });
        this.tone(740, t + 0.12, 0.16, { wave: 'triangle', vol: 0.1 });
        break;
      case 'bar': // a new candle: a whisper of a tick, up or down
        this.tone(I >= 0 ? 2350 : 1760, t, 0.025, { vol: 0.025 });
        break;
      case 'combo': { // riser, pitch climbs with combo size
        const base = 400 + Math.min(10, I) * 80;
        this.tone(base, t, 0.25, { wave: 'sawtooth', vol: 0.05, slideTo: base * 2.5 });
        this.tone(base * 2, t + 0.2, 0.2, { wave: 'triangle', vol: 0.1, rev: 0.3 });
        break;
      }
      case 'streak': // a little flame whoosh with a sparkle on top
        this.noise(t, 0.35, { type: 'bandpass', freq: 600, slideTo: 2400, q: 1.5, vol: 0.09, attack: 0.08 });
        this.tone(1318.5, t + 0.25, 0.3, { vol: 0.06, rev: 0.5 });
        break;
      case 'roundStart': { // "ready… go!"
        this.pluck(783.99, t, 0.09);
        this.pluck(783.99, t + 0.16, 0.09);
        this.tone(1567.98, t + 0.34, 0.35, { wave: 'triangle', vol: 0.13, rev: 0.4 });
        this.tone(2093, t + 0.34, 0.3, { vol: 0.05, rev: 0.4 });
        break;
      }
      case 'roundEnd': // finish whistle + soft chord
        this.tone(1760, t, 0.18, { vol: 0.08, slideTo: 2350 });
        this.tone(2350, t + 0.18, 0.2, { vol: 0.07 });
        [523.25, 659.25, 783.99].forEach((f) => this.tone(f, t + 0.3, 0.8, { wave: 'triangle', vol: 0.07, rev: 0.4, attack: 0.02 }));
        break;
      case 'xp': { // coin pickup; climbs with the index of the award
        const f = PENTA[Math.min(PENTA.length - 1, 3 + Math.max(0, Math.round(I)))]!;
        this.pluck(f, t, 0.09);
        this.tone(f * 1.5, t + 0.05, 0.12, { vol: 0.05, rev: 0.3 });
        break;
      }
      case 'star': // rating up
        this.bell(1567.98, t, 0.5, 0.08);
        this.bell(2093, t + 0.08, 0.6, 0.07);
        break;
      case 'live': // connected to the live market: radio blip
        this.tone(1200, t, 0.05, { wave: 'square', vol: 0.04 });
        this.tone(1800, t + 0.07, 0.08, { wave: 'square', vol: 0.04 });
        this.noise(t, 0.12, { type: 'bandpass', freq: 2500, q: 4, vol: 0.03 });
        break;

      // ───────────── Lab ─────────────
      case 'cardAdd': // card slapped on the table
        this.noise(t, 0.05, { type: 'lowpass', freq: 1800, vol: 0.16 });
        this.bloop(500, 760, t + 0.01, 0.08, 0.07);
        break;
      case 'cardRemove': // card flicked away
        this.noise(t, 0.14, { type: 'bandpass', freq: 3000, slideTo: 900, q: 1.5, vol: 0.07 });
        break;
      case 'shuffle':
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.035, 0.03, { type: 'bandpass', freq: 2200 + i * 250, q: 2, vol: 0.06 });
        break;
      case 'scan': // test run: a quick computer sweep
        for (let i = 0; i < 5; i++) this.tone(PENTA[i * 2]!, t + i * 0.05, 0.05, { wave: 'square', vol: 0.03 });
        this.noise(t, 0.3, { type: 'bandpass', freq: 800, slideTo: 4000, q: 3, vol: 0.03 });
        break;
      case 'evolve': // DNA bubbles
        for (let i = 0; i < 5; i++) this.bloop(400 + i * 120, 900 + i * 180, t + i * 0.06, 0.07, 0.07);
        break;
      case 'gen':
        this.tone(900 + Math.min(40, I) * 30, t, 0.05, { vol: 0.05 });
        break;
      case 'evolveDone':
        [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => this.bell(f, t + i * 0.07, 0.6, 0.07));
        break;
      case 'stress': // tension: a low drone that swells
        this.tone(110, t, 1.2, { wave: 'sawtooth', vol: 0.04, slideTo: 165, attack: 0.5 });
        this.tone(220, t, 1.2, { wave: 'triangle', vol: 0.03, slideTo: 330, attack: 0.5 });
        this.noise(t, 1.1, { type: 'lowpass', freq: 400, slideTo: 1800, vol: 0.04, attack: 0.6 });
        break;
      case 'grade': { // sting per grade: 0 = S … 4 = D (D stays friendly)
        const g = Math.max(0, Math.min(4, Math.round(I)));
        const stings: number[][] = [
          [1046.5, 1318.5, 1567.98, 2093, 2637],
          [880, 1108.73, 1318.5, 1760],
          [783.99, 987.77, 1174.66],
          [659.25, 783.99, 987.77],
          [523.25, 659.25, 587.33],
        ];
        stings[g]!.forEach((f, i) => this.tone(f, t + i * 0.08, 0.7, { wave: 'triangle', vol: 0.11, rev: 0.45 }));
        if (g === 0) this.noise(t + 0.3, 0.5, { type: 'highpass', freq: 7000, vol: 0.05, attack: 0.2 });
        break;
      }
      case 'reveal': {
        this.tone(220, t, 0.9, { wave: 'sawtooth', vol: 0.05, slideTo: 880, attack: 0.3 });
        this.noise(t + 0.8, 0.3, { freq: 1500, vol: 0.14 });
        [783.99, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone(f, t + 0.85 + i * 0.06, 0.7, { wave: 'triangle', vol: 0.1, rev: 0.4 }));
        break;
      }

      // ───────────── Meta ─────────────
      case 'levelUp': { // fanfare arpeggio
        this.duck(2.2, 0.25);
        const seq = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
        seq.forEach((f, i) => {
          this.tone(f, t + i * 0.08, 0.35, { wave: 'square', vol: 0.06 });
          this.tone(f, t + i * 0.08, 0.4, { wave: 'triangle', vol: 0.13, rev: 0.3 });
        });
        [1046.5, 1318.5, 1568].forEach((f) => this.tone(f, t + 0.55, 0.9, { wave: 'triangle', vol: 0.12, rev: 0.5 }));
        break;
      }
      case 'achievement': {
        this.duck(1.5, 0.4);
        for (let i = 0; i < 7; i++) this.tone(1800 + i * 260 + Math.random() * 80, t + i * 0.045, 0.3, { vol: 0.07, rev: 0.5 });
        this.tone(2093, t + 0.32, 0.6, { wave: 'triangle', vol: 0.09, rev: 0.5 });
        break;
      }
      case 'podium': { // a drum roll then a pop; higher for better places (1..3)
        const place = Math.max(1, Math.min(3, Math.round(I)));
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.03, 0.03, { type: 'lowpass', freq: 900, vol: 0.06 });
        this.bell([1567.98, 1318.5, 1046.5][place - 1]!, t + 0.2, 0.6, 0.1);
        break;
      }
      case 'crown':
        [1318.5, 1567.98, 2093, 2637].forEach((f, i) => this.bell(f, t + i * 0.06, 0.8, 0.07));
        break;
      case 'whoosh':
        this.noise(t, 0.25, { type: 'bandpass', freq: 700, slideTo: 2200, q: 0.9, vol: 0.08, attack: 0.06 });
        break;
      case 'error': // soft "nuh-uh"
        this.tone(392, t, 0.1, { wave: 'triangle', vol: 0.13 });
        this.tone(330, t + 0.1, 0.14, { wave: 'triangle', vol: 0.13 });
        break;
    }
    this.out = null;
  }

  /** Soft generative lo-fi arpeggio (pentatonic) so music needs no asset files. */
  private startMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicTimer !== null) return;
    this.musicGain.gain.setTargetAtTime(this.musicLevel, this.ctx.currentTime, 0.8);
    const chords = [
      [261.63, 329.63, 392, 493.88],
      [220, 261.63, 329.63, 392],
      [174.61, 220, 261.63, 329.63],
      [196, 246.94, 293.66, 392],
    ];
    const tick = () => {
      const ctx = this.ctx;
      if (!ctx || !this.musicGain) return;
      const t = ctx.currentTime + 0.05;
      const chord = chords[Math.floor(this.musicStep / 8) % chords.length]!;
      const n = chord[(this.musicStep * 3) % chord.length]!;
      this.tone(n * 2, t, 0.6, { vol: 0.05, dest: this.musicGain, attack: 0.02 });
      if (this.musicStep % 8 === 0) chord.forEach((f) => this.tone(f, t, 2.6, { wave: 'triangle', vol: 0.025, dest: this.musicGain!, attack: 0.4 }));
      if (this.musicStep % 4 === 2) this.noise(t, 0.04, { type: 'highpass', freq: 7000, vol: 0.012, dest: this.musicGain }); // lo-fi hat
      this.musicStep++;
    };
    this.musicTimer = window.setInterval(tick, 340);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }
}

export const sound = new SoundEngine();
