#!/usr/bin/env node
/**
 * board: a machine-local picture of what every session needs to know (job 2026-10-16-session-workflow-upgrade, A).
 *
 * Why: about 60 "NO REPLY NEEDED" chat relays in one night carried facts git and GitHub already know (PR opened,
 * merged, main moved, a check went red), each costing a turn on both ends. The board writes those facts to one
 * file outside the repo and a UserPromptSubmit hook prints only what CHANGED since this session last looked.
 *
 *   node scripts/agent-os/board.mjs           print the whole board (refreshes first)
 *   node scripts/agent-os/board.mjs refresh   rebuild board.json: open PRs (one `gh pr list`), origin/main's
 *                                             last commits, local lease markers, the heavy and chrome slots
 *   node scripts/agent-os/board.mjs hook      UserPromptSubmit: at most 3 lines of changes, from the cache only.
 *                                             A board older than 60 s starts a detached refresh for the NEXT
 *                                             prompt (gh takes 1-2 s; the hook must stay under 1 s).
 *
 * Lives in %LOCALAPPDATA%/nourcity/board/ (BOARD_DIR overrides): board.json, seen/<session>.json, refreshing.
 * A failed gh read keeps the last good PR list and records prsError; a board older than 10 min prints STALE.
 * Test seams: BOARD_GH_JSON (a file standing in for gh's output), BOARD_REPO, BOARD_MAIN_REF. Canary: board.test.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLock, staleReason } from "./heavy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.BOARD_REPO || resolve(HERE, "..", "..");
const MAIN_REF = process.env.BOARD_MAIN_REF || "origin/main";
const DIR = process.env.BOARD_DIR || join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "board");
const BOARD = join(DIR, "board.json");
const REFRESH_AFTER_MS = 60_000;
const STALE_AFTER_MS = 10 * 60_000;

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const write = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};
const git = (args) => spawnSync("git", args, { cwd: REPO, encoding: "utf8", timeout: 10_000 });

/** SUCCESS / FAILURE / PENDING / NONE from a statusCheckRollup. */
export function checkState(rollup = []) {
  const states = rollup.map((c) => c.conclusion || c.state || c.status || "");
  if (!states.length) return "NONE";
  if (states.some((s) => /FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED/.test(s))) return "FAILURE";
  if (states.some((s) => /PENDING|QUEUED|IN_PROGRESS|EXPECTED|^$/.test(s))) return "PENDING";
  return "SUCCESS";
}

function readPrs() {
  if (process.env.BOARD_GH_JSON) return JSON.parse(readFileSync(process.env.BOARD_GH_JSON, "utf8"));
  const env = { ...process.env };
  delete env.GITHUB_TOKEN; // AGENTS.md > Branching: a stale GITHUB_TOKEN breaks gh; gh's own login is the one that works
  const r = spawnSync("gh", ["pr", "list", "--state", "open", "--limit", "60", "--json", "number,title,headRefName,headRefOid,statusCheckRollup"], {
    cwd: REPO, encoding: "utf8", env, timeout: 20_000,
  });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || "gh failed").trim().split("\n")[0]);
  return JSON.parse(r.stdout);
}

function readLeases() {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim();
  if (!common) return [];
  const dirs = [common, ...(existsSync(join(common, "worktrees")) ? readdirSync(join(common, "worktrees")).map((d) => join(common, "worktrees", d)) : [])];
  return dirs
    .map((d) => readJson(join(d, "agent-os-lease.json"), null))
    .filter((m) => m && (!m.expiresAt || Date.parse(m.expiresAt) > Date.now()))
    .map((m) => ({ branch: m.branch, session: m.sessionId ?? m.claimedBy ?? "?", expiresAt: m.expiresAt }));
}

function slot(name) {
  const rec = readLock(name);
  return rec && !staleReason(rec, name) ? { session: rec.session, command: rec.command, startedMs: rec.startedMs, token: rec.token } : null;
}

export function refresh() {
  write(join(DIR, "refreshing"), Date.now());
  const prev = readJson(BOARD, {});
  const board = { updatedMs: Date.now(), prs: prev.prs ?? [], prsError: null };
  try {
    board.prs = readPrs().map((p) => ({ number: p.number, title: p.title, branch: p.headRefName, sha: p.headRefOid, checks: checkState(p.statusCheckRollup) }));
  } catch (err) {
    board.prsError = String(err.message ?? err);
  }
  board.main = git(["log", "--format=%H%x09%s", "-30", MAIN_REF]).stdout.split("\n").filter(Boolean).map((l) => {
    const [sha, ...s] = l.split("\t");
    return { sha, subject: s.join("\t") };
  });
  board.leases = readLeases();
  write(BOARD, board);
  return board;
}

