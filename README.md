# BWrite

BWrite is where a product team writes down what its software should do, in the words the team has agreed on. Features are written as free text: notes, Given/When/Then statements, Scenarios, and Rules. While writing, BWrite highlights every agreed term in the text with a badge for its Domain-Driven Design kind, shows what the term means, lets the author propose new terms, and places Rules on the terms that enforce them.

The vocabulary is never a copy. BWrite reads and writes the project's own vocabulary file on disk:

- `domain.arclint.yaml`, read and changed through the `arclint` command, when the folder is set up for arclint;
- `ubiquitous-language.bwrite.yaml`, BWrite's own format, otherwise. It also keeps proposed terms.

Every write shows the exact change first and waits for confirmation.

## Requirements

- Node 24 (`mise install` provides it)
- `arclint` on `PATH`, for projects that use `domain.arclint.yaml`

## Run

```bash
mise run install   # npm ci and the Chromium build Playwright uses
npm run build      # the page into dist/, the server side into dist-server/
mise run bwrite    # serves BWrite for the folder you are in
```

Open the address it prints. BWrite serves the folder it was started in, so start it inside the project whose features you are writing, or mount that project into a container and start it there. Pass options after `--`:

```text
--root <folder>  a folder BWrite may read; repeat for several. Default: BWRITE_ROOTS, or the working directory.
--port <number>  the port to listen on; 0 picks a free one.
```

BWrite listens on `127.0.0.1` only and answers only same-origin requests.

## Develop

```bash
mise run dev       # Vite dev server with live reload and the same API
mise run test      # unit tests (Vitest)
mise run e2e       # acceptance tests (Playwright)
mise run check     # typecheck, unit tests, build, acceptance tests
mise run gates     # every architecture gate: rule tests, arclint check, Stage 2 proofs
```

Work follows the arclint workflow in [AGENTS.md](AGENTS.md). The recorded domain is [domain.arclint.yaml](domain.arclint.yaml); the code layout and the reasons for it are in [docs/architecture.md](docs/architecture.md). An inactive Effect v4 ruleset waits under [.arclint/proposals/effect](.arclint/proposals/effect/README.md).

## License

[MPL-2.0](LICENSE)
