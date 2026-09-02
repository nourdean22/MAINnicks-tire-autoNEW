/**
 * tests/repo/ui-mount-graph.test.ts · 2026-09-01 audit R5 (UI half)
 *
 * The guardian-registry-drift pattern ported onto the UI tree: ENUMERATE the
 * subjects, ASSERT each one, add the INVERSE check. Every component file under
 * components/** and features/** must be transitively reachable from a Next.js
 * entrypoint (page / layout / route / middleware / ...) through real import
 * edges — or be named in PARKED with a reason. "Has an importer" is not enough
 * (an island that imports itself has importers and is still dead); reachability
 * from an entrypoint is the test.
 *
 * Why this exists: the audit found GlobalTopTicker documented in the layout as
 * the priority-alert channel while mounted nowhere (W-1), three dead component
 * islands (W-2), and an a11y suite asserting source text of components no route
 * renders (W-3). Each was a control that existed, looked wired, and was not.
 * A source-text assertion cannot distinguish a live component from a dead one;
 * this graph can.
 *
 * The inverse check is what keeps PARKED honest: an entry that becomes
 * reachable again must be removed, so the allowlist can only shrink by
 * re-mounting or deleting — never silently grow stale.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-prod", "dist", "tests", "docs", "prisma", "scripts", "public", "e2e"]);

/**
 * Component files that are known-unreachable and deliberately kept. Every
 * entry needs a one-line reason. Add here ONLY after deciding the file is
 * parked (awaiting re-mount) rather than dead — dead files get deleted.
 * 2026-09-01 · initial list = the audit's W-2 clusters, verified by this
 * gate's own BFS on 5c1195e (see the failure message format below).
 */
export const PARKED: Record<string, string> = {
  // 3D scene island · zero importers since the /ultron HQ route was deleted;
  // next.config.ts:90 still names scene-canvas in a transpile note.
  "components/3d/canvas-inner.tsx": "3D scene island (audit W-2) · reached only via scene-canvas, which nothing imports · re-mount or delete is an operator call",
  "components/3d/scene-canvas.tsx": "3D scene island (audit W-2) · zero importers · next.config.ts:90 still references it · re-mount or delete is an operator call",
  "components/3d/scene-skeleton.tsx": "3D scene island (audit W-2) · loading skeleton for scene-canvas · dead with its parent",
  // actions/loops island · entry loop-stream has zero importers.
  "components/actions/break-promise-modal.tsx": "actions/loops island (audit W-2) · child of loop-stream · dead with its parent",
  "components/actions/event-timeline.tsx": "actions/loops island (audit W-2) · child of loop-stream · dead with its parent",
  "components/actions/loop-row-item.tsx": "actions/loops island (audit W-2) · child of loop-stream · dead with its parent",
  "components/actions/loop-stream.tsx": "actions/loops island (audit W-2) · island entry, zero importers · re-mount or delete is an operator call",
  "components/actions/todays-compound.tsx": "actions/loops island (audit W-2) · child of loop-stream · dead with its parent",
  // A UI whose backend is fully alive.
  "components/operator/compound-chain.tsx": "audit W-2 · never mounted while lib/services/compound-chain.ts + /api/operator/compound are live · the consumer the service was built for",
  // Ultron HQ island · the route is gone. (ask/omni-capture.tsx, a duplicate
  // of the live components/actions/omni-capture-modal.tsx, was deleted
  // 2026-09-01 rather than parked.)
  "components/ultron/contradictions-card.tsx": "Ultron HQ island (audit W-2) · route deleted · re-mount or delete is an operator call",
  "components/ultron/signal/situation-card.tsx": "Ultron HQ island (audit W-2) · route deleted · re-mount or delete is an operator call",
  "components/ultron/today/active-task-companion.tsx": "Ultron HQ island (audit W-2) · route deleted · re-mount or delete is an operator call",
  "components/ultron/today/next-action-whisperer.tsx": "Ultron HQ island (audit W-2) · route deleted · re-mount or delete is an operator call",
  // top-strip/ticker.tsx + top-strip/hq-status-chips.tsx — the children of
  // GlobalTopTicker (deleted, W-1) — were deleted 2026-09-01 as well: #158
  // folded the top strip into BottomPulseTicker, which queries
  // trpc.operator.ticker itself, so nothing was parked, only superseded.
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|jsx?)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const norm = (p: string) => relative(APP_ROOT, p).split(/[\\/]/).join("/");

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

