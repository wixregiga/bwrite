import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { parse } from "yaml";
import { NodeWorkflowSource, WorkflowSource } from "./workflow-source.ts";

const realData = join(import.meta.dirname, "real-data");
const load = (location: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const source = yield* WorkflowSource;
      return yield* source.load(location);
    }).pipe(Effect.provide(NodeWorkflowSource)),
  );

test("decodes every real workflow file and agrees with an independent yaml parse", async () => {
  const files = readdirSync(realData).filter((name) => name.endsWith(".yml"));
  assert.ok(files.length >= 3);
  for (const name of files) {
    const location = join(realData, name);
    const oracle = parse(readFileSync(location, "utf8")) as { name: string; jobs: Record<string, unknown> };
    const exit = await load(location);
    assert.ok(Exit.isSuccess(exit), `${name} should decode`);
    assert.equal(exit.value.name, oracle.name);
    assert.deepEqual(exit.value.jobIds, Object.keys(oracle.jobs).sort());
  }
});

test("a real YAML file of another shape fails as WorkflowInvalid", async () => {
  const exit = await load(join(realData, "docker-compose.yaml"));
  assert.ok(Exit.isFailure(exit));
  const error = Exit.findErrorOption(exit);
  assert.equal(error._tag, "Some");
  assert.equal(error.value._tag, "WorkflowInvalid");
});

test("a missing file fails as WorkflowUnreadable from the real filesystem", async () => {
  const exit = await load(join(realData, "absent.yml"));
  assert.ok(Exit.isFailure(exit));
  const error = Exit.findErrorOption(exit);
  assert.equal(error._tag, "Some");
  assert.equal(error.value._tag, "WorkflowUnreadable");
});

test("one ManagedRuntime built from the adapter Layer serves repeated loads and releases on dispose", async () => {
  const runtime = ManagedRuntime.make(NodeWorkflowSource);
  try {
    const location = join(realData, "check.yml");
    const first = await runtime.runPromise(Effect.gen(function* () {
      const source = yield* WorkflowSource;
      return yield* source.load(location);
    }));
    const second = await runtime.runPromise(Effect.gen(function* () {
      const source = yield* WorkflowSource;
      return yield* source.load(location);
    }));
    assert.deepEqual(first, second);
  } finally {
    await runtime.dispose();
  }
});
