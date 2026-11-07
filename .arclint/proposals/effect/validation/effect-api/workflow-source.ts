// One complete Stage 2 path in the layering the ruleset prescribes:
//   application port (stable core: Context, Effect, Data)
//   format codec (Schema at the boundary, yaml parser)
//   Node driven adapter (unstable FileSystem module, confined to the adapter)
//   composition (Layer provision at the root)
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { parse } from "yaml";

// ---- application: port and expected failures (stable modules only)
export class WorkflowUnreadable extends Data.TaggedError("WorkflowUnreadable")<{
  readonly location: string;
  readonly reason: string;
}> {}

export interface Workflow {
  readonly name: string;
  readonly jobIds: ReadonlyArray<string>;
}

export class WorkflowSource extends Context.Service<WorkflowSource, {
  readonly load: (location: string) => Effect.Effect<Workflow, WorkflowUnreadable | WorkflowInvalid>;
}>()("validation/WorkflowSource") {}

// ---- formats: boundary decoding of unknown text
export class WorkflowInvalid extends Schema.TaggedError<WorkflowInvalid>()("WorkflowInvalid", {
  location: Schema.String,
  detail: Schema.String,
}) {}

const WorkflowFile = Schema.Struct({
  name: Schema.String,
  jobs: Schema.Record(Schema.String, Schema.Unknown),
});

export const decodeWorkflow = Effect.fn("decodeWorkflow")(function* (location: string, text: string) {
  const document = yield* Effect.try({
    try: () => parse(text) as unknown,
    catch: (cause) => new WorkflowInvalid({ location, detail: String(cause) }),
  });
  const file = yield* Schema.decodeUnknownEffect(WorkflowFile)(document).pipe(
    Effect.mapError((error) => new WorkflowInvalid({ location, detail: error.message })),
  );
  return { name: file.name, jobIds: Object.keys(file.jobs).sort() } satisfies Workflow;
});

// ---- node adapter: the only place the unstable FileSystem module appears
export const FileWorkflowSource = Layer.effect(
  WorkflowSource,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const load = Effect.fn("FileWorkflowSource.load")(function* (location: string) {
      const text = yield* fs.readFileString(location).pipe(
        Effect.mapError((error) => new WorkflowUnreadable({ location, reason: error.message })),
      );
      return yield* decodeWorkflow(location, text);
    });
    return WorkflowSource.of({ load });
  }),
);

// ---- composition root
export const NodeWorkflowSource = FileWorkflowSource.pipe(Layer.provide(NodeFileSystem.layer));
