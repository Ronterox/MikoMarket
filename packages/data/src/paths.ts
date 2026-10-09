import { join, resolve } from 'node:path';

/** Repo-level data directory (override with MIKO_DATA_DIR). */
export function defaultDataDir(): string {
  return process.env.MIKO_DATA_DIR ? resolve(process.env.MIKO_DATA_DIR) : resolve(import.meta.dir, '../../../data');
}

export function dataPaths(dataDir: string = defaultDataDir()): { root: string; cache: string; import: string; profiles: string } {
  return { root: dataDir, cache: join(dataDir, 'cache'), import: join(dataDir, 'import'), profiles: join(dataDir, 'profiles') };
}
