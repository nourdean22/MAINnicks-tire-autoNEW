#!/usr/bin/env node
/**
 * harness-snapshot: this PC tells bdnick what state the harness is in (job 2026-11-05-harness-apps-connect).
 *
 *   node scripts/agent-os/harness-snapshot.mjs           gather, then POST to /api/devices/harness
 *   node scripts/agent-os/harness-snapshot.mjs --print   gather and print; sends nothing, needs no key
 *
 * Push only: the sites cannot reach a PC, and the reply is never read for anything but its status.
 * Every source below only reads. A source that fails sends null plus a reason in `unread`, never a zero.
 * The body is an allowlist, role names only, and scrub() removes paths and addresses from free text:
 * the server refuses a body that still carries one (lib/services/harness-status.ts).
 *
 * Machine-local config, outside the repo: %LOCALAPPDATA%/nourcity/harness-snapshot.json
 *   { "pc": "nattynour" | "mechanics" | "nicksmax", "key": "<DEVICE_AGENT_KEY>", "url": "https://bdnick.info" }
 * HARNESS_PC, HARNESS_KEY and HARNESS_URL override it. Schedule: scripts/register-harness-snapshot-task.ps1.
 * Canary: harnessSnapshot.test.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refresh } from "./board.mjs";
import { readFreeMb, readLock, staleReason } from "./heavy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DEFAULT_URL = "https://bdnick.info";
const ACTIVE_MS = 15 * 60_000;
const LOCAL_DETAIL = /[A-Za-z]:[\\/]\S*|\S*\\Users\\\S*|\S*\/(?:home|Users)\/\S*|\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

export const scrub = (text, max = 200) => String(text).replace(LOCAL_DETAIL, "[local]").slice(0, max);

/** The broken parts of session-health's line. Output it cannot judge throws: unknown is not ok. */
export function parseHealth(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith("[health]"));
  if (!line) throw new Error("no health line");
  if (/^\[health\] off:/.test(line)) throw new Error(`health script off: ${line.slice(14)}`);
  if (/not expected on this host/.test(line)) throw new Error("health checks not expected on this PC");
  const [body, fix] = line.replace(/^\[health\]\s*/, "").split(" | FIX FIRST");
  const problems = body.split(" | ").flatMap((part) => {
    if (/none configured/.test(part)) return ["servers none configured"];
    const hit = /^([\w.-]+(?: [\w.-]+)?) (DOWN|UNKNOWN|MISSING|STALE|FAILED|BLOCKED|WRONG|DISABLED)\b/.exec(part.trim());
    return hit ? [`${hit[1]} ${hit[2]}`] : [];
  });
  // The script asks for a fix this parser did not name: still not ok.
  if (fix !== undefined && problems.length === 0) problems.push("see session-health");
  return { ok: problems.length === 0, problems };
}

/** The code graph row: the same health line that names a broken graph, plus the report's build commit. */
export function parseGraph(healthStdout, report) {
  const line = healthStdout.split("\n").find((l) => l.startsWith("[health]")) ?? "";
  const parts = line.replace(/^\[health\]\s*/, "").split(" | ").map((p) => p.trim());
  const graph = parts.find((p) => /^graph\b/.test(p));
  const server = parts.find((p) => /^graphify\b/.test(p));
  if (!graph && !server) throw new Error("no code graph on this PC");
  const state = /^graphify (\S+)/.exec(server ?? "")?.[1];
  const behind = /\((\d+) behind/.exec(graph ?? "")?.[1];
  return {
    serverUp: state === "up" || state === "ok" ? true : state === "DOWN" ? false : null,
    builtCommit: /Built from commit:\s*`([0-9a-f]{7,40})`/.exec(report ?? "")?.[1] ?? null,
    behind: behind === undefined ? null : Number(behind),
  };
}

/** The private vault's graph: whether it exists and when it was built. Status only; no note is opened. */
export function readVaultGraph(vault) {
  if (!existsSync(vault)) throw new Error("no vault on this PC");
  const graph = join(vault, "graphify-out", "graph.json");
  return existsSync(graph) ? { exists: true, builtAt: statSync(graph).mtime.toISOString() } : { exists: false, builtAt: null };
}

/**
 * Desktop app sessions active in the last 15 minutes, across its account folders. A count only: this
 * reads two fields and sends neither titles nor paths. The store is the app's own file layout, so a
 * change there shows up as "no Desktop session store" or a low count, not as an error here.
 */
export function countActiveSessions(root, now = Date.now()) {
  if (!existsSync(root)) throw new Error("no Desktop session store on this PC");
  let active = 0;
  for (const account of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const org of readdirSync(join(root, account.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = join(root, account.name, org.name);
      for (const name of readdirSync(dir).filter((n) => /^local_.*\.json$/.test(n))) {
        const file = join(dir, name);
        if (now - statSync(file).mtimeMs > ACTIVE_MS) continue;
        try {
          const { lastActivityAt, isArchived } = JSON.parse(readFileSync(file, "utf8"));
          if (!isArchived && now - new Date(lastActivityAt).getTime() <= ACTIVE_MS) active += 1;
        } catch {
          // The app is mid-write on this file; the next tick reads it.
        }
      }
    }
  }
  return active;
}

const run = (cmd, args, { env = process.env, timeout = 20_000 } = {}) => {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: "utf8", env, timeout, windowsHide: true });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || `${cmd} failed`).trim().split("\n")[0]);
  return r.stdout;
};
const slotState = (name) => {
  const rec = readLock(name);
  return rec && !staleReason(rec, name) ? "busy" : "free";
};
const siteCommit = async (url, pick) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const commit = pick(await res.json())?.build?.commit;
  if (typeof commit !== "string") throw new Error("no commit in the reply");
  return commit;
};
const ghEnv = () => {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN; // Same reason as board.mjs: a stale token breaks gh; gh's own login works.
  return env;
};

