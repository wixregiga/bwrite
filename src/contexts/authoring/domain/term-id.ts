import { RefusalError } from "./refusal";
import { normalizeTermName } from "./terms";

/** The identity of one DomainTerm within its UbiquitousLanguage. */
export type TermId = string & { readonly brand: "TermId" };

export function termIdOf(value: string): TermId {
  if (value.length === 0) throw new RefusalError("A term ID is never empty.");
  return value as TermId;
}

/**
 * A term's TermId, from its bounded context's name and its own name (an Entity's bounded
 * context is its Aggregate's; a term in no bounded context has none). Names are unique within
 * a bounded context, so the id is the same on every load of the same VocabularyFile, and a
 * TermReference keeps pointing at its term while the term's definition, kind, and PlacedRules
 * change. A change that moves a term to another bounded context gives it a new id, and the
 * change set says which, so the caller retargets the Features' TermReferences.
 */
export function termIdFor(context: string | null | undefined, name: string): TermId {
  const part = (text: string) => encodeURIComponent(normalizeTermName(text));
  return termIdOf(`term:${context ? part(context) : ""}/${part(name)}`);
}
