/**
 * Synthesised WebAudio SFX: no audio files. Every sound is a tiny recipe of
 * oscillators + envelopes. The context is created lazily on the first user
 * gesture (browsers block autoplay before that).
 */

export type Sfx =
  | 'tick' | 'buy' | 'sell' | 'close' | 'win' | 'loss' | 'levelUp'
  | 'achievement' | 'combo' | 'whoosh' | 'reveal' | 'gen' | 'error';

type Wave = OscillatorType;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  enabled = true;
  musicEnabled = false;

  /** Call from any pointerdown; safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.0;
        this.musicGain.connect(this.master);
        if (this.musicEnabled) this.startMusic();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio unavailable: stay silent */
    }
  }

  setEnabled(on: boolean): void { this.enabled = on; }

  setMusic(on: boolean): void {
    this.musicEnabled = on;
    if (on) this.startMusic(); else this.stopMusic();
  }

  private tone(freq: number, start: number, dur: number, opts: { wave?: Wave; vol?: number; slideTo?: number; attack?: number; dest?: AudioNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.wave ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    const vol = opts.vol ?? 0.3;
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(opts.dest ?? this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private noise(start: number, dur: number, vol = 0.15, hp = 2000): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(start);
  }

  play(name: Sfx, intensity = 1): void {
    if (!this.enabled) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'tick':
        this.tone(1400, t, 0.04, { wave: 'triangle', vol: 0.08 });
        break;
      case 'buy': // bright upward "pew"
        this.tone(520, t, 0.16, { wave: 'square', vol: 0.12, slideTo: 1560 });
        this.tone(1040, t + 0.02, 0.12, { wave: 'sine', vol: 0.12, slideTo: 2080 });
        break;
      case 'sell': // downward "pew"
        this.tone(1300, t, 0.16, { wave: 'square', vol: 0.11, slideTo: 420 });
        this.tone(880, t + 0.02, 0.12, { wave: 'sine', vol: 0.1, slideTo: 300 });
        break;
      case 'close':
        this.tone(660, t, 0.08, { wave: 'triangle', vol: 0.16 });
        this.tone(990, t + 0.06, 0.1, { wave: 'triangle', vol: 0.12 });
        break;
      case 'win': { // cash register: ka-ching + bell sparkle
        this.noise(t, 0.06, 0.2, 3000);
        const notes = [1318.5, 1760, 2637];
        notes.forEach((f, i) => this.tone(f, t + 0.05 + i * 0.07, 0.5, { wave: 'sine', vol: 0.18 * Math.min(1.5, intensity) }));
        this.tone(2637 * 1.5, t + 0.3, 0.6, { wave: 'sine', vol: 0.06 });
        break;
      }
      case 'loss': // soft, friendly bonk
        this.tone(330, t, 0.22, { wave: 'sine', vol: 0.22, slideTo: 196 });
        this.tone(165, t, 0.18, { wave: 'triangle', vol: 0.12 });
        this.tone(523, t + 0.2, 0.25, { wave: 'sine', vol: 0.07 }); // a hopeful little ping after
        break;
      case 'levelUp': { // fanfare arpeggio
        const seq = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
        seq.forEach((f, i) => {
          this.tone(f, t + i * 0.08, 0.35, { wave: 'square', vol: 0.07 });
          this.tone(f, t + i * 0.08, 0.4, { wave: 'triangle', vol: 0.14 });
        });
        [1046.5, 1318.5, 1568].forEach((f) => this.tone(f, t + 0.55, 0.9, { wave: 'triangle', vol: 0.12 }));
        break;
      }
      case 'achievement': {
        for (let i = 0; i < 7; i++) this.tone(1800 + i * 260 + Math.random() * 80, t + i * 0.045, 0.3, { wave: 'sine', vol: 0.08 });
        this.tone(2093, t + 0.32, 0.6, { wave: 'triangle', vol: 0.09 });
        break;
      }
      case 'combo': { // riser, pitch climbs with combo size
        const base = 400 + Math.min(10, intensity) * 80;
        this.tone(base, t, 0.25, { wave: 'sawtooth', vol: 0.06, slideTo: base * 2.5 });
        this.tone(base * 2, t + 0.2, 0.2, { wave: 'triangle', vol: 0.1 });
        break;
      }
      case 'whoosh':
        this.noise(t, 0.25, 0.08, 800);
        break;
      case 'reveal': {
        this.tone(220, t, 0.9, { wave: 'sawtooth', vol: 0.05, slideTo: 880, attack: 0.3 });
        this.noise(t + 0.8, 0.3, 0.15, 1500);
        [783.99, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone(f, t + 0.85 + i * 0.06, 0.7, { wave: 'triangle', vol: 0.1 }));
        break;
      }
      case 'gen':
        this.tone(900 + intensity * 30, t, 0.05, { wave: 'sine', vol: 0.05 });
        break;
      case 'error':
        this.tone(240, t, 0.12, { wave: 'triangle', vol: 0.15 });
        this.tone(200, t + 0.1, 0.16, { wave: 'triangle', vol: 0.15 });
        break;
    }
  }

  /** Soft generative lo-fi arpeggio (pentatonic) so music needs no asset files. */
  private startMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicTimer !== null) return;
    this.musicGain.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.8);
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
      this.tone(n * 2, t, 0.6, { wave: 'sine', vol: 0.05, dest: this.musicGain, attack: 0.02 });
      if (this.musicStep % 8 === 0) chord.forEach((f) => this.tone(f, t, 2.6, { wave: 'triangle', vol: 0.025, dest: this.musicGain!, attack: 0.4 }));
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
