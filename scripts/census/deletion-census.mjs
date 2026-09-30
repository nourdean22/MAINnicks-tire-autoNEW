#!/usr/bin/env node
/**
 * Weekly unwired / deletion census (Q-33, estate architecture §14.4).
 *
 * WHAT IT ANSWERS. Two questions nothing else in the repo asks:
 *
 *   1. ENV · Which variables does Railway hold for a service (`.railway/railway.ts`, the
 *      repo's only deploy config) that no code in that service's tree reads?
 *   2. TABLES · Which tables (nickstire Drizzle, statenour Prisma) does no code read?
 *
 * The neighbouring questions already have gates, so this census does not repeat them:
 *   · unused files/exports — knip, blocking for statenour and new-orphan-blocking for
 *     nickstire (.github/workflows/adoption-gates.yml, `lint:orphans`);
 *   · tables read with no writer — apps/nickstire/server/__tests__/tableWriterCoverage.test.ts;
 *   · procedures never called — needs production `[tRPC first-call]` logs, so it is an
 *     interactive harvest (I-4, apps/nickstire/docs/DEAD-PROCEDURE-HARVEST-2026-08-30.md)
 *     against the registered list in eval-datasets/proc-census.json.
 *
 * VERDICTS, per item:
 *   · DELETE — no reference anywhere in the tree outside definitions, migrations, docs and
 *     tests. A CANDIDATE, not an instruction: this is code-side evidence only. Deleting a
 *     Railway variable or dropping a table is an operator action, after a production read
 *     (a zero-row count, a variable nobody set on purpose).
 *   · WATCH — referenced, but only by tests, or (tables) written and never read, or named
 *     without any visible read or write.
 *   · KEEP — listed in deletion-census.keep.json with a reason (read by the platform or a
 *     library, not by our code). A KEEP entry whose item is no longer flagged, or no longer
 *     exists, is reported as STALE so the keep list cannot rot silently.
 *
 * The rule is deliberately conservative: ANY literal mention of the name in code counts as
 * a reference. The April-2026 hand census (apps/statenour/prisma/DEAD_MODELS.md) listed 33
 * dead models and 30 were live; a false DELETE is the expensive error, a missed one is cheap.
 *
 * Usage:  node scripts/census/deletion-census.mjs [--json]
 * Exit 1 only when the instrument is blind (it parsed no services or no tables, or a
 * known-live control item came back flagged). A long list of findings still exits 0: this
 * is a census, not a gate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Railway service name → the tracked trees whose code runs as that service. */
export const SERVICE_TREES = {
  "MAINnicks-tire-auto": ["apps/nickstire/", "packages/"],
  "statenour-web": ["apps/statenour/", "packages/"],
  "statenour-worker": ["apps/worker/", "packages/"],
};

const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|prisma|sh|ps1|toml|yaml|yml)$|(^|\/)(Dockerfile[^/]*|package\.json|vercel\.json|next\.config\.[a-z]+)$/;
const TEST_FILE = /(\.(test|spec)\.[a-z]+$)|(^|\/)(__tests__|tests?|e2e|__mocks__|fixtures)\//;
const NEVER_CODE = /(^|\/)(node_modules|dist|build|\.next|_archive|docs|\.remember|eval-datasets|coverage)\//;

