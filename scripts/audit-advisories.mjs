#!/usr/bin/env node
/**
 * Dependency vulnerability audit — replacement for `pnpm audit`.
 *
 * WHY THIS EXISTS
 * `pnpm audit` (through at least pnpm 10.4.1) POSTs to npm's legacy audit
 * endpoint, /-/npm/v1/security/audits. npm RETIRED that endpoint; it now
 * answers 410 for every request:
 *
 *   ERR_PNPM_AUDIT_BAD_RESPONSE ... responded with 410:
 *   "This endpoint is being retired. Use the bulk advisory endpoint instead."
 *
 * That made the blocking CI gate fail on 100% of PRs regardless of content,
 * which is worse than no gate: a real critical CVE looked identical to the
 * endpoint being gone. `.github/workflows/dependency-review.yml` does NOT
 * cover the gap — it is continue-on-error AND no-ops entirely until GitHub
 * Dependency Graph is enabled on the repo.
 *
 * This script keeps the same contract the workflow already relied on
 * (prod-only dependencies, --audit-level threshold, non-zero exit to block)
 * but targets the bulk advisory endpoint, which is live:
 *
 *   POST /-/npm/v1/security/advisories/bulk   {"name": ["1.2.3", ...]}
 *   -> {"name": [{id, url, title, severity, vulnerable_versions, cwe, cvss}]}
 *
 * The endpoint only returns advisories that affect the exact versions posted,
 * and omits clean packages from the response entirely.
 *
 * Usage:
 *   node scripts/audit-advisories.mjs --audit-level=critical   # exit 1 on hit
 *   node scripts/audit-advisories.mjs --audit-level=high --advisory  # report only
 *   node scripts/audit-advisories.mjs --audit-level=high --json
 */

import { execFileSync } from "node:child_process";

const BULK_ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];
const CHUNK_SIZE = 250;

const args = process.argv.slice(2);
const levelArg = args.find((a) => a.startsWith("--audit-level="));
const level = levelArg ? levelArg.split("=")[1] : "critical";
const advisoryOnly = args.includes("--advisory");
const asJson = args.includes("--json");

if (!SEVERITY_ORDER.includes(level)) {
  console.error(`Unknown --audit-level=${level}. Expected one of: ${SEVERITY_ORDER.join(", ")}`);
  process.exit(2);
}
const threshold = SEVERITY_ORDER.indexOf(level);

/** Collect every prod dependency in the workspace as name -> Set(versions). */
function collectProdDependencies() {
  // shell:true on Windows only — pnpm resolves to pnpm.cmd there, and Node
  // refuses to spawn a .cmd without a shell (the CVE-2024-27980 fix), failing
  // EINVAL. Safe here: every argument is a literal, none is user input. CI is
  // Linux, where this takes the no-shell path.
  const raw = execFileSync(
    "pnpm",
    ["list", "-r", "--prod", "--depth", "Infinity", "--json"],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      shell: process.platform === "win32",
    }
  );

  const projects = JSON.parse(raw);
  const found = new Map();

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const group of ["dependencies", "optionalDependencies"]) {
      const deps = node[group];
      if (!deps) continue;
      for (const [name, info] of Object.entries(deps)) {
        if (!info || typeof info !== "object") continue;
        const version = String(info.version ?? "");
        // Workspace links ("link:../utils") and non-registry specs have no
        // published advisory record — skip rather than send junk upstream.
        if (!/^\d+\.\d+\.\d+/.test(version)) {
          if (info.dependencies) visit(info);
          continue;
        }
        // pnpm can suffix peer-resolved versions ("1.2.3(react@19.0.0)").
        const clean = version.split(/[(\s_]/)[0];
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(clean);
        if (info.dependencies) visit(info);
      }
    }
  };

  for (const project of projects) visit(project);
  return found;
}

