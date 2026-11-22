import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cleanRow } from '../../src/infra/seed/clean-row.js';
import { decodeCsv, loadCsvRows } from '../../src/infra/seed/load-csv.js';
import { resolveSeedFile } from '../../src/infra/seed/resolve-file.js';

describe('decodeCsv', () => {
  it('decodes valid UTF-8 as is', () => {
    expect(decodeCsv(Buffer.from('Café', 'utf8'))).toBe('Café');
  });

  it('falls back to Latin-1 for bytes that are not valid UTF-8', () => {
    expect(decodeCsv(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });

  it('strips a BOM', () => {
    expect(decodeCsv(Buffer.from('﻿id', 'utf8'))).toBe('id');
  });
});

describe('committed sample dataset', () => {
  it('cleans every row with no rejections and unique ids', async () => {
    const rows = await loadCsvRows(resolve('data/sample.csv'));
    expect(rows.length).toBeGreaterThan(300);

    const results = rows.map((row) => cleanRow(row, 'biteexpress'));
    const rejected = results.filter((r) => !r.ok);
    expect(rejected).toEqual([]);

    const ids = results.flatMap((r) => (r.ok ? [r.doc.externalId] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exercises the awkward cases the seed must handle', async () => {
    const rows = await loadCsvRows(resolve('data/sample.csv'));
    const docs = rows.flatMap((row) => {
      const r = cleanRow(row, 'biteexpress');
      return r.ok ? [r.doc] : [];
    });
    expect(docs.some((d) => !d.location)).toBe(true);
    expect(docs.some((d) => d.rating.average === undefined)).toBe(true);
    expect(docs.some((d) => d.cuisines.length === 0)).toBe(true);
    expect(docs.some((d) => d.address.city === 'Gurgaon')).toBe(true);
  });
});

describe('resolveSeedFile', () => {
  it('prefers an explicit path', () => {
    expect(resolveSeedFile('x.csv', '/app')).toBe('/app/x.csv');
  });

  it('falls back to the sample when the full dataset is absent', () => {
    expect(resolveSeedFile(undefined, '/nonexistent')).toBe('/nonexistent/data/sample.csv');
  });
});
