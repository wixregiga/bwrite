import type { FeatureId } from "./feature-id";
import { RefusalError } from "./refusal";

/**
 * Where a proposed DomainTerm came from: the Feature and the exact text it was selected
 * from, and when it was proposed.
 */
export interface TermProposal {
  readonly featureId: FeatureId;
  /** The selected text exactly as it appeared in the feature. */
  readonly text: string;
  /** ISO 8601 time of the proposal. */
  readonly proposedAt: string;
}

export function termProposalOf(featureId: FeatureId, text: string, proposedAt: Date): TermProposal {
  if (Number.isNaN(proposedAt.getTime())) throw new RefusalError("A proposal needs the time it was made.");
  return { featureId, text, proposedAt: proposedAt.toISOString() };
}