async function queryBulk(chunk) {
  const body = {};
  for (const [name, versions] of chunk) body[name] = [...versions];

  const res = await fetch(BULK_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `bulk advisory endpoint responded ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
  return res.json();
}

function chunked(entries, size) {
  const out = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

async function main() {
  const deps = collectProdDependencies();
  const entries = [...deps.entries()].sort(([a], [b]) => a.localeCompare(b));
  const versionCount = entries.reduce((n, [, v]) => n + v.size, 0);

  if (entries.length === 0) {
    console.error("No prod dependencies resolved — refusing to report a false all-clear.");
    process.exit(2);
  }

  // Pass 1 — bulk scan. The endpoint returns advisories affecting ANY of the
  // versions posted for a name, so a hit here does not tell us WHICH installed
  // version is vulnerable.
  const flagged = new Map(); // name -> advisory[]
  for (const chunk of chunked(entries, CHUNK_SIZE)) {
    const result = await queryBulk(chunk);
    for (const [name, advisories] of Object.entries(result)) {
      const atLevel = advisories.filter((a) => SEVERITY_ORDER.indexOf(a.severity) >= threshold);
      if (atLevel.length > 0) flagged.set(name, atLevel);
    }
  }

  // Pass 2 — attribute each advisory to the exact versions that trigger it, by
  // re-querying one version at a time. Without this a package that has both a
  // vulnerable and a patched copy installed (e.g. esbuild 0.27.7 + 0.28.1)
  // reports BOTH as affected, which reads as a false positive and is how a
  // gate loses the reader's trust. Only runs for already-flagged packages, so
  // the extra requests are negligible.
  const hits = [];
  for (const [name, advisories] of flagged) {
    const installed = [...(deps.get(name) ?? [])];
    const affectedBy = new Map(); // advisory id -> versions[]

    for (const version of installed) {
      const single = await queryBulk([[name, new Set([version])]]);
      for (const a of single[name] ?? []) {
        if (SEVERITY_ORDER.indexOf(a.severity) < threshold) continue;
        if (!affectedBy.has(a.id)) affectedBy.set(a.id, []);
        affectedBy.get(a.id).push(version);
      }
    }

    for (const a of advisories) {
      const affected = affectedBy.get(a.id) ?? [];
      if (affected.length === 0) continue; // no installed version actually hit
      hits.push({
        name,
        severity: a.severity,
        rank: SEVERITY_ORDER.indexOf(a.severity),
        title: a.title,
        vulnerable_versions: a.vulnerable_versions,
        affected: affected.join(", "),
        unaffected: installed.filter((v) => !affected.includes(v)).join(", "),
        url: a.url,
      });
    }
  }

  hits.sort((x, y) => y.rank - x.rank || x.name.localeCompare(y.name));

  if (asJson) {
    console.log(JSON.stringify({ level, scanned: entries.length, versions: versionCount, hits }, null, 2));
  } else {
    console.log(`\nDependency audit (bulk advisory endpoint)`);
    console.log(`  scanned : ${entries.length} prod packages (${versionCount} distinct versions)`);
    console.log(`  level   : ${level}+ ${advisoryOnly ? "(advisory — never blocks)" : "(BLOCKING)"}`);

    if (hits.length === 0) {
      console.log(`\n  No advisories at ${level}+ severity.\n`);
    } else {
      console.log(`\n  ${hits.length} advisory(ies) at ${level}+:\n`);
      for (const h of hits) {
        const other = h.unaffected ? `  (also installed, not affected: ${h.unaffected})` : "";
        console.log(`  [${h.severity.toUpperCase()}] ${h.name}@${h.affected}${other}`);
        console.log(`      ${h.title}`);
        console.log(`      vulnerable: ${h.vulnerable_versions}`);
        console.log(`      ${h.url}\n`);
      }
    }
  }

  if (hits.length > 0 && !advisoryOnly) {
    console.error(`FAIL: ${hits.length} advisory(ies) at ${level}+ severity.`);
    process.exit(1);
  }
}

main().catch((err) => {
  // A broken scanner must be loud. Silently exiting 0 here is how the
  // previous gate rotted into a permanent red that everyone learned to ignore.
  console.error(`\nAudit FAILED to run: ${err.message}`);
  process.exit(2);
});
