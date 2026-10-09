import type { Mood } from '@miko/engine';
import { MikoAvatar } from './MikoAvatar.tsx';

const MOODS: Mood[] = ['happy', 'excited', 'thinking', 'worried', 'proud', 'teaching', 'cheer', 'sleepy'];

/** Dev-only sheet of every expression: open /?miko-gallery */
export function MikoGallery() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: 16, height: '100%', overflow: 'auto' }}>
      {MOODS.map((m) => (
        <div key={m} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--surface)', borderRadius: 20, padding: 8 }}>
          <MikoAvatar mood={m} size={150} />
          <b>{m}</b>
        </div>
      ))}
    </div>
  );
}
