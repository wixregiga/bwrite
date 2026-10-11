import { defineRule } from "arclint";

// Tarjan's strongly connected components over the resolved file import graph,
// iterative so that deep import chains cannot exhaust the extension stack.
export default defineRule({
  type: "ddd/file-cycles",
  description: "Reject strongly connected components in the resolved TypeScript file import graph",
  capability: "exact",
  check(ctx) {
    const files = ctx.files().filter(file => /\.tsx?$/.test(file.path));
    const paths = new Set(files.map(file => file.path));
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const facts = ctx.facts(file.path);
      if (!facts || !facts.importsAvailable) {
        ctx.report({ path: file.path, message: "Import facts unavailable; cycle verification cannot proceed" });
        graph.set(file.path, []);
        continue;
      }
      const targets = facts.imports
        .filter(imp => imp.class === "internal" && paths.has(imp.targetFile))
        .map(imp => imp.targetFile);
      graph.set(file.path, Array.from(new Set(targets)).sort());
    }
    let counter = 0;
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    for (const root of Array.from(paths).sort()) {
      if (index.has(root)) continue;
      const work: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
      index.set(root, counter); low.set(root, counter); counter++;
      stack.push(root); onStack.add(root);
      while (work.length > 0) {
        const frame = work[work.length - 1];
        const targets = graph.get(frame.node) || [];
        if (frame.next < targets.length) {
          const target = targets[frame.next++];
          if (!index.has(target)) {
            index.set(target, counter); low.set(target, counter); counter++;
            stack.push(target); onStack.add(target);
            work.push({ node: target, next: 0 });
          } else if (onStack.has(target)) {
            low.set(frame.node, Math.min(low.get(frame.node)!, index.get(target)!));
          }
          continue;
        }
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
        }
        if (low.get(frame.node) !== index.get(frame.node)) continue;
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        const selfLoop = (graph.get(frame.node) || []).includes(frame.node);
        if (component.length > 1 || selfLoop) {
          component.sort();
          ctx.report({ path: component[0], message: `Import cycle among files: ${component.join(", ")}` });
        }
      }
    }
  },
});
