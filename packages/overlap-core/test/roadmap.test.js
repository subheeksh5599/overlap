/* roadmap.test.js — tests for the roadmap features: dep-import detection,
 * CI-aware alert ranking, least-loaded routing, and import extraction.
 * Fixtures are synthetic in-memory objects, test-only by design.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectOverlaps,
  leastLoadedSession,
  worstCi,
  worstMergeability,
} from "../dist/engine.js";
import { extractSpecifiers, isLocalSpec, resolveLocalSpec, collectImportEdges } from "../dist/imports.js";
import { mergeRanges, parseHunks } from "../dist/git.js";

function sess(id, files, pr = null, projectId = "overlap", hunks = undefined) {
  return { sessionId: id, name: id, worktreeDir: `/wt/${id}`, branch: `branch-${id}`, files, projectId, pr, hunks };
}

function pr(ci = "unknown", mergeability = "unknown", number = 1) {
  return { number, state: "open", url: "https://github.com/x/y/pull/1", ci, mergeability, failingChecks: [] };
}

/* --- import extraction ------------------------------------------------- */

test("extractSpecifiers: ESM, export-from, require, dynamic import", () => {
  const text = `
import { x } from "./engine.js";
import "./styles.css";
export { y } from "../shared/util";
const z = require("fs");
const w = import("./lazy.ts");
`;
  const specs = extractSpecifiers(text);
  assert.ok(specs.includes("./engine.js"));
  assert.ok(specs.includes("./styles.css"));
  assert.ok(specs.includes("../shared/util"));
  assert.ok(specs.includes("fs"));
  assert.ok(specs.includes("./lazy.ts"));
  assert.equal(new Set(specs).size, specs.length, "specifiers must be unique");
});

test("isLocalSpec: only relative specifiers", () => {
  assert.equal(isLocalSpec("./x"), true);
  assert.equal(isLocalSpec("../x/y"), true);
  assert.equal(isLocalSpec("."), true);
  assert.equal(isLocalSpec(".."), true);
  assert.equal(isLocalSpec("fs"), false);
  assert.equal(isLocalSpec("@scope/pkg"), false);
  assert.equal(isLocalSpec("node:fs"), false);
});

test("resolveLocalSpec: resolves relative paths and strips extensions", () => {
  assert.equal(resolveLocalSpec("src/cli.ts", "./engine.js"), "src/engine");
  assert.equal(resolveLocalSpec("src/cli.ts", "../shared/util.ts"), "shared/util");
  assert.equal(resolveLocalSpec("src/deep/cli.ts", "../../shared/util"), "shared/util");
  assert.equal(resolveLocalSpec("src/cli.ts", "./sibling"), "src/sibling");
  assert.equal(resolveLocalSpec("cli.ts", "./x/y.ts"), "x/y");
});

test("collectImportEdges: maps changed files to resolved local deps only", async () => {
  const read = async (p) => {
    const contents = {
      "src/cli.ts": 'import { x } from "./engine.js";\nimport fs from "fs";\n',
      "src/engine.ts": 'export const x = 1;\n',
      "README.md": "no imports here\n",
    };
    return contents[p] ?? "";
  };
  const edges = await collectImportEdges(["src/cli.ts", "src/engine.ts", "README.md"], read);
  assert.deepEqual(edges["src/cli.ts"], ["src/engine"]);
  assert.equal(edges["src/engine.ts"], undefined, "no local deps -> no entry");
  assert.equal(edges["README.md"], undefined, "files with no local deps contribute no entry");
});

test("collectImportEdges: read errors contribute no edges", async () => {
  const edges = await collectImportEdges(["src/a.ts"], async () => {
    throw new Error("boom");
  });
  assert.deepEqual(edges, {});
});

/* --- dep-import (semantic overlap) ------------------------------------- */

test("detectOverlaps: session importing a module another session edits -> medium dep-import", () => {
  const a = sess("a", ["src/cli.ts"]);
  const b = sess("b", ["src/engine.ts"]);
  const imports = { a: { "src/cli.ts": ["src/engine"] } };
  const alerts = detectOverlaps([a, b], imports);
  const dep = alerts.find((x) => x.kind === "dep-import");
  assert.ok(dep, "expected a dep-import alert");
  assert.equal(dep.severity, "medium");
  assert.equal(dep.file, "src/engine.ts");
  assert.equal(dep.importer, "src/cli.ts");
  assert.deepEqual([...dep.sessionIds].sort(), ["a", "b"]);
});

test("detectOverlaps: dep-import suppressed when a same-file alert covers the module", () => {
  const a = sess("a", ["src/engine.ts"]);
  const b = sess("b", ["src/engine.ts"]);
  const imports = { a: { "src/cli.ts": ["src/engine"] } };
  const alerts = detectOverlaps([a, b], imports);
  assert.ok(alerts.some((x) => x.kind === "same-file"), "same-file must still fire");
  assert.ok(!alerts.some((x) => x.kind === "dep-import"), "dep-import must be subsumed");
});

test("detectOverlaps: dep-import is deduped per module and session pair", () => {
  const a = sess("a", ["src/cli.ts", "src/other.ts"]);
  const b = sess("b", ["src/engine.ts"]);
  const imports = {
    a: { "src/cli.ts": ["src/engine"], "src/other.ts": ["src/engine"] },
  };
  const alerts = detectOverlaps([a, b], imports);
  const deps = alerts.filter((x) => x.kind === "dep-import");
  assert.equal(deps.length, 1, "two importers of the same module by the same session pair = one alert");
});

test("detectOverlaps: package specifiers never create dep-import alerts", () => {
  const a = sess("a", ["src/cli.ts"]);
  const b = sess("b", ["src/engine.ts"]);
  const imports = { a: { "src/cli.ts": ["react", "node:fs"] } };
  const alerts = detectOverlaps([a, b], imports);
  assert.ok(!alerts.some((x) => x.kind === "dep-import"));
});

