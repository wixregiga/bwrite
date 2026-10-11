import { RefusalError } from "./refusal";
import { cleanTermName } from "./terms";

/**
 * A DomainTerm's name preceded by the names of the terms it sits under, outermost first
 * and joined with dots: Sales.Order.Order Line, or Sales.Order Status.Shipped for one value
 * of a Value Object term. An author may use it as the wording of an occurrence.
 */
export class QualifiedName {
  /** The names from the outermost container down to the term, then the value if any. */
  readonly path: readonly string[];

  private constructor(path: readonly string[]) {
    this.path = path;
  }

  /** The one door: every part of the path is a name with its whitespace collapsed. */
  static of(path: readonly string[]): QualifiedName {
    const parts = path.map(cleanTermName);
    if (parts.length === 0 || parts.some((p) => p.length === 0)) {
      throw new RefusalError("A qualified name is made of nonempty names.");
    }
    return new QualifiedName(parts);
  }

  get text(): string {
    return this.path.join(".");
  }

  /** The names the term sits under, outermost first; empty when it sits under nothing. */
  get containers(): readonly string[] {
    return this.path.slice(0, -1);
  }
}
