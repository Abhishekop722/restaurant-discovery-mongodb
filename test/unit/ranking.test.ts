import { describe, expect, it } from 'vitest';

import { weightedScore } from '../../src/modules/restaurants/search/ranking.js';

const M = 100; // prior votes
const C = 3.4; // prior mean

describe('weightedScore', () => {
  it('does not let a handful of votes beat a well-established rating', () => {
    const hyped = weightedScore(5, 3, M, C);
    const proven = weightedScore(4.5, 300, M, C);
    expect(proven).toBeGreaterThan(hyped);
  });

  it('sits at the prior mean with no votes', () => {
    expect(weightedScore(5, 0, M, C)).toBeCloseTo(C);
  });

  it('approaches the real rating as votes grow', () => {
    expect(weightedScore(4.6, 1_000_000, M, C)).toBeCloseTo(4.6, 2);
  });

  it('is monotonic in both rating and votes (above the prior mean)', () => {
    expect(weightedScore(4.5, 100, M, C)).toBeGreaterThan(weightedScore(4.0, 100, M, C));
    expect(weightedScore(4.5, 200, M, C)).toBeGreaterThan(weightedScore(4.5, 100, M, C));
  });

  it('pulls a low rating up toward the mean when evidence is thin', () => {
    expect(weightedScore(1, 5, M, C)).toBeGreaterThan(1);
  });
});
