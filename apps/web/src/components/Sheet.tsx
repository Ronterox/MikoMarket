import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { sound } from '../lib/sound.ts';

/** Bottom sheet: the one "menu" pattern in the app. Tap backdrop or swipe-ish close button to dismiss. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const was = useRef(open);
  useEffect(() => {
    if (open !== was.current) sound.play(open ? 'open' : 'dismiss');
    was.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        <button className="sheet-x" aria-label="Close" onClick={onClose}>✕</button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.getElementById('overlay-root') ?? document.body,
  );
}
