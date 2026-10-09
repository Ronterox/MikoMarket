import { create } from 'zustand';
import {
  applySession, Coach, createProfile, levelProgress,
  type AchievementDef, type ApplySessionInput, type Mood, type Profile, type Tip, type XpAward,
} from '@miko/engine';
import { HybridProfileStore, getOrCreateProfileId } from '../lib/profileStore.ts';
import { sound } from '../lib/sound.ts';
import { fx } from '../lib/fx.ts';
import { lsGet, lsSet } from '../lib/storage.ts';

export type Tab = 'play' | 'lab' | 'me';
export type Theme = 'dark' | 'light';

export interface ResultsData {
  title: string;
  awards: XpAward[];
  ratingDelta: number;
  achievements: AchievementDef[];
  levelUp?: number;
  tip: Tip;
  netProfit: number;
  trades: number;
  wins: number;
  xpBefore: number;
  xpAfter: number;
  demo: boolean;
}

export type Overlay =
  | { kind: 'results'; data: ResultsData }
  | { kind: 'levelUp'; level: number; then?: Overlay | null }
  | null;

/** Shared Coach instance: Miko's brain lives in the engine. */
export const coach = new Coach({ seed: (Date.now() % 100000) + 7 });
export const profileStore = new HybridProfileStore();

interface AppState {
  tab: Tab;
  theme: Theme;
  profile: Profile;
  profileReady: boolean;
  // Miko
  tip: Tip | null;
  tipQueue: Tip[];
  mikoMood: Mood;
  mikoCollapsed: boolean;
  overlay: Overlay;

  setTab(t: Tab): void;
  setTheme(t: Theme): void;
  loadProfile(): Promise<void>;
  saveProfile(p: Profile): void;
  setSettings(patch: Partial<Profile['settings']>): void;
  setName(name: string): void;
  say(tip: Tip | null | undefined): void;
  sayText(text: string, mood?: Mood, priority?: number): void;
  nextTip(): void;
  setMood(m: Mood): void;
  toggleMiko(): void;
  setOverlay(o: Overlay): void;
  /** Runs engine applySession, persists, and returns the result for the UI to celebrate. */
  commitSession(input: ApplySessionInput): ReturnType<typeof applySession>;
}

const initialTheme = (lsGet<Theme>('miko.theme') ?? 'dark') as Theme;

function applyTheme(t: Theme) {
  try { document.documentElement.dataset.theme = t; } catch { /* SSR-safe */ }
}
applyTheme(initialTheme);

let tipSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  tab: 'play',
  theme: initialTheme,
  profile: createProfile(getOrCreateProfileId(), 'Trader', Date.now()),
  profileReady: false,
  tip: null,
  tipQueue: [],
  mikoMood: 'happy',
  mikoCollapsed: false,
  overlay: null,

  setTab: (tab) => { if (tab !== get().tab) { sound.play('tick'); set({ tab }); } },
  setTheme: (theme) => { applyTheme(theme); lsSet('miko.theme', theme); set({ theme }); },

  loadProfile: async () => {
    const id = getOrCreateProfileId();
    const loaded = await profileStore.load(id);
    const profile = loaded ? { ...createProfile(id, 'Trader', Date.now()), ...loaded, settings: { ...createProfile(id, 'Trader', 0).settings, ...loaded.settings } } : get().profile;
    sound.setEnabled(profile.settings.sound);
    sound.musicEnabled = profile.settings.music;
    fx.reduced = profile.settings.reducedMotion || prefersReducedMotion();
    set({ profile, profileReady: true });
    if (!loaded) void profileStore.save(profile);
  },

  saveProfile: (profile) => {
    set({ profile });
    void profileStore.save(profile);
  },

  setSettings: (patch) => {
    const p = get().profile;
    const settings = { ...p.settings, ...patch };
    if (patch.sound !== undefined) sound.setEnabled(patch.sound);
    if (patch.music !== undefined) sound.setMusic(patch.music);
    if (patch.reducedMotion !== undefined) fx.reduced = patch.reducedMotion || prefersReducedMotion();
    get().saveProfile({ ...p, settings });
  },

  setName: (name) => get().saveProfile({ ...get().profile, name: name.slice(0, 18) || 'Trader' }),

  say: (tip) => {
    if (!tip) return;
    if (!get().profile.settings.assistant) return;
    const { tip: cur, tipQueue } = get();
    const t = { ...tip, id: `${tip.id}#${++tipSeq}` };
    if (!cur) set({ tip: t, mikoMood: t.mood });
    else if (t.priority > cur.priority + 20) set({ tip: t, mikoMood: t.mood, tipQueue: [cur, ...tipQueue].slice(0, 4) });
    else set({ tipQueue: [...tipQueue, t].sort((a, b) => b.priority - a.priority).slice(0, 4) });
  },

  sayText: (text, mood = 'happy', priority = 40) => get().say({ id: 'ui', text, mood, priority }),

  nextTip: () => {
    const [next, ...rest] = get().tipQueue;
    set({ tip: next ?? null, tipQueue: rest, mikoMood: next?.mood ?? get().mikoMood });
  },

  setMood: (mikoMood) => set({ mikoMood }),
  toggleMiko: () => { sound.play('tick'); set({ mikoCollapsed: !get().mikoCollapsed }); },
  setOverlay: (overlay) => set({ overlay }),

  commitSession: (input) => {
    const before = get().profile;
    const res = applySession(before, input, Date.now());
    get().saveProfile(res.profile);
    return res;
  },
}));

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function todayLocal(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export { levelProgress };
