import { newId } from "./ids";
import { RefusalError } from "./refusal";

/** The identity of one Feature; two are equal when they are the same identifier. */
export type FeatureId = string & { readonly brand: "FeatureId" };

export function featureIdOf(value: string): FeatureId {
  if (value.length === 0) throw new RefusalError("A feature ID is never empty.");
  return value as FeatureId;
}

export function newFeatureId(): FeatureId {
  return featureIdOf(newId("feature"));
}
