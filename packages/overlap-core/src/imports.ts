/* imports.ts — deterministic local-import extraction (no bundler, no deps).
 *
 * v1 scope: regex-based extraction of ESM/CommonJS/dynamic import specifiers,
 * resolution of RELATIVE specifiers (./ ../) to extensionless module paths.
 * Package imports and tsconfig path aliases are intentionally out of scope —
 * a dep edge is only claimed when it can be proven from the path.
 */

const IMPORT_FROM_RE = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const ALL_RES: RegExp[] = [IMPORT_FROM_RE, EXPORT_FROM_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE];

/** Extract every quoted specifier (unique, in first-seen order). */
export function extractSpecifiers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const re of ALL_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      if (spec && !seen.has(spec)) {
        seen.add(spec);
        out.push(spec);
      }
    }
  }
  return out;
}

/** True for relative specifiers (./ ../ . ..). Package names are out of scope. */
export function isLocalSpec(spec: string): boolean {
  return spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");
}

const EXT_RE = /\.(tsx?|jsx?|mjs|cjs|json)$/;

function stripExtension(p: string): string {
  return p.replace(EXT_RE, "");
}

/**
 * Resolve a relative specifier against the importing file's directory.
 * Returns an extensionless path ("src/engine" for "./engine.js" from "src/cli.ts").
 */
export function resolveLocalSpec(fromFile: string, spec: string): string {
  const dir = fromFile.slice(0, fromFile.lastIndexOf("/") + 1); // keep trailing slash
  const parts = [...dir.split("/").filter(Boolean), ...spec.split("/")];
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(p);
  }
  return stripExtension(stack.join("/"));
}

/**
 * Collect resolved local dependencies for every changed file of a session.
 * `readFile` is injected so callers decide how to read (fs here, cache in
 * tests). Skipped files (read errors, over-size) simply contribute no edges.
 */
export async function collectImportEdges(
  changedFiles: string[],
  readFile: (path: string) => Promise<string>,
  opts: { maxFiles?: number; maxBytes?: number } = {},
): Promise<Record<string, string[]>> {
  const maxFiles = opts.maxFiles ?? 100;
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const edges: Record<string, string[]> = {};
  const files = changedFiles.slice(0, maxFiles);

  for (const f of files) {
    let text: string;
    try {
      text = await readFile(f);
    } catch {
      continue; // unreadable file -> no edges
    }
    if (text.length > maxBytes) continue;
    const deps: string[] = [];
    for (const spec of extractSpecifiers(text)) {
      if (!isLocalSpec(spec)) continue;
      deps.push(resolveLocalSpec(f, spec));
    }
    if (deps.length > 0) edges[f] = deps;
  }
  return edges;
}
