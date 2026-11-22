import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/index.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({}).PORT).toBe(3000);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow();
  });
});