function resolveSpecifier(fromFile: string, spec: string): string | null | "external" {
  let base: string;
  if (spec.startsWith("@/")) base = join(APP_ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return "external";
  base = base.replace(/\?.*$/, "");
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const SPEC_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = SPEC_RE.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

const ENTRY_RE = /^app\/(?:.*\/)?(?:page|layout|template|error|global-error|loading|not-found|default|route|manifest|robots|sitemap|icon|apple-icon|opengraph-image)\.tsx?$/;
const ROOT_ENTRIES = new Set(["middleware.ts", "instrumentation.ts", "instrumentation-client.ts", "auth.ts", "next.config.ts"]);

const files = walk(APP_ROOT);
const byRel = new Map(files.map((f) => [norm(f), f]));
const entrypoints = files.filter((f) => ENTRY_RE.test(norm(f)) || ROOT_ENTRIES.has(norm(f)));

const unresolved: string[] = [];
const edges = new Map<string, string[]>();
for (const f of files) {
  const out: string[] = [];
  for (const spec of importsOf(f)) {
    const r = resolveSpecifier(f, spec);
    if (r === "external") continue;
    if (r === null) {
      unresolved.push(`${norm(f)} → ${spec}`);
      continue;
    }
    out.push(r);
  }
  edges.set(f, out);
}

const reachable = new Set<string>();
const queue = [...entrypoints];
while (queue.length > 0) {
  const f = queue.pop()!;
  if (reachable.has(f)) continue;
  reachable.add(f);
  for (const next of edges.get(f) ?? []) if (!reachable.has(next)) queue.push(next);
}

// 2026-09-02 self-review · app/** carries co-located components too (5 at the
// time); a non-entry .tsx under app/ that nothing reaches is the same defect.
const isSubject = (rel: string) =>
  (/^(components|features)\/.*\.tsx$/.test(rel) || (/^app\/.*\.tsx$/.test(rel) && !ENTRY_RE.test(rel))) &&
  !/\.(test|spec|stories)\.tsx$/.test(rel);
const subjects = [...byRel.keys()].filter(isSubject).sort();
const unreachable = subjects.filter((rel) => !reachable.has(byRel.get(rel)!));

describe("ui mount graph · every component is reachable from an entrypoint, or explicitly parked", () => {
  it("discovers the graph (sanity · the scan must not silently match nothing)", () => {
    expect(entrypoints.length, "entrypoints").toBeGreaterThanOrEqual(300);
    expect(subjects.length, "component files").toBeGreaterThanOrEqual(200);
    expect(reachable.size, "reachable modules").toBeGreaterThanOrEqual(1000);
    // A resolver bug looks like "everything is unreachable". Cap the
    // unresolved INTERNAL specifiers so a broken resolver fails loudly here
    // instead of as a wall of false orphans below.
    expect(
      unresolved.length,
      `internal import specifiers this resolver could not resolve:\n${unresolved.slice(0, 20).join("\n")}`,
    ).toBeLessThanOrEqual(5);
  });

  it("no component file is unreachable unless it is in PARKED with a reason", () => {
    const orphans = unreachable.filter((rel) => !(rel in PARKED));
    expect(
      orphans,
      `component files no entrypoint reaches — mount them, delete them, or park them WITH a reason:\n${orphans.join("\n")}`,
    ).toEqual([]);
  });

  it("inverse · a PARKED entry that is reachable again (or gone) must leave the allowlist", () => {
    const stale = Object.keys(PARKED).filter((rel) => !byRel.has(rel) || reachable.has(byRel.get(rel)!));
    expect(stale, `PARKED entries that are reachable or deleted — remove them:\n${stale.join("\n")}`).toEqual([]);
    for (const [rel, reason] of Object.entries(PARKED)) expect(reason.trim().length, `${rel} needs a reason`).toBeGreaterThan(10);
  });
});
