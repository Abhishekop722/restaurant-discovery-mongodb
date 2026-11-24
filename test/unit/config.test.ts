import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/index.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({}).PORT).toBe(3000);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow();
  });

  it('treats blank Groq variables as unset, as docker compose passes them', () => {
    const config = loadConfig({ GROQ_API_KEY: '', GROQ_MODEL: '', GROQ_TIMEOUT_MS: '' });
    expect(config.GROQ_API_KEY).toBeUndefined();
    expect(config.GROQ_MODEL).toBe('llama-3.1-8b-instant');
    expect(config.GROQ_TIMEOUT_MS).toBe(2000);
  });

  it('reads the Groq settings when present', () => {
    const config = loadConfig({ GROQ_API_KEY: 'k', GROQ_MODEL: 'llama-x', GROQ_TIMEOUT_MS: '500' });
    expect(config).toMatchObject({
      GROQ_API_KEY: 'k',
      GROQ_MODEL: 'llama-x',
      GROQ_TIMEOUT_MS: 500,
    });
  });
});
