/**
 * build-graphify-manifest.ts — generate a bounded, evidence-backed Graphify
 * findings manifest from graphify-out/graph.json, in the exact shape the
 * ingest (scripts/ingest-graphify-findings.ts) validates against
 * (GraphifyManifestSchema in lib/knowledge/adapters/graphify.ts).
 *
 * WHY THIS EXISTS: `graphify update` writes graphify-out/manifest.json as an
 * AST cache ({ "<file>": { ast_hash } }), which is NOT a findings manifest, so
 * the ingest threw and the graphify -> BrainMemory pipeline sat dormant. This
 * derives GENUINE findings from the real graph and writes them to a DISTINCT
 * path (findings-manifest.json) so it never collides with the AST cache.
 *
 * Findings are still governed downstream: candidate.ts forces every graphify
 * finding to human review (graph_snapshot_requires_review) before it can enter
 * BrainMemory. This script fabricates nothing — every finding is computed from
 * graph.json with its evidence (degree, community, node ids, real file paths).
 *
 * Run:  pnpm graphify:manifest   (then pnpm graphify:ingest)
 */
import fs from "node:fs";
import path from "node:path";
import { GraphifyManifestSchema, type GraphifyFinding } from "../lib/knowledge/adapters/graphify";

const HUB_LIMIT = 15; // top dependency hubs by non-structural degree
const BOUNDARY_LIMIT = 10; // top cross-app couplings

interface GraphNode {
  id: string;
  label?: string;
  source_file?: string;
  community?: number;
}
interface GraphLink {
  source: string;
  target: string;
  relation?: string;
}

/** Map a source file to its app/package boundary. */
function appOf(sourceFile?: string): string {
  if (!sourceFile) return "unknown";
  const apps = sourceFile.match(/^apps\/([^/]+)/);
  if (apps) return `apps/${apps[1]}`;
  const pkg = sourceFile.match(/^packages\/([^/]+)/);
  if (pkg) return `packages/${pkg[1]}`;
  return sourceFile.split("/")[0] || "root";
}

