import { useApp, type Tab } from '../state/app.ts';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'play', icon: '▶', label: 'Play' },
  { id: 'lab', icon: '🤖', label: 'Bot Lab' },
  { id: 'leaders', icon: '🏆', label: 'Ranks' },
  { id: 'me', icon: '👤', label: 'Me' },
];

export function TabBar() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="rail-brand" aria-hidden="true"><span className="rail-logo">🌸</span><span className="rail-name">Miko</span></div>
      {TABS.map((t) => (
        <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
          <span className={`tab-ico ${t.id === 'play' ? 'tab-ico-play' : ''}`}>{t.icon}</span>
          <span className="tab-lbl">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