/** One literal-word matcher per name; names are A-Z0-9_ or identifiers, so escaping is cheap. */
function word(name) {
  return new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`);
}

// ─── parsers ────────────────────────────────────────────────────────────────────────────

/** `service("<name>", { … env: { A: preserve(), … } … })` → Map<service, names[]>. */
export function parseRailwayEnv(railwayTs) {
  const out = new Map();
  const serviceRe = /service\("([^"]+)",\s*\{/g;
  const starts = [...railwayTs.matchAll(serviceRe)].map((m) => ({ name: m[1], at: m.index }));
  starts.forEach((s, i) => {
    const body = railwayTs.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : railwayTs.length);
    const env = body.match(/\benv:\s*\{([^}]*)\}/);
    const names = env ? [...env[1].matchAll(/([A-Z][A-Z0-9_]*)\s*:/g)].map((m) => m[1]) : [];
    out.set(s.name, names);
  });
  return out;
}

/** Drizzle `export const ident = mysqlTable("sql_name", …` → [{ ident, name }]. */
export function parseDrizzleTables(schemaTs) {
  return [...schemaTs.matchAll(/^export const ([A-Za-z0-9_]+) = mysqlTable\(\s*"([A-Za-z0-9_]+)"/gm)].map((m) => ({
    ident: m[1],
    name: m[2],
  }));
}

/** Prisma models → [{ model, table, accessor, aliases }] where aliases are relation fields pointing at it. */
export function parsePrismaModels(schemaPrisma) {
  const blocks = [...schemaPrisma.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ model: m[1], body: m[2] }));
  const names = new Set(blocks.map((b) => b.model));
  const aliases = new Map(blocks.map((b) => [b.model, new Set()]));
  for (const b of blocks) {
    for (const f of b.body.matchAll(/^\s+(\w+)\s+(\w+)(\[\])?\??/gm)) {
      if (names.has(f[2]) && f[1] !== f[2]) aliases.get(f[2]).add(f[1]);
    }
  }
  return blocks.map((b) => ({
    model: b.model,
    table: b.body.match(/@@map\("([^"]+)"\)/)?.[1] ?? b.model,
    accessor: b.model[0].toLowerCase() + b.model.slice(1),
    aliases: [...aliases.get(b.model)],
  }));
}

// ─── classifiers (pure: files is Array<{ path, text }>) ────────────────────────────────

const isTest = (p) => TEST_FILE.test(p);

/** Env: DELETE when no code file names the variable, WATCH when only tests do. */
export function classifyEnv(service, names, files) {
  const out = [];
  for (const name of names) {
    const re = word(name);
    const hits = files.filter((f) => re.test(f.text)).map((f) => f.path);
    const code = hits.filter((p) => !isTest(p));
    if (code.length > 0) continue;
    out.push({
      key: `env:${service}:${name}`,
      kind: "env",
      scope: service,
      name,
      verdict: hits.length === 0 ? "DELETE" : "WATCH",
      evidence: hits.length === 0 ? "no reference in the service tree" : `referenced only by tests: ${hits.slice(0, 3).join(", ")}`,
    });
  }
  return out;
}

/**
 * Tables. `patterns` = { names: string[] (every spelling), read, write, purge: RegExp[] }.
 * DELETE: no spelling appears in non-test code. WATCH: written but never read, or named
 * with no visible read/write. A table with any visible read is live and not listed.
 */
export function classifyTable(scope, label, patterns, files) {
  const code = files.filter((f) => !isTest(f.path));
  const nameRes = patterns.names.map(word);
  const mentioned = code.filter((f) => nameRes.some((re) => re.test(f.text)));
  const readers = mentioned.filter((f) => patterns.read.some((re) => re.test(f.text)));
  const writers = mentioned.filter((f) => patterns.write.some((re) => re.test(f.text)));
  const purgers = mentioned.filter((f) => (patterns.purge ?? []).some((re) => re.test(f.text)));
  const base = { key: `table:${scope}:${label}`, kind: "table", scope, name: label };
  if (mentioned.length === 0) return { ...base, verdict: "DELETE", evidence: "no reference in code (schema, migrations, docs and tests excluded)" };
  if (readers.length > 0) return null;
  if (writers.length > 0) {
    return { ...base, verdict: "WATCH", evidence: `written, never read (${writers.length} writer file(s), e.g. ${writers[0].path})` };
  }
  if (purgers.length > 0) {
    return { ...base, verdict: "WATCH", evidence: `only ever purged — never inserted, updated or read (e.g. ${purgers[0].path})` };
  }
  return { ...base, verdict: "WATCH", evidence: `named but no visible read or write (${mentioned.length} file(s), e.g. ${mentioned[0].path})` };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function drizzlePatterns({ ident, name }) {
  const id = `(?:schema\\.)?${esc(ident)}\\b`;
  const sql = `\`?${esc(name)}\`?\\b`;
  return {
    names: [ident, name],
    read: [
      new RegExp(`\\.from\\(\\s*${id}`),
      new RegExp(`[jJ]oin\\(\\s*${id}`),
      new RegExp(`\\.query\\.${esc(ident)}\\.`),
      new RegExp(`(?<!DELETE\\s{1,4})\\b(?:FROM|JOIN)\\s+${sql}`, "i"),
    ],
    write: [
      new RegExp(`\\.(?:insert|update)\\(\\s*${id}`),
      new RegExp(`\\b(?:INSERT\\s+(?:IGNORE\\s+)?INTO|REPLACE\\s+INTO|UPDATE)\\s+${sql}`, "i"),
    ],
    purge: [
      new RegExp(`\\.delete\\(\\s*${id}`),
      new RegExp(`\\bDELETE\\s+FROM\\s+${sql}`, "i"),
    ],
  };
}

export function prismaPatterns({ model, table, accessor, aliases }) {
  const acc = esc(accessor);
  const tbl = `"?${esc(table)}"?(?![A-Za-z0-9_])`;
  return {
    names: [model, accessor, table, ...aliases],
    read: [
      // \s* between the links: prettier breaks long chains as `prisma.task\n  .findMany(`.
      new RegExp(`\\.${acc}\\s*\\.\\s*(?:findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|aggregate|groupBy)\\b`),
      new RegExp(`(?<!DELETE\\s{1,4})\\b(?:FROM|JOIN)\\s+${tbl}`, "i"),
      // A relation field read through include/select is a read of this model.
      ...aliases.map((a) => new RegExp(`\\b(?:include|select)\\s*:\\s*\\{[^}]*\\b${esc(a)}\\s*:`)),
    ],
    write: [
      new RegExp(`\\.${acc}\\s*\\.\\s*(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\\b`),
      new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE)\\s+${tbl}`, "i"),
    ],
    purge: [
      new RegExp(`\\.${acc}\\s*\\.\\s*(?:delete|deleteMany)\\b`),
      new RegExp(`\\bDELETE\\s+FROM\\s+${tbl}`, "i"),
    ],
  };
}

/** Apply the keep list: flagged+kept → KEEP; kept but not flagged (or gone) → STALE. */
export function applyKeep(findings, keep, knownKeys) {
  const out = findings.map((f) => (keep[f.key] ? { ...f, verdict: "KEEP", evidence: `${f.evidence} · kept: ${keep[f.key]}` } : f));
  const flagged = new Set(findings.map((f) => f.key));
  for (const [key, reason] of Object.entries(keep)) {
    if (flagged.has(key)) continue;
    const [kind, scope, ...rest] = key.split(":");
    out.push({
      key,
      kind,
      scope,
      name: rest.join(":"),
      verdict: "STALE",
      evidence: knownKeys.has(key) ? `now referenced by code; remove this keep entry (${reason})` : `no longer exists; remove this keep entry (${reason})`,
    });
  }
  return out;
}

// ─── repo I/O ───────────────────────────────────────────────────────────────────────────

export function trackedFiles(prefixes, { excludeDefinitions = [] } = {}) {
  const all = execFileSync("git", ["ls-files", "-z", ...prefixes], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
    .toString()
    .split("\0")
    .filter(Boolean);
  const out = [];
  for (const path of all) {
    if (!CODE_FILE.test(path) || NEVER_CODE.test(path)) continue;
    if (excludeDefinitions.some((re) => re.test(path))) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, path), "utf8");
    } catch {
      continue; // listed but absent (sparse checkout) — not a reference either way
    }
    out.push({ path, text });
  }
  return out;
}

export function runCensus() {
  const railway = parseRailwayEnv(readFileSync(join(ROOT, ".railway/railway.ts"), "utf8"));
  const keep = JSON.parse(readFileSync(join(HERE, "deletion-census.keep.json"), "utf8")).keep;
  const findings = [];
  const knownKeys = new Set();
  const controls = [];

  // `.railway/` itself only DECLARES variables; it is not in any service tree.
  for (const [service, names] of railway) {
    const trees = SERVICE_TREES[service];
    if (!trees) throw new Error(`deletion-census: railway.ts service "${service}" has no tree mapping`);
    const files = trackedFiles(trees);
    for (const n of names) knownKeys.add(`env:${service}:${n}`);
    findings.push(...classifyEnv(service, names, files));
  }

  const nickSchema = readFileSync(join(ROOT, "apps/nickstire/drizzle/schema.ts"), "utf8");
  const nickTables = parseDrizzleTables(nickSchema);
  const nickFiles = trackedFiles(["apps/nickstire/", "packages/"], { excludeDefinitions: [/^apps\/nickstire\/drizzle\//] });
  for (const t of nickTables) {
    knownKeys.add(`table:nickstire:${t.name}`);
    const f = classifyTable("nickstire", t.name, drizzlePatterns(t), nickFiles);
    if (f) findings.push(f);
  }

  const stnModels = parsePrismaModels(readFileSync(join(ROOT, "apps/statenour/prisma/schema.prisma"), "utf8"));
  const stnFiles = trackedFiles(["apps/statenour/", "packages/"], { excludeDefinitions: [/^apps\/statenour\/prisma\/(schema\.prisma|migrations|migrations-pending)/] });
  for (const m of stnModels) {
    knownKeys.add(`table:statenour:${m.model}`);
    const f = classifyTable("statenour", m.model, prismaPatterns(m), stnFiles);
    if (f) findings.push(f);
  }

  // Built-in positive controls: the instrument must see these as LIVE, and must have parsed something.
  const flagged = new Set(findings.map((f) => f.key));
  if (railway.size === 0) controls.push("parsed zero Railway services");
  if (nickTables.length === 0) controls.push("parsed zero Drizzle tables");
  if (stnModels.length === 0) controls.push("parsed zero Prisma models");
  for (const live of ["env:MAINnicks-tire-auto:DATABASE_URL", "env:statenour-web:TELEGRAM_BOT_TOKEN", "table:nickstire:leads", "table:statenour:Task"]) {
    if (!knownKeys.has(live)) controls.push(`control ${live} was not parsed`);
    else if (flagged.has(live)) controls.push(`control ${live} came back flagged — the reference scan is blind`);
  }

  return {
    findings: applyKeep(findings, keep, knownKeys),
    totals: { services: railway.size, envVars: [...railway.values()].reduce((a, v) => a + v.length, 0), drizzleTables: nickTables.length, prismaModels: stnModels.length },
    controls,
  };
}

export function renderMarkdown({ findings, totals, controls }) {
  const order = { DELETE: 0, WATCH: 1, STALE: 2, KEEP: 3 };
  const rows = [...findings].sort((a, b) => order[a.verdict] - order[b.verdict] || a.key.localeCompare(b.key));
  const count = (v) => findings.filter((f) => f.verdict === v).length;
  const lines = [
    "## Deletion census (Q-33)",
    "",
    `Scanned ${totals.envVars} Railway variables across ${totals.services} services, ${totals.drizzleTables} nickstire tables and ${totals.prismaModels} statenour models.`,
    `**${count("DELETE")} DELETE · ${count("WATCH")} WATCH · ${count("STALE")} STALE keep entries · ${count("KEEP")} KEEP.**`,
    "",
    "DELETE is a code-side candidate, not an instruction: removing a Railway variable or dropping a table is an operator action after a production read.",
    "",
  ];
  if (controls.length) lines.push(`> **INSTRUMENT BLIND:** ${controls.join("; ")}`, "");
  lines.push("| Verdict | Kind | Scope | Name | Evidence |", "|---|---|---|---|---|");
  for (const f of rows) lines.push(`| ${f.verdict} | ${f.kind} | ${f.scope} | \`${f.name}\` | ${f.evidence.replace(/\|/g, "\\|")} |`);
  return lines.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runCensus();
  process.stdout.write(process.argv.includes("--json") ? JSON.stringify(result, null, 2) + "\n" : renderMarkdown(result));
  if (result.controls.length) {
    process.stderr.write(`deletion-census: instrument blind — ${result.controls.join("; ")}\n`);
    process.exit(1);
  }
}
