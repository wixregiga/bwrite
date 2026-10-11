/**
 * The file at a ProjectPath that keeps a Project's UbiquitousLanguage, in one of the formats
 * BWrite reads and writes. arclint's domain.arclint.yaml comes first and is read and changed
 * only through arclint; BWrite's own ubiquitous-language.bwrite.yaml is read and changed by
 * BWrite and also keeps proposed terms. A folder set up for arclint uses arclint's file; any
 * other uses BWrite's.
 */
export interface VocabularyFile {
  format: "arclint" | "bwrite";
  /** The file, relative to the Project's folder. */
  file: string;
  /** False when the folder has no such file yet. */
  found: boolean;
  /** Whether the format keeps proposed terms; arclint's does not, so BWrite keeps them itself. */
  holdsProposals: boolean;
  /** Whether the format keeps terms without a kind or a bounded context; arclint's does not. */
  holdsUnplacedTerms: boolean;
}
