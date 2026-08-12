/* engine.test.js — unit tests for the overlap engine.
 * Fixtures are synthetic in-memory SessionFiles objects, test-only by design.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { detectOverlaps, planMergeOrder, buildReport } from "../dist/engine.js";

function sess(id, files) {
  return { sessionId: id, name: id, worktreeDir: `/wt/${id}`, branch: `branch-${id}`, files };
}

test("detectOverlaps: same file touched by two sessions -> high same-file", () => {
  const alerts = detectOverlaps([
    sess("a", ["src/x.ts", "README.md"]),
    sess("b", ["src/x.ts", "src/y.ts"]),
  ]);
  const high = alerts.find((a) => a.kind === "same-file");
  assert.ok(high, "expected a same-file alert");
  assert.equal(high.severity, "high");
  assert.equal(high.file, "src/x.ts");
  assert.deepEqual([...high.sessionIds].sort(), ["a", "b"]);
});

test("detectOverlaps: same directory, different files -> medium same-dir", () => {
  const alerts = detectOverlaps([
    sess("a", ["src/x.ts"]),
    sess("b", ["src/y.ts"]),
  ]);
  const medium = alerts.find((a) => a.kind === "same-dir");
  assert.ok(medium, "expected a same-dir alert");
  assert.equal(medium.severity, "medium");
  assert.equal(medium.file, "src");
});

test("detectOverlaps: same basename in different dirs -> low same-module", () => {
  const alerts = detectOverlaps([
    sess("a", ["pkg1/index.ts"]),
    sess("b", ["pkg2/index.ts"]),
  ]);
  const low = alerts.find((a) => a.kind === "same-module");
  assert.ok(low, "expected a same-module alert");
  assert.equal(low.severity, "low");
  assert.equal(low.file, "index.ts");
});

test("detectOverlaps: same-file suppresses same-dir for the same directory", () => {
  const alerts = detectOverlaps([
    sess("a", ["src/x.ts"]),
    sess("b", ["src/x.ts", "src/y.ts"]),
  ]);
  assert.ok(alerts.some((a) => a.kind === "same-file"));
  assert.ok(!alerts.some((a) => a.kind === "same-dir"), "same-dir must be subsumed by same-file");
});

test("detectOverlaps: unrelated low alert not suppressed by a different high alert", () => {
  const alerts = detectOverlaps([
    sess("a", ["src/x.ts"]),
    sess("b", ["src/x.ts"]),
    sess("c", ["pkg1/util.ts"]),
    sess("d", ["pkg2/util.ts"]),
  ]);
  const low = alerts.find((a) => a.kind === "same-module");
  assert.ok(low, "low alert for c/d must survive even though a/b have a high alert");
  assert.deepEqual([...low.sessionIds].sort(), ["c", "d"]);
});

test("detectOverlaps: sessions with no files produce no alerts", () => {
  const alerts = detectOverlaps([sess("a", []), sess("b", [])]);
  assert.deepEqual(alerts, []);
});

test("detectOverlaps: output is deterministically ordered (high before low, sorted files)", () => {
  const alerts = detectOverlaps([
    sess("b", ["zz.ts", "aa/x.ts"]),
    sess("a", ["zz.ts"]),
  ]);
  assert.equal(alerts[0].kind, "same-file");
});

test("planMergeOrder: disjoint session first (least shared files)", () => {
  const a = sess("a", ["README.md"]);
  const b = sess("b", ["src/x.ts"]);
  const c = sess("c", ["src/x.ts", "src/y.ts"]);
  const order = planMergeOrder([c, a, b]);
  // a shares nothing -> must go first; b and c tie (1 shared file) so their
  // relative order follows iteration order, which is deterministic.
  assert.equal(order[0].sessionId, "a");
  assert.deepEqual(order.slice(1).map((s) => s.sessionId).sort(), ["b", "c"]);
});

test("planMergeOrder: single session", () => {
  const order = planMergeOrder([sess("a", ["x.ts"])]);
  assert.equal(order.length, 1);
  assert.equal(order[0].sessionId, "a");
});

test("planMergeOrder: empty input", () => {
  assert.deepEqual(planMergeOrder([]), []);
});

test("buildReport: lists conflicting files per merged branch", () => {
  const lines = buildReport([
    { mergedBranch: "branch-a", files: [] },
    { mergedBranch: "branch-b", files: ["src/x.ts"] },
  ]);
  assert.equal(lines[0], "branch-a: no conflicting files");
  assert.equal(lines[1], "branch-b: src/x.ts");
});
