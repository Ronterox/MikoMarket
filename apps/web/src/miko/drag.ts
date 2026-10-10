import type { PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../state/app.ts';
import { sound } from '../lib/sound.ts';

/** Movement (px) before a press on Miko becomes a drag instead of a tap. */
const THRESHOLD = 6;
let lastDragEnd = 0;

/** True right after a drop, so the click that follows it is not a tap. */
export const justDragged = () => performance.now() - lastDragEnd < 350;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Press on Miko's avatar: a tap stays a tap, a move past the threshold picks her up.
 * Listeners live on window (not on the avatar) because she moves into the free layer
 * as soon as the drag starts, which remounts her.
 */
export function beginMikoDrag(e: ReactPointerEvent<HTMLElement>) {
  if (e.button !== 0) return;
  const r = e.currentTarget.getBoundingClientRect();
  const offX = e.clientX - (r.left + r.width / 2);
  const offY = e.clientY - (r.top + r.height / 2);
  const startX = e.clientX, startY = e.clientY, id = e.pointerId;
  let dragging = false, raf = 0, x = 0, y = 0;

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      dragging = true;
      document.body.classList.add('miko-dragging');
      sound.play('whoosh');
    }
    ev.preventDefault();
    x = ev.clientX - offX;
    y = ev.clientY - offY;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; useApp.getState().setMikoDrag({ x, y }); });
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    cancelAnimationFrame(raf);
    if (!dragging) return;
    document.body.classList.remove('miko-dragging');
    lastDragEnd = performance.now();
    const { tab, setMikoSpot, setMikoDrag } = useApp.getState();
    setMikoSpot(tab, { x: clamp01(x / window.innerWidth), y: clamp01(y / window.innerHeight) });
    setMikoDrag(null);
    sound.play('tick');
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
