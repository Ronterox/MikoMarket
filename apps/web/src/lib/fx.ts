/**
 * Effects bus: canvas particles (coins, sparkles, confetti), floating text and a
 * screen flash. One full-screen canvas, driven by rAF only while something is alive.
 * All coordinates are viewport CSS pixels.
 */

type Kind = 'coin' | 'spark' | 'confetti' | 'star';

interface Particle {
  kind: Kind;
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  size: number; rot: number; vr: number;
  color: string;
}

interface FloatText {
  text: string; x: number; y: number; vy: number;
  life: number; max: number; color: string; size: number;
}

import { token } from './theme.ts';
import { sound } from './sound.ts';

/** Confetti follows the theme tokens (sakura, peach, sky, mint, a touch of gold, cream). */
const confettiColors = () => [token('--brand'), token('--brand-2'), token('--info'), token('--up'), token('--gold'), token('--star')];

class FxEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private parts: Particle[] = [];
  private floats: FloatText[] = [];
  private raf = 0;
  private last = 0;
  private flashEl: HTMLDivElement | null = null;
  reduced = false;

  attach(canvas: HTMLCanvasElement, flash: HTMLDivElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.flashEl = flash;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  detach(): void {
    window.removeEventListener('resize', this.resize);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas = null;
    this.ctx = null;
  }

  private resize = () => {
    if (!this.canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private kick(): void {
    if (this.raf || !this.ctx) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Coin + sparkle fountain, e.g. on a winning trade. */
  burst(x: number, y: number, kind: 'win' | 'spark' | 'lesson' = 'win', count = 26): void {
    if (this.reduced) return;
    const palette = confettiColors();
    const lesson = token('--info');
    const coin = token('--gold');
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const sp = 3 + Math.random() * 6;
      const isCoin = kind === 'win' && i % 2 === 0;
      this.parts.push({
        kind: isCoin ? 'coin' : kind === 'lesson' ? 'star' : 'spark',
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 55 + Math.random() * 35,
        size: isCoin ? 7 + Math.random() * 4 : 3 + Math.random() * 3,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: kind === 'lesson' ? lesson : isCoin ? coin : palette[i % palette.length]!,
      });
    }
    this.kick();
  }

  confetti(count = 140): void {
    if (this.reduced) return;
    sound.play('pop');
    if (count >= 100) window.setTimeout(() => sound.play('pop'), 160 + Math.random() * 120);
    const w = window.innerWidth;
    const palette = confettiColors();
    for (let i = 0; i < count; i++) {
      this.parts.push({
        kind: 'confetti',
        x: Math.random() * w, y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3,
        life: 0, max: 160 + Math.random() * 80,
        size: 5 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        color: palette[i % palette.length]!,
      });
    }
    this.kick();
  }

  float(text: string, x: number, y: number, color = token('--brand-2'), size = 26): void {
    this.floats.push({ text, x, y, vy: this.reduced ? 0 : -1.1, life: 0, max: this.reduced ? 70 : 85, color, size });
    this.kick();
  }

  flash(color = 'rgba(255, 246, 236, 0.75)'): void {
    const el = this.flashEl;
    if (!el || this.reduced) return;
    el.style.background = color;
    el.classList.remove('fx-flash-on');
    void el.offsetWidth; // restart the animation
    el.classList.add('fx-flash-on');
  }

  /** Centre of an element, handy for bursting from a button. */
  centerOf(el: Element | null | undefined): { x: number; y: number } {
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private frame = (now: number) => {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) { this.raf = 0; return; }
    const dt = Math.min(3, (now - this.last) / 16.67);
    this.last = now;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    this.parts = this.parts.filter((p) => (p.life += dt) < p.max);
    for (const p of this.parts) {
      const grav = p.kind === 'confetti' ? 0.03 : 0.22;
      p.vy += grav * dt;
      if (p.kind === 'confetti') { p.vx += Math.sin((p.life + p.rot * 30) / 18) * 0.05; p.vx *= 0.99; }
      else { p.vx *= 0.985; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const alpha = Math.min(1, (p.max - p.life) / 25);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === 'coin') {
        const squash = Math.abs(Math.cos(p.life / 5));
        ctx.scale(Math.max(0.2, squash), 1);
        ctx.fillStyle = '#e8a63c';
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, p.size * 0.72, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a5a12';
        ctx.font = `900 ${p.size * 1.1}px Nunito, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 1);
      } else if (p.kind === 'confetti') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        // 4-point sparkle star
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 8;
        const s = p.size * 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.quadraticCurveTo(0, 0, s, 0); ctx.quadraticCurveTo(0, 0, 0, s);
        ctx.quadraticCurveTo(0, 0, -s, 0); ctx.quadraticCurveTo(0, 0, 0, -s);
        ctx.fill();
      }
      ctx.restore();
    }

    this.floats = this.floats.filter((f) => (f.life += dt) < f.max);
    for (const f of this.floats) {
      f.y += f.vy * dt;
      const k = f.life / f.max;
      const pop = f.life < 8 ? 0.6 + (f.life / 8) * 0.5 : 1.1 - Math.min(0.1, (f.life - 8) / 40);
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.translate(f.x, f.y);
      ctx.scale(pop, pop);
      ctx.font = `900 ${f.size}px "Baloo 2", Nunito, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(23, 20, 18, 0.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }

    if (this.parts.length || this.floats.length) this.raf = requestAnimationFrame(this.frame);
    else { this.raf = 0; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  };
}

export const fx = new FxEngine();
