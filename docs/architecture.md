# Layout: domain-driven vertical slices

The rules in `rules.arclint.yaml` enforce this layout. The layout was designed from first principles for one goal: a person or an LLM agent opening this repository in five years can find where a responsibility lives from its name alone, and cannot put it anywhere else.

```text
src/
  app/                          Browser composition root: React root, adapter wiring, use-case provision
  pages/<screen>/               One folder per screen, composing context public APIs
  shared/
    presentation/               React primitives with no product meaning
    observability/              Logging and telemetry mechanisms
    transport/                  Process-neutral wire mechanisms (envelope, error shape, decoding primitives)
  contexts/<context>/           One bounded context, named exactly as recorded in domain.arclint.yaml
    index.ts                    The one public API (explicit named exports only)
    domain/                     Model: aggregates, entities, value objects, events, domain services, repository ports
    application/                Use cases and the ports they need beyond repositories
    formats/                    File-format codecs: file text to and from domain values
    contracts/                  Wire schema of this context's HTTP endpoints and server-sent events
    browser/                    Browser driven adapters: HTTP client of the Node process, localStorage, EventSource
    node/                       Node adapters: HTTP and SSE handlers, filesystem repositories, CLI tool runners
    ui/                         React views
    editor/                     CodeMirror 6 integration
server/
  app/                          Node composition root: HTTP server, handler mounting, process lifecycle
  shared/                       Node mechanisms with no product meaning (atomic write, process execution, SSE writing)
tests/
  integration/                  Suites across the process boundary (*.test.ts)
  e2e/                          Playwright suites of observable behavior (*.test.ts)
  support/                      Harness modules, never test cases
domain.arclint.yaml             The recorded ubiquitous language; contexts exist here before they exist as folders
```

Unit tests sit beside their subject with the same stem: `document.ts` and `document.test.ts`.

## Zones

| Zone | Paths | May import (Zones) | Third-party and runtime |
| --- | --- | --- | --- |
| domain | `src/contexts/*/domain/**` | none | none |
| application | `src/contexts/*/application/**` | domain | none |
| formats | `src/contexts/*/formats/**` | domain, application | `yaml`; no Node |
| contracts | `src/contexts/*/contracts/**` | transport | none |
| transport | `src/shared/transport/**` | none | none |
| browser | `src/contexts/*/browser/**` | domain, application, formats, contracts, transport | none (platform fetch, EventSource, localStorage) |
| node | `src/contexts/*/node/**` | domain, application, formats, contracts, transport, server_shared | Node built-ins only |
| ui | `src/contexts/*/ui/**` | domain, application, editor, shared | `react` |
| editor | `src/contexts/*/editor/**` | domain, application | `@codemirror/*`, `@lezer/*` |
| public_api | `src/contexts/*/index.ts` | domain, application, ui, editor | none |
| pages | `src/pages/**` | public_api, shared | `react` |
| shared | `src/shared/presentation/**`, `src/shared/observability/**` | none | `react` |
| app | `src/app/**` | pages, public_api, domain, application, formats, browser, transport, shared | `react`, `react-dom/client` |
| server_shared | `server/shared/**` | transport | Node built-ins only |
| server_app | `server/app/**` | domain, application, formats, contracts, transport, node, server_shared | Node built-ins only |
| acceptance_tests | `tests/**` | contracts, transport, server_app | unrestricted |

Protected Zones (`imported_by`): `browser` only from `app`; `node` only from `server_app`; `server_shared` only from `node` and `server_app`; `contracts` only from `browser`, `node`, `server_app` and `acceptance_tests`. Bounded contexts never import each other (`independent: src/contexts/*`). The Zone graph is acyclic.

## Decisions

