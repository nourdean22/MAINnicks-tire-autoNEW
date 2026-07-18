#!/usr/bin/env node
/**
 * Refuse to run a production-capable command from a checkout that cannot be trusted.
 *
 * WHY THIS EXISTS
 * The main checkout at C:/Users/nourd/NOURCITY sits in DETACHED HEAD, 163 commits
 * behind origin/main, with uncommitted changes — and it is where apps/nickstire/.env
 * lives, so it is the natural place to run a script from. It has 95 migration files
 * where main has 104. Running `db:migrate` there would apply a months-old world to
 * production; running any admin script imports a months-old codebase against a live
 * database. This bit twice in one session: a probe failed on a missing export
 * because it ran from that checkout, and the migration ledger drifted in the first
 * place because DDL was applied from somewhere that did not match the repo.
 *
 * Nothing here mutates anything. It answers one question — "is this checkout safe
 * to act on production from?" — and exits non-zero when the answer is no.
 *
 *   node scripts/assert-safe-checkout.mjs              # human report, exit 1 if unsafe
 *   node scripts/assert-safe-checkout.mjs --json
 *   node scripts/assert-safe-checkout.mjs --warn-only  # report, always exit 0
 *
 * Intended use: the first line of any script that can touch production.
 *   node scripts/assert-safe-checkout.mjs || exit 1
 *
 * It deliberately does NOT read DATABASE_URL's credentials. It reports only the
 * host fingerprint, so a log of this output can never leak one.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const warnOnly = argv.includes("--warn-only");

/** How far behind origin/main is still tolerable for a production action. */
const MAX_BEHIND = 5;

const git = (cmd, fallback = "") => {
  try {
    return execSync(`git ${cmd}`, { cwd: APP, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
};

const problems = [];
const facts = {};

// ── identity ────────────────────────────────────────────────────────────────
facts.repoRoot = git("rev-parse --show-toplevel", "(not a git repo)");
facts.branch = git("rev-parse --abbrev-ref HEAD", "(unknown)");
facts.head = git("rev-parse --short HEAD", "(unknown)");
facts.originMain = git("rev-parse --short origin/main", "(unknown)");

if (facts.branch === "HEAD") {
  problems.push("HEAD is DETACHED — this checkout is not on a branch, so it is not tracking anything");
}

// ── freshness ───────────────────────────────────────────────────────────────
const counts = git("rev-list --left-right --count HEAD...origin/main", "");
const [aheadStr, behindStr] = counts.split(/\s+/);
facts.ahead = Number(aheadStr || 0);
facts.behind = Number(behindStr || 0);

if (!Number.isFinite(facts.behind)) {
  problems.push("cannot determine distance from origin/main (is the remote fetched?)");
} else if (facts.behind > MAX_BEHIND) {
  problems.push(`${facts.behind} commits BEHIND origin/main (max ${MAX_BEHIND}) — this code is stale`);
}

// An ancestor check catches a checkout on some unrelated history, which the
// behind-count alone would not.
const isAncestor = git(`merge-base --is-ancestor HEAD origin/main && echo yes`, "no") === "yes";
if (!isAncestor && facts.ahead === 0) {
  problems.push("HEAD is not an ancestor of origin/main and is not ahead of it — divergent history");
}

// ── cleanliness ─────────────────────────────────────────────────────────────
const dirty = git("status --porcelain", "").split("\n").filter(Boolean);
// Untracked files are noise (build output, editor droppings); MODIFIED tracked
// files mean the code about to run is not the code that was reviewed.
const modified = dirty.filter((l) => !l.startsWith("??"));
facts.modifiedFiles = modified.length;
facts.untrackedFiles = dirty.length - modified.length;
if (modified.length) {
  problems.push(`${modified.length} tracked file(s) MODIFIED — the code here is not what any commit says it is`);
}

// ── migrations on disk vs the journal ───────────────────────────────────────
try {
  const dir = path.join(APP, "drizzle");
  const sqlFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
  facts.sqlFiles = sqlFiles.length;
  facts.journalEntries = (journal.entries || []).length;
  const tags = new Set((journal.entries || []).map((e) => e.tag));
  const unjournaled = sqlFiles.map((f) => f.replace(/\.sql$/, "")).filter((t) => !tags.has(t));
  if (unjournaled.length) {
    problems.push(`${unjournaled.length} migration file(s) not in the journal (${unjournaled.slice(0, 3).join(", ")}) — a fresh env would SKIP them`);
  }
} catch (err) {
  problems.push(`cannot read migrations: ${err instanceof Error ? err.message : String(err)}`);
}

// ── target database, identified but never exposed ───────────────────────────
try {
  const envPath = path.join(APP, ".env");
  if (fs.existsSync(envPath)) {
    const url = fs.readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1];
    if (url) {
      const u = new URL(url.trim().replace(/^mysql:\/\//, "http://"));
      facts.dbHost = u.hostname;
      facts.dbName = u.pathname.replace(/^\//, "").split("?")[0];
      facts.dbFingerprint = crypto.createHash("sha256").update(`${u.hostname}:${u.port}`).digest("hex").slice(0, 12);
      // Naming the risk is the point: a .env in a checkout is how a stale script
      // reaches a live database in the first place.
      if (/prod|aws|tidbcloud/i.test(u.hostname)) facts.dbLooksProduction = true;
    }
  }
} catch { /* an unreadable .env is not itself a safety problem */ }

const safe = problems.length === 0;

if (asJson) {
  console.log(JSON.stringify({ safe, problems, facts }, null, 2));
} else {
  console.log("\n─── checkout safety ───");
  console.log(`  repo        : ${facts.repoRoot}`);
  console.log(`  branch      : ${facts.branch}`);
  console.log(`  HEAD        : ${facts.head}   origin/main: ${facts.originMain}`);
  console.log(`  distance    : ${facts.ahead} ahead, ${facts.behind} behind`);
  console.log(`  working tree: ${facts.modifiedFiles} modified, ${facts.untrackedFiles} untracked`);
  console.log(`  migrations  : ${facts.sqlFiles ?? "?"} files, ${facts.journalEntries ?? "?"} journaled`);
  if (facts.dbHost) {
    console.log(`  target db   : ${facts.dbName} @ ${facts.dbHost} [${facts.dbFingerprint}]${facts.dbLooksProduction ? "  ← LOOKS LIKE PRODUCTION" : ""}`);
  }
  if (safe) {
    console.log("\n✓ safe to run production-capable commands from here\n");
  } else {
    console.log(`\n✗ REFUSING — ${problems.length} problem(s):`);
    for (const p of problems) console.log(`    - ${p}`);
    console.log("\n  Run production commands from a checkout that is on a branch, clean, and current.\n");
  }
}

if (!safe && !warnOnly) process.exit(1);
