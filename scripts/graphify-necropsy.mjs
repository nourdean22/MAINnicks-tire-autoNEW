/**
 * graphify-necropsy — importer-death detector over graphify snapshots.
 *
 * THE DISEASE: built-tested-unwired. One audit found 4 zero-caller organs;
 * the 2026-08-05 census found 4 more (reflection-engine,
 * buildCalibrationPromptBlock, suggestion-improve, calibrated-confidence) —
 * each discovered by hand, months after the amputating commit. skill-recall
 * died silently in a prompt cutover and stayed dead for weeks.
 *
 * WHAT THIS DOES: graphify already snapshots the whole-repo graph near-daily
 * into graphify-out/<date>/graph.json. This differ compares two snapshots and
 * flags every still-on-disk code symbol whose USAGE degree (incoming
 * imports/imports_from/calls/references/indirect_call/uses/re_exports edges)
 * dropped from >0 to 0 — a death event — then names the likely killing
 * commit(s) via git log on the symbol's file since the old snapshot's date.
 *
 * PROPOSE-ONLY, by the same contract as session-observer: it writes a
 * wire-or-delete docket to graphify-out/NECROPSY.md and prints a summary.
 * It never deletes, never edits code, never alerts. Exit 0 always in report
 * mode; only --self-test can exit non-zero (the check must be able to fail).
 *
 * Usage:
 *   node scripts/graphify-necropsy.mjs                    # diff two newest snapshots
 *   node scripts/graphify-necropsy.mjs --old 2026-08-05 --new 2026-08-06
 *   node scripts/graphify-necropsy.mjs --query reflection-engine
 *   node scripts/graphify-necropsy.mjs --self-test
 *
 * Caveats (from the graphify skill + memory):
 *  · Snapshots are built from a pinned commit that can trail HEAD — the
 *    docket names snapshot dates so a reader can judge staleness.
 *  · Community ids reshuffle between runs; node ids are path-derived and
 *    stable, which is what makes this diff possible.
 *  · The graph mixes doc/rationale nodes with code — only file_type "code"
 *    nodes with a non-empty source_file are judged.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USAGE_RELATIONS = new Set([
  "imports",
  "imports_from",
  "calls",
  "references",
  "indirect_call",
  "uses",
  "re_exports",
]);

const OUT_DIR = "graphify-out";
const MAX_REPORTED = 50;

function parseArgs(argv) {
  const args = { old: null, new: null, query: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--old") args.old = argv[++i];
    else if (argv[i] === "--new") args.new = argv[++i];
    else if (argv[i] === "--query") args.query = argv[++i];
    else if (argv[i] === "--self-test") args.selfTest = true;
  }
  return args;
}

function snapshotDirs() {
  return readdirSync(OUT_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => existsSync(join(OUT_DIR, d, "graph.json")))
    .sort();
}

function loadGraph(dateDir) {
  return JSON.parse(readFileSync(join(OUT_DIR, dateDir, "graph.json"), "utf8"));
}

/**
 * Usage degree per node id: how many usage-relation edges point AT the node.
 * The link objects carry source→target direction even though the container
 * graph is declared undirected.
 */
export function usageDegrees(graph) {
  const deg = new Map();
  for (const link of graph.links ?? []) {
    if (!USAGE_RELATIONS.has(link.relation)) continue;
    deg.set(link.target, (deg.get(link.target) ?? 0) + 1);
  }
  return deg;
}

function codeNodes(graph) {
  const map = new Map();
  for (const n of graph.nodes ?? []) {
    if (n.file_type === "code" && n.source_file) map.set(n.id, n);
  }
  return map;
}

/**
 * Death events: code symbols present in BOTH snapshots whose usage degree
 * went >0 → 0 and whose file still exists on disk. A symbol that vanished
 * with its file died on purpose; a symbol still on disk with zero users is
 * the orphan class this exists to catch.
 */
export function findDeaths(oldGraph, newGraph, fileExists = existsSync) {
  const oldDeg = usageDegrees(oldGraph);
  const newDeg = usageDegrees(newGraph);
  const oldNodes = codeNodes(oldGraph);
  const newNodes = codeNodes(newGraph);

  const deaths = [];
  for (const [id, node] of newNodes) {
    if (!oldNodes.has(id)) continue;
    const before = oldDeg.get(id) ?? 0;
    const after = newDeg.get(id) ?? 0;
    if (before > 0 && after === 0 && fileExists(node.source_file)) {
      deaths.push({
        id,
        label: node.label,
        file: node.source_file,
        location: node.source_location || "",
        importersBefore: before,
      });
    }
  }
  deaths.sort((a, b) => b.importersBefore - a.importersBefore);
  return deaths;
}

function blameCommits(file, sinceDate) {
  try {
    const out = execFileSync(
      "git",
      ["log", `--since=${sinceDate}`, "--format=%h %ad %s", "--date=short", "-3", "--", file],
      { encoding: "utf8", timeout: 15_000 },
    ).trim();
    return out || "(no commits touched this file in the window — the killer edited an importer elsewhere)";
  } catch {
    return "(git log unavailable)";
  }
}

