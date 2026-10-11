# Stage 2: Effect v4 moonshot

`rules.effect.arclint.yaml` is Stage 1 plus a declared delta (7 Rules replaced, 3 removed, 12 added). `scripts/check-stage2-delta.ts` proves nothing else differs. Adopt it after Stage 1 is green by replacing `rules.arclint.yaml` with it.

## What "the beta portion" means on 2026-10-10

The request named "Effect V4, the beta portion of it". The registry shows the beta channel has been superseded:

| Fact | Evidence |
| --- | --- |
| `effect` dist-tags: latest `4.0.2`, rc `4.0.0-rc.118`, beta `4.0.0-beta.107` | `npm view effect dist-tags` (2026-10-10) |
| Publish times: beta.107 2026-08-10, rc.118 2026-09-28, 4.0.0 2026-10-01, 4.0.2 2026-10-07 | `npm view effect time` |
| Source repository of 4.0.2 is Effect-TS/effect, `packages/effect`; tag `effect@4.0.0` exists | package.json of the published tarball; `git ls-remote https://github.com/Effect-TS/effect` |
| Effect-TS/effect-smol HEAD is still `3a1128c`, round 1's snapshot | `git ls-remote https://github.com/Effect-TS/effect-smol HEAD` |
| 4.0.2 tags every declaration `@stability stable` (6691) or `@stability unstable` (5375) | grep over the published `dist/*.d.ts` |

Decision: pin stable `4.0.2` exactly, and read "the beta portion" as the APIs the release itself tags `@stability unstable`. Pinning `4.0.0-beta.107` would install a build its publisher replaced, which the no-backwards-compatibility rule forbids. The stability tags give the beta portion a definition the toolchain states, instead of one invented here.

Stability by module in 4.0.2 (stable/unstable declarations):

| Stable core | Unstable tier |
| --- | --- |
| Effect 523/4, Context 50/0, Layer 100/0, Data 13/0, ManagedRuntime 5/0, Exit 40/0, Option 134/0, Stream 552/6, Schema 478/132 | FileSystem 0/15, Path 0/6, http/HttpClient 0/97, http/FetchHttpClient 0/4, http/HttpRouter 0/44, http/HttpServer 0/20, process/ChildProcess 0/41 |

The unstable tier is exactly the IO the app needs. Hexagonal layering already confines IO to adapters, so the moonshot costs no architecture: unstable modules live only in `node`, `server_shared` and `server_app`; process-neutral segments use the stable core.

Stage 2 admits only modules that `validation/effect-api` compiles and runs against 4.0.2: `Effect`, `Context`, `Data`, `Exit`, `Option`, `Layer`, `Schema`, `ManagedRuntime`, `FileSystem` and `@effect/platform-node/NodeFileSystem`. `effect/http/*`, `effect/process/*`, `effect/Stream` and `@effect/platform-browser/*` are not admitted yet: browser adapters wrap the platform `fetch`, `EventSource` and `localStorage` with `Effect.tryPromise`, and Node HTTP, SSE and CLI adapters keep Node built-ins. Each module family joins its allow-list together with a compiled, tested path that uses it (for example one SSE endpoint served by `HttpRouter` and consumed in the browser).

## Verified API facts relied on

All verified against the published `effect@4.0.2` and `@effect/platform-node@4.0.2` declarations, and exercised by `validation/effect-api` (strict tsc with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `skipLibCheck: false`; Node 24 test runner).

| API | Stability | Where the ruleset admits it |
| --- | --- | --- |
| `Context.Service<Self, Shape>()("key")`, yieldable as `yield* Key` | stable | application (ports) |
| `Effect.gen`, `Effect.fn("name")`, `Effect.fnUntraced`, `Effect.try`, `Effect.mapError` | stable | application, formats, adapters |
| `Data.TaggedError("Tag")<Fields>` | stable | application (expected failures) |
| `Schema.TaggedError<Self>()("Tag", fields)`, `Schema.Struct`, `Schema.Record`, `Schema.decodeUnknownEffect` | stable | formats, contracts, transport |
| `Layer.effect`, `Layer.provide`, `ManagedRuntime.make`, `runtime.runPromise`, `runtime.dispose` | stable | adapters, roots |
| `FileSystem.FileSystem`, `@effect/platform-node/NodeFileSystem.layer` | unstable | node, server_shared, server_app |
| `Effect.runPromiseExit`, `Exit.isSuccess`, `Exit.findErrorOption` | stable | roots and tests only (`Exit` also in application and ui) |

