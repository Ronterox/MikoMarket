import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Profile, ProfileStore } from '@miko/engine';
import { dataPaths } from './paths.ts';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidProfileId(id: string): boolean {
  return ID_RE.test(id);
}

/**
 * Light structural check of a Profile (what a client may PUT). Returns a list
 * of problems; empty means it looks like a Profile.
 */
export function profileProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['profile must be a JSON object'];
  const p = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof p.id !== 'string' || !isValidProfileId(p.id)) problems.push('id must be 1-64 chars of [A-Za-z0-9_-]');
  if (typeof p.name !== 'string') problems.push('name must be a string');
  for (const k of ['createdAt', 'xp', 'level', 'rating', 'streakDays']) {
    if (typeof p[k] !== 'number' || !Number.isFinite(p[k])) problems.push(`${k} must be a number`);
  }
  for (const k of ['stats', 'achievements', 'settings']) {
    if (!p[k] || typeof p[k] !== 'object' || Array.isArray(p[k])) problems.push(`${k} must be an object`);
  }
  for (const k of ['strategies', 'history']) {
    if (!Array.isArray(p[k])) problems.push(`${k} must be an array`);
  }
  return problems;
}

/** ProfileStore backed by data/profiles/<id>.json (atomic writes). */
export class FileProfileStore implements ProfileStore {
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? dataPaths().profiles;
  }

  private path(id: string): string {
    if (!isValidProfileId(id)) throw new Error(`Invalid profile id "${id}"`);
    return join(this.dir, `${id}.json`);
  }

  async load(id: string): Promise<Profile | null> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as Profile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(profile: Profile): Promise<void> {
    const path = this.path(profile.id);
    await mkdir(this.dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(profile, null, 2));
    await rename(tmp, path);
  }
}