/** The lines a session sees: what changed since `seen`. Pure, so the canary and the hook share it. */
export function delta(board, seen, heavy, now = Date.now()) {
  const lines = [];
  if (now - board.updatedMs > STALE_AFTER_MS) lines.push(`[board] STALE: last refresh ${Math.round((now - board.updatedMs) / 60_000)} min ago${board.prsError ? ` (${board.prsError})` : ""}. Run node scripts/agent-os/board.mjs`);
  const tip = board.main?.[0]?.sha;
  if (seen.mainTip && tip && tip !== seen.mainTip) {
    const idx = board.main.findIndex((c) => c.sha === seen.mainTip);
    const fresh = board.main.slice(0, idx < 0 ? 5 : idx);
    lines.push(`[board] main moved ${idx < 0 ? `${board.main.length}+` : fresh.length}:${fresh.slice(0, 2).map((c) => c.subject.slice(0, 70)).join(" | ")}`);
  }
  const red = (board.prs ?? []).filter((p) => p.checks === "FAILURE" && seen.prChecks?.[p.number] !== "FAILURE");
  if (seen.prChecks && red.length) lines.push(`[board] went red: ${red.slice(0, 3).map((p) => `#${p.number} ${p.title.slice(0, 40)}`).join(", ")}`);
  if (heavy && heavy.token !== seen.heavyToken) lines.push(`[board] heavy lease: ${heavy.command} held by ${heavy.session} since ${new Date(heavy.startedMs).toISOString().slice(11, 16)}Z`);
  return lines.slice(0, 3);
}

function hook() {
  let session = "";
  try {
    session = String(JSON.parse(readFileSync(0, "utf8")).session_id ?? "").replace(/[^\w.-]/g, "");
  } catch {}
  if (!session) return;
  const board = readJson(BOARD, null);
  const lastRefresh = Number(readJson(join(DIR, "refreshing"), 0));
  if ((!board || Date.now() - board.updatedMs > REFRESH_AFTER_MS) && Date.now() - lastRefresh > REFRESH_AFTER_MS) {
    spawn(process.execPath, [fileURLToPath(import.meta.url), "refresh"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  if (!board) return;
  const seenFile = join(DIR, "seen", `${session}.json`);
  const seen = readJson(seenFile, {});
  const heavy = slot("heavy");
  const lines = delta(board, seen, heavy);
  if (!seen.mainTip) lines.push(`[board] ${board.prs.length} open PRs, heavy lease ${heavy ? `held by ${heavy.session}` : "free"}; full board: node scripts/agent-os/board.mjs`);
  write(seenFile, {
    mainTip: board.main?.[0]?.sha ?? seen.mainTip,
    prChecks: Object.fromEntries((board.prs ?? []).map((p) => [p.number, p.checks])),
    heavyToken: heavy?.token ?? null,
  });
  if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
}

function show() {
  const b = refresh();
  console.log(`board ${new Date(b.updatedMs).toISOString()} (${BOARD})`);
  for (const name of ["heavy", "chrome"]) {
    const s = slot(name);
    console.log(`${name}: ${s ? `${s.command} held by ${s.session} since ${new Date(s.startedMs).toISOString()}` : "free"}`);
  }
  console.log(`open PRs${b.prsError ? ` (last good list; gh failed: ${b.prsError})` : ""}:`);
  for (const p of b.prs) console.log(`  #${p.number} ${p.checks.padEnd(7)} ${p.sha?.slice(0, 9)} ${p.branch}  ${p.title}`);
  console.log("leases:");
  for (const l of b.leases) console.log(`  ${l.branch} by ${l.session} until ${l.expiresAt}`);
  console.log("main:");
  for (const c of b.main.slice(0, 8)) console.log(`  ${c.sha.slice(0, 9)} ${c.subject}`);
}

if (process.argv[1] && basename(process.argv[1]) === "board.mjs") {
  const verb = process.argv[2];
  try {
    if (verb === "hook") hook();
    else if (verb === "refresh") refresh();
    else show();
  } catch (err) {
    // Fail open: the hook must never block or break a prompt.
    process.stderr.write(`[board] ${err?.message ?? err}\n`);
    if (verb !== "hook") process.exitCode = 1;
  }
}
