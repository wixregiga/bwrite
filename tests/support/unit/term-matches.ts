import { findTermMatches, type MatchableTerm } from "../../../src/contexts/authoring/domain/terms";

/** Returns the matched substrings with their term ids, which makes assertions readable. */
export function matched(text: string, terms: readonly MatchableTerm[]) {
  return findTermMatches(text, terms).map((m) => [m.termId, text.slice(m.from, m.to)]);
}