/* --- CI-aware ranking ---------------------------------------------------- */

test("detectOverlaps: collides AND ci failing outranks collides but green", () => {
  const a = sess("a", ["src/x.ts"], pr("failing", "mergeable", 1));
  const b = sess("b", ["src/x.ts"], pr("passing", "mergeable", 2));
  const c = sess("c", ["src/y.ts"], pr("passing", "mergeable", 3));
  const d = sess("d", ["src/y.ts"], pr("passing", "mergeable", 4));
  const alerts = detectOverlaps([a, b, c, d]);
  const xAlert = alerts.find((x) => x.file === "src/x.ts");
  const yAlert = alerts.find((x) => x.file === "src/y.ts");
  assert.equal(xAlert.ci, "failing", "worst CI across involved sessions");
  assert.equal(yAlert.ci, "passing");
  assert.ok(alerts.indexOf(xAlert) < alerts.indexOf(yAlert), "failing alert must sort first");
});

test("detectOverlaps: mergeability conflicting outranks mergeable at equal CI", () => {
  const a = sess("a", ["src/x.ts"], pr("passing", "conflicting", 1));
  const b = sess("b", ["src/x.ts"], pr("passing", "mergeable", 2));
  const c = sess("c", ["src/y.ts"], pr("passing", "mergeable", 3));
  const d = sess("d", ["src/y.ts"], pr("passing", "mergeable", 4));
  const alerts = detectOverlaps([a, b, c, d]);
  const xAlert = alerts.find((x) => x.file === "src/x.ts");
  const yAlert = alerts.find((x) => x.file === "src/y.ts");
  assert.equal(xAlert.mergeability, "conflicting");
  assert.ok(alerts.indexOf(xAlert) < alerts.indexOf(yAlert), "conflicting alert must sort first");
});

test("worstCi / worstMergeability: worst-of across sessions", () => {
  const s1 = sess("a", [], pr("passing", "mergeable"));
  const s2 = sess("b", [], pr("failing", "conflicting"));
  const s3 = sess("c", [], null);
  assert.equal(worstCi([s1, s2, s3], ["a", "b", "c"]), "failing");
  assert.equal(worstMergeability([s1, s2, s3], ["a", "b", "c"]), "conflicting");
  assert.equal(worstCi([s1, s3], ["a", "c"]), "passing");
  assert.equal(worstCi([s1], ["missing"]), "unknown");
});

/* --- region-aware same-file detection ----------------------------------- */

test("parseHunks: parses unified=0 hunks into new-side ranges", () => {
  const out = parseHunks("@@ -1,5 +1,5 @@\n@@ -20,0 +25,3 @@\n@@ -40,1 +45,1 @@");
  assert.deepEqual(out, [
    [1, 5],
    [25, 27],
    [45, 45],
  ]);
});

test("mergeRanges: merges overlapping and adjacent ranges", () => {
  assert.deepEqual(mergeRanges([[1, 3], [3, 5], [10, 12]]), [
    [1, 5],
    [10, 12],
  ]);
  assert.deepEqual(mergeRanges([]), []);
});

test("detectOverlaps: same file with overlapping regions -> high same-file", () => {
  const a = sess("a", ["src/x.ts"], null, "overlap", { "src/x.ts": [[10, 20]] });
  const b = sess("b", ["src/x.ts"], null, "overlap", { "src/x.ts": [[15, 25]] });
  const alerts = detectOverlaps([a, b]);
  const alert = alerts.find((x) => x.kind === "same-file");
  assert.equal(alert.severity, "high");
  assert.equal(alert.regions, true);
});

test("detectOverlaps: same file with disjoint regions -> low same-file", () => {
  const a = sess("a", ["src/x.ts"], null, "overlap", { "src/x.ts": [[10, 20]] });
  const b = sess("b", ["src/x.ts"], null, "overlap", { "src/x.ts": [[40, 50]] });
  const alerts = detectOverlaps([a, b]);
  const alert = alerts.find((x) => x.kind === "same-file");
  assert.equal(alert.severity, "low");
  assert.equal(alert.regions, false);
});

test("detectOverlaps: any overlapping pair keeps same-file high across 3 sessions", () => {
  const a = sess("a", ["src/x.ts"], null, "overlap", { "src/x.ts": [[10, 20]] });
  const b = sess("b", ["src/x.ts"], null, "overlap", { "src/x.ts": [[40, 50]] });
  const c = sess("c", ["src/x.ts"], null, "overlap", { "src/x.ts": [[45, 60]] });
  const alerts = detectOverlaps([a, b, c]);
  const alert = alerts.find((x) => x.kind === "same-file");
  assert.equal(alert.severity, "high", "b/c overlap outweighs the a/b disjoint pair");
  assert.equal(alert.regions, true);
});

test("detectOverlaps: missing hunks still assume the worst (high)", () => {
  const a = sess("a", ["src/x.ts"]);
  const b = sess("b", ["src/x.ts"]);
  const alerts = detectOverlaps([a, b]);
  const alert = alerts.find((x) => x.kind === "same-file");
  assert.equal(alert.severity, "high");
  assert.equal(alert.regions, null);
});

/* --- fix routing --------------------------------------------------------- */

test("leastLoadedSession: fewest files, then name", () => {
  const a = sess("a", ["f1", "f2", "f3"]);
  const b = sess("b", ["f1"]);
  const c = sess("c", ["f1"]);
  assert.equal(leastLoadedSession([a, b, c]).sessionId, "b", "fewest files wins; name breaks ties");
  assert.equal(leastLoadedSession([]), null);
});
