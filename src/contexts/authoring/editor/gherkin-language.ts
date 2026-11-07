import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { docStringDelimiter, lineKinds, matchLineKeyword, type LineKind } from "../domain/gherkin";

interface GherkinState {
  docString: string | null;
}

const PLACEHOLDER = /^<[^<>\s][^<>]*>/;
const QUOTED = /^"(?:[^"\\]|\\.)*"/;
const TAG = /^@[^\s@]+/;
const PLAIN = /^[^@|<"]+/;

const gherkinParser: StreamParser<GherkinState> = {
  name: "gherkin",
  startState: () => ({ docString: null }),
  copyState: (s) => ({ docString: s.docString }),
  token(stream, state) {
    const line = stream.string;
    if (stream.sol()) {
      const delimiter = docStringDelimiter(line);
      if (state.docString !== null) {
        if (delimiter === state.docString) state.docString = null;
        stream.skipToEnd();
        return "string";
      }
      if (delimiter !== null) {
        state.docString = delimiter;
        stream.skipToEnd();
        return "string";
      }
      if (stream.eatSpace()) return null;
    }

    const firstNonSpace = line.length - line.trimStart().length;
    if (stream.pos === firstNonSpace) {
      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
      }
      const keyword = matchLineKeyword(line);
      if (keyword) {
        stream.pos = keyword.to;
        return keyword.kind === "section" ? "heading" : "keyword";
      }
    }

    const atWordStart = stream.pos === 0 || /\s/.test(line.charAt(stream.pos - 1));
    if (atWordStart && stream.match(TAG)) return "meta";
    if (stream.eat("|")) return "separator";
    if (stream.match(PLACEHOLDER)) return "variableName.special";
    if (stream.match(QUOTED)) return "string";
    if (!stream.match(PLAIN)) stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};

export const gherkinLanguage = StreamLanguage.define(gherkinParser);

const gherkinHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: "bw-tok-section" },
  { tag: tags.keyword, class: "bw-tok-step" },
  { tag: tags.comment, class: "bw-tok-comment" },
  { tag: tags.meta, class: "bw-tok-tag" },
  { tag: tags.string, class: "bw-tok-string" },
  { tag: tags.special(tags.variableName), class: "bw-tok-placeholder" },
  { tag: tags.separator, class: "bw-tok-table" },
]);

const LINE_CLASSES: Partial<Record<LineKind, string>> = {
  section: "bw-line-section",
  statement: "bw-line-statement",
  note: "bw-line-note",
};

const lineDecorations = new Map(
  Object.entries(LINE_CLASSES).map(([kind, cls]) => [kind, Decoration.line({ class: cls, attributes: { "data-line-kind": kind } })]),
);

function decorateLines(doc: Text): DecorationSet {
  const kinds = lineKinds(doc.toString());
  const ranges = [];
  for (let i = 0; i < kinds.length; i++) {
    const decoration = lineDecorations.get(kinds[i]);
    if (decoration) ranges.push(decoration.range(doc.line(i + 1).from));
  }
  return Decoration.set(ranges);
}

/**
 * Marks each line as a section heading, a Given/When/Then statement, or a note, so mixed
 * writing reads clearly. Nothing is validated: any line may be any kind, in any order.
 */
const lineKindField = StateField.define<DecorationSet>({
  create: (state) => decorateLines(state.doc),
  update: (value, tr) => (tr.docChanged ? decorateLines(tr.newDoc) : value),
  provide: (field) => EditorView.decorations.from(field),
});

export const gherkin = [gherkinLanguage, syntaxHighlighting(gherkinHighlightStyle), lineKindField];