1. **One model, two processes.** The browser and the Node process are two composition roots of the same bounded contexts, not two contexts. `domain`, `application` and `formats` are process-neutral by import contract (no stdlib, no browser-only package), so both processes run the same model and parse the same files the same way. The server is not reduced to a file proxy that never sees an aggregate.
2. **Vertical slice by context, segment by runtime.** Everything about one context lives under `src/contexts/<context>/`. Segment names state where code runs: `domain`, `application`, `formats` and `contracts` run anywhere; `browser`, `ui` and `editor` run in the page; `node` runs in the server. An agent decides placement by asking "what does this code touch", and the rules confirm the answer.
3. **FSD reconciled with DDD.** FSD layers survive where they describe composition: `app`, `pages`, `shared`. FSD `entities` and `features` are replaced by bounded contexts, because an FSD entity mixes display and API concerns and an FSD feature cuts across a consistency boundary. FSD's public API rule survives as `index.ts` with explicit named exports. FSD's same-layer isolation survives as `context-independence`. FSD `widgets` are not used (FSD 2.1 discourages them).
4. **Composition without magic files.** Composition roots (`src/app`, `server/app`) import adapters directly, as the vertical reference pattern's composition Zone does. Nothing else can, because `imported_by` protects every adapter Zone. There is no per-context `compose.ts` convention to learn.
5. **Repository ports belong to the model.** A repository interface is part of the ubiquitous language of its aggregate, so it sits in `domain`. Ports for anything else (clock, CLI tool runner, notifier) sit in `application`.
6. **Wire schema is separate from the model.** `contracts` imports only `transport`, never `domain`. Adapters map between wire shapes and domain values, so a model rename never silently changes the wire, and a wire field never leaks into an aggregate.
7. **Cross-context relations are recorded first.** Contexts are independent. A real upstream and downstream relation is recorded in `domain.arclint.yaml` (the built-in rule `context_relation/imports-follow-influence` then judges its direction), and only then may a reasoned `exclude` on `context-independence` admit the downstream import of the upstream's `index.ts`.
8. **Vocabulary maps to paths.** A context folder exists only for a recorded context, spelled in kebab-case. Every recorded context has `index.ts` and a `domain/` file. Every recorded aggregate, value object and event has a file named for it in a `domain/` segment. An agent that knows a term knows its file.
9. **Each Zone declares its third-party vocabulary.** `ddd/packages` lists the exact packages a Zone may import. Adding a library to a segment is an edit to the ruleset, visible in review, not a drive-by import.
10. **arclint judges production code and acceptance suites; unit tests are checked by their own suite.** Colocated unit tests (`src/**/*.test.ts`, `src/**/*.test.tsx`) and their shared harness in `tests/support/unit/` are listed under `scan.exclude`. They observe subjects across zones by design (for example, the reducer test checks every reduced workspace against the browser store), and arclint's Zone graph and built-in rules count every scanned import edge, so scanning them would report cycles and boundary crossings that production code does not have. Every production file stays fully judged by every rule. The acceptance suites under `tests/integration/` and `tests/e2e/`, and their wire harness in `tests/support/`, stay scanned and judged, so they still test only through the wire. Because `test-placement` cannot see unscanned files, `tests/integration/unit-test-placement.test.ts` reads the real `src/` tree and checks that every unit test has a same-stem subject beside it and that no production file imports a unit test or `tests/support/unit/`. The Node zones' runtime rules exclude `*.test.ts` under `server/`, because a test runner is the test's dependency, not the subject's.
11. **Severity.** Every rule is `error`. Each one encodes a contract an agent can satisfy mechanically; a warning would teach agents that the layout is optional.

## Naming

- Files and folders: lowercase hyphenated words. File stems may end in `.test` (tests) or `.d` (declarations).
- No bucket names: `utils`, `helpers`, `misc`, `common`, `lib`, `types`, `constants`.
- No `index.ts` except a context's public API. No `export *` in it.
- Named exports only; no `export default`, no `as default`.
- `.tsx` only where React renders: `ui`, `pages`, `shared`, `app`.

## Enforceability

| Guideline | Enforced by |
| --- | --- |
| Dependency direction, runtime purity, package vocabulary, process wall, context isolation | `imports`, `imported_by`, `independent`, `acyclic` rules and `ddd/packages` over resolved import facts |
| Recorded vocabulary maps to folders and files | `ddd/recorded-contexts`, `structure` rules expanded from `domain.arclint.yaml` |
| Aggregate roots, invariants, value objects, context-map direction | arclint built-in domain rules over the recorded domain |
| File cycles, placement, test placement | `ddd/file-cycles`, `ddd/placement`, `ddd/test-placement` |
| Strict types, DOM versus Node globals | The application's per-process `tsconfig` (browser `lib: ["DOM"]`, Node `types: ["node"]`, process-neutral segments with neither); not arclint |
| Behavior, IO failures, user-visible outcomes | Vitest and Playwright against real files, HTTP and the browser |

Known gaps are listed in `CHANGES.md` with the arclint feature each one needs.

## Sources

- FSD layers, slices and public API: https://feature-sliced.design/docs/reference/layers, https://feature-sliced.design/docs/reference/slices-segments, https://feature-sliced.design/docs/reference/public-api
- Vertical slices with hexagonal layers and a composition Zone: `reference/arclint/vertical/0.1.0/pattern.yaml` in the sandbox (Go only, used as a model).
- Rule expressiveness: `rules.arclint.schema.json` and `arclint domain schema` (arclint 0.1.0-beta.1).
