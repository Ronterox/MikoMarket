import { useEffect, useRef } from 'react';
import { fx } from '../lib/fx.ts';

export function FxLayer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (canvas.current && flash.current) fx.attach(canvas.current, flash.current);
    return () => fx.detach();
  }, []);
  return (
    <>
      <canvas ref={canvas} className="fx-canvas" aria-hidden="true" />
      <div ref={flash} className="fx-flash" aria-hidden="true" />
    </>
  );
}
