import { readFile } from 'node:fs/promises';

import { parse } from 'csv-parse/sync';

/** Strict UTF-8 first; the Zomato dump is not valid UTF-8, so fall back to Latin-1 (never fails). */
export function decodeCsv(buffer: Buffer): string {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    content = buffer.toString('latin1');
  }
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content; // strip BOM
}

export async function loadCsvRows(file: string): Promise<Record<string, string>[]> {
  const content = decodeCsv(await readFile(file));
  return parse<Record<string, string>>(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
  });
}
