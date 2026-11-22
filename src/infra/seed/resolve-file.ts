import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Explicit path wins; otherwise the full dataset if present, else the committed sample. */
export function resolveSeedFile(explicit: string | undefined, cwd = process.cwd()): string {
  if (explicit) return resolve(cwd, explicit);
  const full = resolve(cwd, 'data/zomato.csv');
  return existsSync(full) ? full : resolve(cwd, 'data/sample.csv');
}