Round 1 relied on `Schema.TaggedErrorClass` and on `effect-smol` beta source; neither describes the current release (`TaggedErrorClass` is absent from 4.0.2 `Schema.d.ts`). Official agent guidance shipped in the package (`node_modules/effect/AGENTS.md`) prefers `Effect.gen` inline, `Effect.fn("name")` for reusable traced functions and `Schema.TaggedError` for errors; the ruleset follows it.

Sources: https://www.npmjs.com/package/effect, https://github.com/Effect-TS/effect/tree/main/packages/effect, https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0, https://effect.website/docs. Context7 was not queried; every fact above was checked against the published package instead.

## Release defect found while verifying

`@effect/platform-node@4.0.2` depends on `@effect/platform-node-shared@^4.0.2`, which npm resolves to `4.0.3`, whose peer range `effect@^4.0.3` no published `effect` satisfies (published 4.0.x: 4.0.0, 4.0.1, 4.0.2). `npm install --strict-peer-deps` fails with ERESOLVE. The fix is an exact `overrides` entry `"@effect/platform-node-shared": "4.0.2"`; `effect-exact-pins` treats overrides as part of the family, so the override must equal the family version. [INFERENCE] This resolves when `effect@4.0.3` is published; move the whole family together then.

## The delta

| Rule | Change | Why |
| --- | --- | --- |
| application-platform, application-packages | external allowed only for `effect/Effect`, `effect/Context`, `effect/Data`, `effect/Exit`, `effect/Option` | Use cases speak the stable core; every capability still arrives through a port |
| formats-packages | adds `effect/Effect`, `effect/Schema` | Codecs decode with Schema and call the domain's constructor |
| contracts-*, transport-* | `effect/Schema` only | One decoding vocabulary for both processes |
| browser-*, node-*, server_shared-*, server_app-*, app-packages, ui-packages | named, compiled Effect modules per Zone | The unstable IO tier (`FileSystem`, `NodeFileSystem`) stays in Node adapters and the Node root |
| effect-exact-pins | new | One exact version across `effect`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/platform-browser`, `@effect/vitest` |
| effect-stable-core | new | Forbids qualified uses (`Schema.Headers`) of the 69 unstable exports of Effect, Stream and Schema in application, formats, contracts, transport and ui; derived from the installed declarations by `scripts/unstable-symbols.ts`, which fails the gate on drift |
| effect-namespace-imports | new (`ddd/namespace-imports`) | Modules of `effect`, `@effect/platform-node` and `@effect/platform-browser` are imported as `import * as <Module>` with the alias equal to the module name, single or multi-line; so `E.runPromise` cannot evade the run and stability rules. Tests are excluded because `@effect/vitest` documents named imports |
| effect-run-at-roots | new | `Effect.runCallback*`, `runFork*`, `runPromise*`, `runSync*` only in `app`, `server_app` and tests; ui receives a runner from the root's `ManagedRuntime`. `Stream.run*` returns an Effect and is not a run site |
| effect-named-functions | new | `Effect.fn` takes a name, so traces read in the ubiquitous language |

The domain stays free of Effect. A value object keeps a plain TypeScript constructor that enforces its invariant; codecs in `formats` and `contracts` decode with Schema and then call that constructor. Schema in the domain would make every view depend on Effect transitively through model types, and Brand adds nothing a branded TypeScript type does not.

## Adoption order

1. Stage 1 green on the real repository, with its per-process tsconfigs.
2. `npm install` the exact family with the override above; commit the lockfile.
3. Convert one complete path (for example: load a document from disk, decode it, show it, save it) end to end: port in `application`, codec in `formats`, Node adapter in `node`, wire schema in `contracts`, browser adapter in `browser`, one `ManagedRuntime` in `src/app`, one `ManagedRuntime` in `server/app`. Verify with real files, real HTTP and Playwright, including missing files, malformed YAML, process failures and aborted requests.
4. Switch the ruleset to Stage 2 when that path is green; convert the remaining paths one at a time.

## Open items

- [UNVERIFIED] That Effect improves readability for many different LLM agents. No measurement exists here; the claim rests on explicit error channels, named functions and declared stability tiers being visible in source.
- Bundle size and type-check time of Effect in the real Vite build are unmeasured.
- `@effect/atom-react` (latest 4.0.3) was not evaluated; ui uses React state plus a runner from the root.