function main(): void {
  const monorepoRoot = path.resolve(__dirname, "../../..");
  const graphifyRoot = path.join(monorepoRoot, "graphify-out");
  const graphPath = path.join(graphifyRoot, "graph.json");
  if (!fs.existsSync(graphPath)) {
    throw new Error(
      `graph.json not found at ${graphPath}. Run \`graphify update .\` from the repo root first.`,
    );
  }

  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
    nodes?: GraphNode[];
    links?: GraphLink[];
    edges?: GraphLink[];
    built_at_commit?: unknown;
  };
  const nodes = graph.nodes ?? [];
  const links = graph.links ?? graph.edges ?? [];
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // Hub metric = CROSS-FILE FAN-IN: the count of DISTINCT OTHER files a node
  // couples to via non-"contains" edges. Raw edge degree over-counts common
  // intra-file symbols (a `json` var reused 900x in one file); cross-file
  // fan-in isolates genuine architectural hubs (a function called from N files).
  const coupledFiles = new Map<string, Set<string>>();
  const couple = (id: string, otherFile: string): void => {
    let s = coupledFiles.get(id);
    if (!s) {
      s = new Set<string>();
      coupledFiles.set(id, s);
    }
    s.add(otherFile);
  };
  const crossApp = new Map<string, { count: number; examples: string[]; files: Set<string> }>();
  for (const l of links) {
    if (l.relation === "contains") continue;
    const src = byId.get(l.source);
    const tgt = byId.get(l.target);
    const fa = src?.source_file;
    const fb = tgt?.source_file;
    if (!fa || !fb || fa === fb) continue; // cross-file edges only
    couple(l.source, fb);
    couple(l.target, fa);
    const a = appOf(fa);
    const b = appOf(fb);
    if (a !== b && a !== "unknown" && b !== "unknown") {
      const key = [a, b].sort().join(" <-> ");
      const rec = crossApp.get(key) ?? { count: 0, examples: [], files: new Set<string>() };
      rec.count += 1;
      rec.files.add(fa);
      rec.files.add(fb);
      if (rec.examples.length < 3) {
        rec.examples.push(
          `${src?.label ?? l.source} (${fa}) --${l.relation ?? "ref"}--> ${tgt?.label ?? l.target} (${fb})`,
        );
      }
      crossApp.set(key, rec);
    }
  }

  const maxHub = Math.max(1, ...[...coupledFiles.values()].map((s) => s.size));
  const findings: GraphifyFinding[] = [];

  // Dependency hubs (god-nodes) — ranked by cross-file fan-in
  for (const [id, files] of [...coupledFiles.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, HUB_LIMIT)) {
    const n = byId.get(id);
    if (!n) continue;
    const fanIn = files.size;
    findings.push({
      id: `hub:${id}`.slice(0, 256),
      summary:
        `Dependency hub: ${n.label ?? id} in ${n.source_file ?? "an unknown file"} is referenced ` +
        `from ${fanIn} distinct other files (community ${n.community ?? "?"}). High cross-file ` +
        `fan-in means a wide change-blast-radius; confirm this coupling is intended.`.slice(0, 8000),
      kind: "dependency_hub",
      confidence: Math.min(0.95, 0.5 + 0.45 * (fanIn / maxHub)),
      files: [n.source_file ?? id, ...[...files].slice(0, 9)].slice(0, 50),
      evidence: [
        `cross-file fan-in = ${fanIn} distinct files (graph max = ${maxHub})`,
        `graph community = ${n.community ?? "unknown"}`,
        `node id = ${id}`,
        `sample referencing files: ${[...files].slice(0, 5).join(", ")}`.slice(0, 2000),
      ],
      contradictionRefs: [],
    });
  }

  // Cross-app coupling (boundary)
  for (const [pair, rec] of [...crossApp.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, BOUNDARY_LIMIT)) {
    const files = [...rec.files].slice(0, 50);
    findings.push({
      id: `boundary:${pair}`.slice(0, 256),
      summary:
        `Cross-boundary coupling: ${rec.count} non-structural references cross ${pair}. The ` +
        `statenour<->nickstire brain bridge is intentional coupling; review any unexpected ` +
        `cross-app edges for drift.`.slice(0, 8000),
      kind: "boundary",
      confidence: 0.6,
      files: files.length > 0 ? files : ["(cross-app)"],
      evidence: [`cross-app edge count for ${pair} = ${rec.count}`, ...rec.examples]
        .map((e) => e.slice(0, 2000))
        .slice(0, 20),
      contradictionRefs: [],
    });
  }

  const rawCommit = typeof graph.built_at_commit === "string" ? graph.built_at_commit : "";
  const sourceCommit = /^[a-f0-9]{7,40}$/i.test(rawCommit) ? rawCommit : (process.env.BUILD_COMMIT?.trim() ?? "");
  if (!/^[a-f0-9]{7,40}$/i.test(sourceCommit)) {
    throw new Error(
      `No valid sourceCommit (graph.built_at_commit=${JSON.stringify(graph.built_at_commit)}, BUILD_COMMIT unset). Rebuild via \`graphify update .\`.`,
    );
  }

  // Validate against the SAME schema the ingest uses — fail loudly on drift.
  const manifest = GraphifyManifestSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit,
    generator: "build-graphify-manifest@1",
    reportPath: "graphify-out/GRAPH_REPORT.md",
    nodeCount: nodes.length,
    edgeCount: links.length,
    findings,
  });

  const outPath = path.join(graphifyRoot, "findings-manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(
    `[graphify-manifest] wrote ${findings.length} findings -> ${outPath} ` +
      `(commit ${sourceCommit.slice(0, 8)}, ${nodes.length} nodes / ${links.length} edges)`,
  );
}

main();
