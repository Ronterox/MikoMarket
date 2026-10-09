import { useState } from 'react';

/** Tiny "?" that pops one short sentence. Explanations live here, never in walls of text. */
export function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help">
      <button className="help-btn" aria-label="Help" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>?</button>
      {open && <span className="help-pop" role="tooltip" onClick={() => setOpen(false)}>{text}</span>}
    </span>
  );
}
