/**
 * Bayesian weighted rating (the IMDb "top rated" formula):
 *
 *   score = v / (v + m) * R + m / (v + m) * C
 *
 * R = the restaurant's average rating, v = its votes, m = the votes needed before we trust
 * a rating (prior weight), C = the mean rating across all rated restaurants (prior mean).
 * With few votes the score stays near C; with many it approaches R. So a 5.0 from 3 votes
 * does not outrank a 4.5 from 300.
 *
 * The MongoDB aggregation in restaurant.mongo-query.ts computes the same expression
 * in the database; an integration test keeps the two in agreement.
 */
export function weightedScore(
  rating: number,
  votes: number,
  priorVotes: number,
  priorMean: number,
): number {
  return (votes / (votes + priorVotes)) * rating + (priorVotes / (votes + priorVotes)) * priorMean;
}
