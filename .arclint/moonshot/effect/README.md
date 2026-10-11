# Stage 2: Effect moonshot (inactive)

This folder holds Stage 2 of the architecture ruleset. It is not active: `arclint check .` reads only `rules.arclint.yaml` at the repository root (Stage 1), and its `scan` excludes `.arclint/**`.

- `rules.effect.arclint.yaml`: Stage 1 plus the declared Effect delta. `rules.arclint.yaml` here is a symlink to it so the rule tests run from this folder.
- `EFFECT.md`: why each Effect rule exists and what was verified.
- `.arclint/tests/`: the Stage 2 rule tests. `.arclint/extensions` links to the repository's extensions.
- `scripts/check-stage2-delta.ts`: proves Stage 2 equals the root Stage 1 plus the declared delta.
- `scripts/unstable-symbols.ts`: proves `effect-stable-core` matches the installed Effect declarations.
- `validation/effect-api/`: one complete Effect 4.0.2 path compiled and run against real files.

Adopt it only after Stage 1 is green, by replacing the root `rules.arclint.yaml` with `rules.effect.arclint.yaml` and adding the Effect dependencies it pins. The `mise` tasks `check:stage2-delta`, `check:unstable-symbols`, `test:stage2` and `test:effect-api` run its gates.
