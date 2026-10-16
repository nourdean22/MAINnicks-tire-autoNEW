/**
 * Client / server import boundary (UI v3 W2 round 2, 2026-10-16).
 *
 * `next build` died on PR #3073: components/home/brief-rows.tsx ("use client") value-imported
 * lib/home/brief-rows.ts, which value-imported lib/home/operator-brief.ts, which imports prisma.
 * tsc and vitest cannot see this (both load server code happily); only the Turbopack build did, after
 * the push. This canary walks the VALUE imports of every "use client" module under the Home and
 * Missions component trees and hooks/, through `@/` and relative paths, and fails when the walk
 * reaches a module that imports a server marker. `import type` and `type` specifiers are skipped, and
 * so is a named import that the target exports only as a type (TypeScript erases it; the build never
 * sees it). Positive controls: the walker finds client modules, it sees operator-brief as server code
 * when walked directly, and a planted client module that value-imports it is reported while the same
 * import spelled `import type` is not.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "..", "..");
const CLIENT_DIRS = ["components/home", "components/missions", "hooks"];
const SERVER_MARKERS = ["server-only", "@/lib/db", "@/lib/prisma", "@prisma/client", "node:fs", "fs", "node:fs/promises", "fs/promises", "node:net", "net"];

type Reader = (absPath: string) => string | null;
const readDisk: Reader = (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isClientModule(src: string): boolean {
  return /^\s*["']use client["']\s*;?/m.test(stripComments(src).slice(0, 400));
}

interface Edge {
  specifier: string;
  /** named value specifiers; empty for default, namespace and side-effect imports (always value) */
  names: string[] | null;
}

/** Value-import edges of a module. `import type`, `type x` specifiers and `export type` re-exports are dropped. */
export function valueImports(src: string): Edge[] {
  const code = stripComments(src);
  const out: Edge[] = [];
  const re = /(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) {
    if (m[4]) {
      out.push({ specifier: m[4], names: null });
      continue;
    }
    if (m[1]) continue; // import type / export type
    const clause = m[2].trim();
    const braces = /\{([\s\S]*)\}/.exec(clause);
    const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim(); // default or namespace import
    if (outside) {
      out.push({ specifier: m[3], names: null });
      continue;
    }
    if (!braces) continue; // `export * from` style: treat as value
    const names = braces[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !/^type\s/.test(s))
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    if (names.length > 0) out.push({ specifier: m[3], names });
  }
  if (/export\s+\*\s+from\s+["']([^"']+)["']/.test(code)) {
    for (const m of code.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) out.push({ specifier: m[1], names: null });
  }
  return out;
}

/** The target exports `name` as a value (const, function, class, enum, let, var, or an export list). */
function exportsValue(targetSrc: string, name: string): boolean {
  const code = stripComments(targetSrc);
  if (new RegExp(`export\\s+(?:async\\s+)?(?:const|function\\*?|class|enum|let|var)\\s+${name}\\b`).test(code)) return true;
  if (new RegExp(`export\\s+default\\s+(?:async\\s+)?(?:function\\*?|class)?\\s*${name}\\b`).test(code)) return true;
  for (const m of code.matchAll(/export\s+\{([^}]*)\}/g)) {
    const listed = m[1].split(",").map((s) => s.trim()).filter((s) => !/^type\s/.test(s));
    if (listed.some((s) => s.split(/\s+as\s+/).pop()!.trim() === name)) return true;
  }
  return false;
}

function resolveLocal(fromFile: string, specifier: string, read: Reader): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(APP, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.(ts|tsx)$/.test(candidate) && read(candidate) !== null) return candidate;
  }
  return null;
}

/** Server markers reachable from `entry` by value imports; each hit is the import chain that reached it. */
export function serverReach(entry: string, read: Reader): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ file: string; via: string[] }> = [{ file: entry, via: [] }];
  while (queue.length) {
    const { file, via } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    if (src === null) continue;
    const chain = [...via, path.relative(APP, file).replace(/\\/g, "/")];
    const edges = valueImports(src);
    const marker = edges.find((e) => SERVER_MARKERS.includes(e.specifier));
    if (marker) {
      // one line per server module reached; its own imports are not walked further
      hits.push(`${chain.join(" <- ")} imports "${marker.specifier}"`);
      continue;
    }
    for (const edge of edges) {
      const target = resolveLocal(file, edge.specifier, read);
      if (!target) continue;
      if (edge.names) {
        const targetSrc = read(target) ?? "";
        if (!edge.names.some((n) => exportsValue(targetSrc, n))) continue; // every name is a type: erased
      }
      queue.push({ file: target, via: chain });
    }
  }
  return hits;
}

function clientModules(): string[] {
  const out: string[] = [];
  for (const dir of CLIENT_DIRS) {
    const root = path.join(APP, dir);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\.|\.spec\./.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      if (isClientModule(fs.readFileSync(file, "utf8"))) out.push(file);
    }
  }
  return out;
}

describe("client modules never value-import server code", () => {
  const clients = clientModules();

  it("positive control: the walk finds real client modules", () => {
    expect(clients.length).toBeGreaterThan(10);
    expect(clients.some((f) => f.endsWith(path.join("components", "home", "brief-rows.tsx")))).toBe(true);
  });

  it("positive control: operator-brief is server code to the walker (prisma through @/lib/prisma)", () => {
    const hits = serverReach(path.join(APP, "lib", "home", "operator-brief.ts"), readDisk);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.join("\n")).toMatch(/@\/lib\/prisma|@prisma\/client/);
  });

  it("positive control: a planted client module that value-imports operator-brief is reported; `import type` is not", () => {
    const planted = path.join(APP, "components", "home", "__planted__.tsx");
    const withValue: Reader = (p) => (p === planted ? '"use client";\nimport { ATTENTION_CAP } from "@/lib/home/operator-brief";\nexport const x = ATTENTION_CAP;' : readDisk(p));
    const withType: Reader = (p) => (p === planted ? '"use client";\nimport type { OperatorBrief } from "@/lib/home/operator-brief";\nexport const x = (b: OperatorBrief) => b;' : readDisk(p));
    const erased: Reader = (p) => (p === planted ? '"use client";\nimport { OperatorBrief } from "@/lib/home/operator-brief";\nexport const x = (b: OperatorBrief) => b;' : readDisk(p));
    expect(serverReach(planted, withValue).length).toBeGreaterThan(0);
    expect(serverReach(planted, withType)).toEqual([]);
    expect(serverReach(planted, erased), "a named import the target exports only as a type is erased by TypeScript").toEqual([]);
  });

  it("every 'use client' module under components/home, components/missions and hooks stays out of server code", () => {
    const offenders: string[] = [];
    for (const file of clients) {
      for (const hit of serverReach(file, readDisk)) offenders.push(hit);
    }
    expect(offenders, "a client module reaches a server marker by value imports (next build will fail)").toEqual([]);
  });
});