/** board.mjs keeps its last good list when GitHub fails; that list is not a reading, so it throws here. */
function readPrs() {
  const board = refresh();
  if (board.prsError) throw new Error(board.prsError);
  return board.prs.map(({ number, title, branch, checks }) => ({ number, title, branch, checks }));
}
const readMerged = () =>
  JSON.parse(run("gh", ["pr", "list", "--state", "merged", "--limit", "15", "--json", "number,title,mergedAt,mergeCommit"], { env: ghEnv() })).map(
    (p) => ({ number: p.number, title: p.title, mergedAt: p.mergedAt, sha: p.mergeCommit?.oid ?? null }),
  );

const realSources = () => {
  // health and graph read the same line; session-health can take 8 s, so it runs once per snapshot.
  let healthOut;
  const healthLine = () => (healthOut ??= run(process.execPath, [join(HERE, "session-health.mjs")]));
  const graphReport = () => {
    const primary = dirname(run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
    const file = join(primary, "graphify-out", "GRAPH_REPORT.md");
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  return {
  sha: () => run("git", ["rev-parse", "HEAD"]).trim(),
  ramFreeMb: () => readFreeMb(),
  heavy: () => slotState("heavy"),
  chrome: () => slotState("chrome"),
  sessionsActive: () => countActiveSessions(join(process.env.APPDATA || join(homedir(), ".config"), "Claude", "claude-code-sessions")),
  worktrees: () => run("git", ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).length - 1,
  health: () => parseHealth(healthLine()),
  graph: () => parseGraph(healthLine(), graphReport()),
  vaultGraph: () => readVaultGraph(process.env.OBSIDIAN_VAULT_PATH || join(homedir(), "OneDrive", "Documents", "Obsidian Vault")),
  prs: readPrs,
  merged: readMerged,
  mainSha: () => run("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0],
  bdnick: () => siteCommit("https://bdnick.info/api/version", (b) => b.data),
  nickstire: () => siteCommit("https://nickstire.org/api/version", (b) => b),
  };
};

/** One source failing never stops the others: the whole point is a partial picture that says what is missing. */
export async function buildSnapshot(pc, sources) {
  const unread = {};
  const read = async (name) => {
    try {
      return await sources[name]();
    } catch (err) {
      unread[name] = scrub(err?.message ?? err);
      return null;
    }
  };
  const names = Object.keys(sources);
  const values = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await read(n)])));
  const { bdnick, nickstire, ...rest } = values;
  return {
    pc,
    ...rest,
    health: rest.health && { ok: rest.health.ok, problems: rest.health.problems.map((p) => scrub(p, 60)) },
    prs: rest.prs && rest.prs.map((p) => ({ ...p, title: scrub(p.title), branch: scrub(p.branch, 120) })),
    merged: rest.merged && rest.merged.map((p) => ({ ...p, title: scrub(p.title) })),
    sites: { bdnick, nickstire },
    unread,
  };
}

export async function sendSnapshot(snapshot, { url, key }, doFetch = fetch) {
  const res = await doFetch(`${url}/api/devices/harness`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": key },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`bdnick refused the snapshot: HTTP ${res.status}`);
}

function readConfig() {
  const file = join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "harness-snapshot.json");
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return {
    pc: process.env.HARNESS_PC || saved.pc,
    key: process.env.HARNESS_KEY || saved.key,
    url: process.env.HARNESS_URL || saved.url || DEFAULT_URL,
  };
}

async function main(args) {
  const config = readConfig();
  const print = args.includes("--print");
  if (!config.pc) throw new Error("no PC role: set pc in nourcity/harness-snapshot.json or HARNESS_PC");
  if (!print && !config.key) throw new Error("no key: set key in nourcity/harness-snapshot.json or HARNESS_KEY");
  const snapshot = await buildSnapshot(config.pc, realSources());
  if (print) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  await sendSnapshot(snapshot, config);
  const missing = Object.keys(snapshot.unread);
  console.log(`[harness-snapshot] sent for ${config.pc}${missing.length ? `; unread: ${missing.join(", ")}` : ""}`);
}

if (process.argv[1] && basename(process.argv[1]) === "harness-snapshot.mjs") {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[harness-snapshot] ${scrub(err?.message ?? err)}`);
    process.exitCode = 1;
  });
}
