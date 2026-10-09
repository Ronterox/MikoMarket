import { readFileSync } from 'node:fs';

/**
 * Read KEY=VALUE assignments from a .env-style file (comments, `export ` and
 * quotes handled). Only keys accepted by `keep` are returned, so pointing this
 * at a file full of unrelated secrets takes nothing else out of it.
 */
export function readEnvFile(path: string, keep: (key: string) => boolean = () => true): Record<string, string> {
  const found: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (!keep(key)) continue;
    if (value.length > 1 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    found[key] = value;
  }
  return found;
}
