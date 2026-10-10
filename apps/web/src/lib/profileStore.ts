import type { Profile, ProfileStore } from '@miko/engine';
import { lsGet, lsSet } from './storage.ts';

const key = (id: string) => `miko.profile.${id}`;

/** localStorage-only store (offline fallback). */
export class LocalProfileStore implements ProfileStore {
  async load(id: string): Promise<Profile | null> { return lsGet<Profile>(key(id)); }
  async save(profile: Profile): Promise<void> { lsSet(key(profile.id), profile); }
}

/**
 * Server first (GET/PUT /api/profile/:id), localStorage always as a mirror.
 * When both exist the one with more XP / newer history wins.
 */
export class HybridProfileStore implements ProfileStore {
  private local = new LocalProfileStore();
  serverOk = false;
  /** When the server is down, retry it at most once a minute (avoids console spam). */
  private lastFail = 0;

  async load(id: string): Promise<Profile | null> {
    const local = await this.local.load(id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(id)}`, { signal: ctrl.signal });
      const type = res.headers.get('content-type') ?? '';
      // 404 = server up, profile not created yet. 5xx / HTML = server unreachable (dev proxy).
      if (res.status === 404 && type.includes('json')) {
        this.serverOk = true;
        if (local) void this.save(local); // first contact: upload the offline progress
      } else if (res.ok && type.includes('json')) {
        this.serverOk = true;
        const remote = (await res.json()) as Profile | { profile: Profile | null } | null;
        const p = remote && 'profile' in remote ? remote.profile : (remote as Profile | null);
        if (p && typeof p.xp === 'number' && (!local || p.xp >= local.xp)) return p;
      } else {
        this.serverOk = false;
        this.lastFail = Date.now();
      }
    } catch {
      this.serverOk = false;
      this.lastFail = Date.now();
    } finally {
      clearTimeout(timer);
    }
    return local;
  }

  /** One upload in flight at a time; saves made meanwhile collapse into the newest one. */
  private uploading: Promise<void> | null = null;
  private pending: Profile | null = null;

  async save(profile: Profile): Promise<void> {
    await this.local.save(profile);
    if (!this.serverOk && Date.now() - this.lastFail < 60_000) return;
    this.pending = profile;
    if (!this.uploading) {
      this.uploading = (async () => {
        // Strictly in order, so an older profile can never land after a newer one.
        while (this.pending) {
          const next = this.pending;
          this.pending = null;
          await this.upload(next);
        }
      })().finally(() => { this.uploading = null; });
    }
    return this.uploading;
  }

  private async upload(profile: Profile): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(profile.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile),
        signal: ctrl.signal,
      });
      this.serverOk = res.ok;
      if (!res.ok) this.lastFail = Date.now();
    } catch {
      this.serverOk = false;
      this.lastFail = Date.now();
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getOrCreateProfileId(): string {
  const existing = lsGet<string>('miko.profileId');
  if (existing) return existing;
  const id = `player-${Math.random().toString(36).slice(2, 10)}`;
  lsSet('miko.profileId', id);
  return id;
}