function runReport(oldDate, newDate) {
  console.log(`necropsy: ${oldDate} → ${newDate}`);
  const oldGraph = loadGraph(oldDate);
  const newGraph = loadGraph(newDate);
  const deaths = findDeaths(oldGraph, newGraph);

  const lines = [
    `# NECROPSY — importer-death report`,
    ``,
    `Compared \`${oldDate}\` → \`${newDate}\` (graphify snapshots; the graph can trail HEAD by the snapshot's pinned commit).`,
    `A death = a code symbol still on disk whose usage degree (incoming ${[...USAGE_RELATIONS].join("/")} edges) dropped from >0 to 0 between snapshots.`,
    ``,
    `**${deaths.length} death event(s).**${deaths.length > MAX_REPORTED ? ` Showing top ${MAX_REPORTED} by prior importer count.` : ""}`,
    ``,
    `This is a PROPOSE-ONLY docket: every entry is a wire-or-delete decision for the operator, never an automatic action.`,
    ``,
    `Read with two caveats: (1) TEST files count as importers, so a symbol only its test imports still shows >0 — a 0 here is a strong signal; (2) day-over-day extractor variance can produce false deaths — an entry that recurs across several dockets is real, a one-day blip may be noise.`,
    ``,
  ];

  for (const d of deaths.slice(0, MAX_REPORTED)) {
    lines.push(
      `## ${d.label}`,
      ``,
      `- node: \`${d.id}\``,
      `- file: \`${d.file}\`${d.location ? ` (${d.location})` : ""}`,
      `- importers before: ${d.importersBefore} → **0**`,
      `- commits touching the file since ${oldDate}:`,
      "```",
      blameCommits(d.file, oldDate),
      "```",
      ``,
    );
  }
  if (deaths.length === 0) {
    lines.push(`No deaths between these snapshots. (Absence of NEW deaths says nothing about symbols that were already at zero — use --query for those.)`);
  }

  const outPath = join(OUT_DIR, "NECROPSY.md");
  writeFileSync(outPath, lines.join("\n"));
  console.log(`${deaths.length} death(s) → ${outPath}`);
  for (const d of deaths.slice(0, 10)) {
    console.log(`  ✝ ${d.label} · ${d.file} · ${d.importersBefore} → 0`);
  }
}

function runQuery(term) {
  const dirs = snapshotDirs();
  const latest = dirs[dirs.length - 1];
  const graph = loadGraph(latest);
  const deg = usageDegrees(graph);
  const matches = (graph.nodes ?? []).filter(
    (n) => n.id.includes(term) || (n.source_file ?? "").includes(term),
  );
  console.log(`query "${term}" against ${latest}: ${matches.length} node(s)`);
  for (const n of matches.slice(0, 30)) {
    console.log(`  ${deg.get(n.id) ?? 0} usage-edges · ${n.label} · ${n.source_file || "(no file)"} · ${n.id}`);
  }
}

function selfTest() {
  // Fixture: symbol "victim" loses its one importer between snapshots while
  // its file stays on disk. "survivor" keeps an importer. "demolished" loses
  // importers but its file is gone. package.json is the on-disk anchor —
  // present from any repo cwd, unlike this script (which lives only in a
  // worktree until merged; the first self-test run failed exactly there).
  const nodes = [
    { id: "victim", label: "victim()", file_type: "code", source_file: "package.json" },
    { id: "survivor", label: "survivor()", file_type: "code", source_file: "package.json" },
    { id: "demolished", label: "demolished()", file_type: "code", source_file: "scripts/__no_such_file__.ts" },
    { id: "caller", label: "caller()", file_type: "code", source_file: "package.json" },
  ];
  const oldGraph = {
    nodes,
    links: [
      { relation: "calls", source: "caller", target: "victim" },
      { relation: "imports", source: "caller", target: "survivor" },
      { relation: "calls", source: "caller", target: "demolished" },
      { relation: "contains", source: "caller", target: "victim" }, // non-usage edge must not count
    ],
  };
  const newGraph = {
    nodes,
    links: [
      { relation: "imports", source: "caller", target: "survivor" },
      { relation: "contains", source: "caller", target: "victim" },
    ],
  };
  const deaths = findDeaths(oldGraph, newGraph);
  const ids = deaths.map((d) => d.id);
  const pass = ids.length === 1 && ids[0] === "victim";
  console.log(pass ? "self-test PASS — victim flagged, survivor and demolished-file correctly ignored" : `self-test FAIL — flagged: ${JSON.stringify(ids)}`);
  process.exit(pass ? 0 : 1);
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  selfTest();
} else if (args.query) {
  runQuery(args.query);
} else {
  const dirs = snapshotDirs();
  if (dirs.length < 2) {
    console.error(`need at least 2 snapshots under ${OUT_DIR}/ — found ${dirs.length}`);
    process.exit(2);
  }
  const oldDate = args.old ?? dirs[dirs.length - 2];
  const newDate = args.new ?? dirs[dirs.length - 1];
  runReport(oldDate, newDate);
}
