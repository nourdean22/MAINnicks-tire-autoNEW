/**
 * scripts/measure-brain-graph.ts · Phase 0.2 measurement for the brain-map pass.
 *
 * READ-ONLY. Calls getBrainGraph() (SELECT-only; verified by grep for
 * create/update/delete/upsert/executeRaw before running, per prod-db-guard)
 * and prints the shape of the payload. Performs NO writes of any kind.
 *
 * There is no local statenour database — a worktree's DATABASE_URL points at
 * Neon production — so this reads production and says so. Reads are not a
 * protected operation; writes are.
 *
 *   railway run --service statenour-web -- pnpm tsx scripts/measure-brain-graph.ts [scope]
 */
import { getBrainGraph } from "../lib/brain/brain-graph";

type Node = {
  id: string;
  type: string;
  label: string;
  [k: string]: unknown;
};
type Edge = { source: string; target: string; type?: string; [k: string]: unknown };

function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
}

function tally(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function measure(scope: "home" | "full" | "semantic") {
  const t0 = Date.now();
  const payload = (await getBrainGraph({ scope })) as unknown as {
    nodes: Node[];
    edges: Edge[];
    degraded?: string[];
    contradictionCount?: number;
    meta?: Record<string, unknown>;
  };
  const ms = Date.now() - t0;

  const nodes = payload.nodes ?? [];
  const edges = payload.edges ?? [];
  const ids = new Set(nodes.map((n) => n.id));

  const degree = new Map<string, number>();
  let dangling = 0;
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      dangling++;
      continue;
    }
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const labelLens = nodes.map((n) => (n.label ?? "").length);
  const orphans = nodes.filter((n) => (degree.get(n.id) ?? 0) === 0);
  const ephemeral = nodes.filter((n) => n.type === "task" || n.type === "journal");

  console.log(`\n================ scope=${scope} ================`);
  console.log(`buildMs                    ${ms}`);
  console.log(`nodes                      ${nodes.length}`);
  console.log(`edges                      ${edges.length}`);
  console.log(`node count by type         ${JSON.stringify(tally(nodes.map((n) => n.type)))}`);
  console.log(`edge count by type         ${JSON.stringify(tally(edges.map((e) => String(e.type ?? "?"))))}`);
  console.log(`labels > 40 chars          ${labelLens.filter((l) => l > 40).length}`);
  console.log(`P90 label length           ${p90(labelLens)}`);
  console.log(`max label length           ${Math.max(0, ...labelLens)}`);
  console.log(`degree-0 nodes             ${orphans.length}`);
  console.log(`dangling edges             ${dangling}`);
  console.log(`missing labels             ${nodes.filter((n) => !n.label || !n.label.trim()).length}`);
  console.log(`task+journal nodes         ${ephemeral.length}  (${((100 * ephemeral.length) / Math.max(1, nodes.length)).toFixed(0)}%)`);
  console.log(`degraded[]                 ${JSON.stringify(payload.degraded ?? null)}`);
  console.log(`contradictionCount         ${payload.contradictionCount ?? null}`);
  const unlinked = ((payload as unknown as { unlinked?: Node[] }).unlinked) ?? [];
  console.log(`unlinked[] (new)           ${unlinked.length}`);
  const dl = nodes.map((n) => String((n as unknown as { displayLabel?: string }).displayLabel ?? ""));
  if (dl.some(Boolean)) {
    console.log(`P90 displayLabel length    ${p90(dl.map((d) => d.length))}`);
    console.log(`displayLabel > 30 chars    ${dl.filter((d) => d.length > 30).length}`);
    console.log(`max displayLabel length    ${Math.max(0, ...dl.map((d) => d.length))}`);
    console.log(`sample displayLabels       ${JSON.stringify(dl.slice(0, 6))}`);
  }

  const semanticTypes = new Set(["memory", "decision", "person", "goal", "business", "mission", "system"]);
  const semanticNodes = nodes.filter((n) => semanticTypes.has(n.type));
  const semIds = new Set(semanticNodes.map((n) => n.id));
  const semEdges = edges.filter((e) => semIds.has(e.source) && semIds.has(e.target));
  const semDegree = new Map<string, number>();
  for (const e of semEdges) {
    semDegree.set(e.source, (semDegree.get(e.source) ?? 0) + 1);
    semDegree.set(e.target, (semDegree.get(e.target) ?? 0) + 1);
  }
  const semOrphans = semanticNodes.filter((n) => (semDegree.get(n.id) ?? 0) === 0);
  console.log(`\n-- projected scope=semantic (types: ${[...semanticTypes].join(",")}) --`);
  console.log(`  nodes                    ${semanticNodes.length}`);
  console.log(`  edges                    ${semEdges.length}`);
  console.log(`  P90 label length         ${p90(semanticNodes.map((n) => (n.label ?? "").length))}`);
  console.log(`  labels > 40              ${semanticNodes.filter((n) => (n.label ?? "").length > 40).length}`);
  console.log(`  degree-0 (RECOMPUTED)    ${semOrphans.length}`);

  const longest = [...nodes].sort((a, b) => (b.label ?? "").length - (a.label ?? "").length).slice(0, 5);
  console.log(`\n-- 5 longest labels --`);
  for (const n of longest) console.log(`  [${n.type}] ${(n.label ?? "").slice(0, 110)}`);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`DB host (read-only): ${host || "UNSET"}`);
  await measure("full");
  await measure("semantic");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("measure failed:", e);
    process.exit(1);
  });
