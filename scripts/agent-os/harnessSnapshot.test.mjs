// Canary for harness-snapshot.mjs (job 2026-11-05-harness-apps-connect). A failed read is null plus a
// reason, a real zero stays zero, and nothing local reaches the wire.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSnapshot, countActiveSessions, countSessionsAcross, parseGraph, parseHealth, readVaultGraph, recordFailure, requireSha, scrub, sendSnapshot } from "./harness-snapshot.mjs";

const ok = {
  sha: () => "726f3baad4",
  ramFreeMb: () => 4096,
  heavy: () => "free",
  chrome: () => "busy",
  sessionsActive: () => 0,
  worktrees: () => 0,
  health: () => ({ ok: true, problems: [] }),
  prs: () => [{ number: 1, title: "t", branch: "b", checks: "SUCCESS" }],
  merged: () => [],
  mainSha: () => "abcdef1",
  graph: () => ({ serverUp: true, builtCommit: "64e82ce1", behind: 2 }),
  vaultGraph: () => ({ exists: false, builtAt: null }),
  bdnick: () => "1111111",
  nickstire: () => "2222222",
};

test("every source read: no unread entries, real zeros stay zero", async () => {
  const s = await buildSnapshot("nattynour", ok);
  assert.deepEqual(s.unread, {});
  assert.equal(s.sessionsActive, 0);
  assert.equal(s.worktrees, 0);
  assert.deepEqual(s.merged, []);
  assert.deepEqual(s.sites, { bdnick: "1111111", nickstire: "2222222" });
});

test("a source that throws is null with a reason, and the others still report", async () => {
  const s = await buildSnapshot("mechanics", {
    ...ok,
    prs: () => {
      throw new Error("gh not installed");
    },
    ramFreeMb: () => {
      throw new Error("no reading");
    },
  });
  assert.equal(s.prs, null);
  assert.equal(s.ramFreeMb, null);
  assert.equal(s.unread.prs, "gh not installed");
  assert.equal(s.unread.ramFreeMb, "no reading");
  assert.equal(s.sha, "726f3baad4");
});

test("an async source that rejects is treated the same", async () => {
  const s = await buildSnapshot("nicksmax", { ...ok, bdnick: async () => { throw new Error("timeout"); } });
  assert.equal(s.sites.bdnick, null);
  assert.equal(s.unread.bdnick, "timeout");
  assert.equal(s.sites.nickstire, "2222222");
});

test("a reason or a title never carries a local path or address", async () => {
  const s = await buildSnapshot("nattynour", {
    ...ok,
    sha: () => {
      throw new Error("spawn C:\\Users\\someone\\git.exe failed at 100.64.1.2");
    },
    prs: () => [{ number: 2, title: "fix c:/Users/someone/x", branch: "b", checks: "NONE" }],
  });
  assert.doesNotMatch(s.unread.sha, /Users|100\.64/);
  assert.doesNotMatch(s.prs[0].title, /Users/);
  assert.equal(scrub("plain words"), "plain words");
});

test("parseHealth keeps only the broken parts and drops the fix commands", () => {
  const line =
    "[health] graph ok (2 behind origin/main) | graphify UNKNOWN (no answer) | claude ok | task NOURCITY-Local-MCP MISSING | tailnet: installed (optional, docs/x.md) | FIX FIRST: (1) powershell -File C:/a/b.ps1";
  assert.deepEqual(parseHealth(line), { ok: false, problems: ["graphify UNKNOWN", "task NOURCITY-Local-MCP MISSING"] });
  assert.deepEqual(parseHealth("[health] graph ok | claude ok | hooks ok"), { ok: true, problems: [] });
});

test("parseHealth never reads ok past a FIX FIRST or an empty server list", () => {
  assert.equal(parseHealth("[health] graph ok | something new broke | FIX FIRST: (1) do it").ok, false);
  assert.equal(parseHealth("[health] graph ok | servers: none configured | claude ok").ok, false);
});

test("parseHealth refuses output it cannot judge instead of calling it ok", () => {
  assert.throws(() => parseHealth(""), /no health line/);
  assert.throws(() => parseHealth("[health] off: boom"), /off/);
  assert.throws(() => parseHealth("[health] local services: not expected on this host"), /not expected/);
});

test("parseGraph reuses the health line and the report's build commit", () => {
  const report = "Built from commit: `64e82ce1`";
  assert.deepEqual(parseGraph("[health] graph ok (2 behind origin/main) | graphify up | claude ok", report), {
    serverUp: true,
    builtCommit: "64e82ce1",
    behind: 2,
  });
  assert.deepEqual(parseGraph("[health] graph STALE (80 behind origin/main) | graphify DOWN", report).serverUp, false);
  assert.equal(parseGraph("[health] graph ok (2 behind origin/main) | graphify UNKNOWN (no answer)", report).serverUp, null);
  assert.equal(parseGraph("[health] graph UNKNOWN (timeout) | graphify up", report).behind, null);
  assert.equal(parseGraph("[health] graph ok (0 behind origin/main) | graphify up", "no commit here").builtCommit, null);
  assert.equal(parseGraph("[health] graph ok (0 behind origin/main) | graphify up", report).behind, 0);
  assert.throws(() => parseGraph("[health] claude ok | hooks ok", report), /no code graph/);
});

test("readVaultGraph: no vault throws, a vault with no graph is a real no, a graph gives its build time", () => {
  const vault = mkdtempSync(join(tmpdir(), "harness-vault-"));
  assert.throws(() => readVaultGraph(join(vault, "nope")), /no vault/);
  assert.deepEqual(readVaultGraph(vault), { exists: false, builtAt: null });
  mkdirSync(join(vault, "graphify-out"));
  writeFileSync(join(vault, "graphify-out", "graph.json"), "{}");
  const got = readVaultGraph(vault);
  assert.equal(got.exists, true);
  assert.ok(!Number.isNaN(Date.parse(got.builtAt)));
  assert.deepEqual(Object.keys(got).sort(), ["builtAt", "exists"]);
});

test("countActiveSessions counts live unarchived sessions only; a missing store throws", () => {
  const root = mkdtempSync(join(tmpdir(), "harness-sessions-"));
  const dir = join(root, "account", "org");
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const write = (name, body, ageMs = 0) => {
    const f = join(dir, name);
    writeFileSync(f, JSON.stringify(body));
    utimesSync(f, new Date(now - ageMs), new Date(now - ageMs));
  };
  write("local_a.json", { lastActivityAt: now - 60_000, isArchived: false });
  write("local_b.json", { lastActivityAt: now - 60_000, isArchived: true });
  write("local_c.json", { lastActivityAt: now - 3_600_000, isArchived: false }, 3_600_000);
  write("not-a-session.json", { lastActivityAt: now, isArchived: false });
  assert.equal(countActiveSessions(root, now), 1);
  assert.throws(() => countActiveSessions(join(root, "nope"), now), /no Desktop session store/);
});

test("a session store with no session files is unknown, not zero", () => {
  const empty = mkdtempSync(join(tmpdir(), "harness-empty-"));
  assert.throws(() => countActiveSessions(empty), /no session files/);
});

test("a recent session file with no readable activity time is unknown, not zero", () => {
  const root = mkdtempSync(join(tmpdir(), "harness-fields-"));
  const dir = join(root, "account", "org");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local_a.json"), JSON.stringify({ isArchived: false }));
  assert.throws(() => countActiveSessions(root), /activity time/);
});

test("a stored session that has gone quiet is a real zero", () => {
  const root = mkdtempSync(join(tmpdir(), "harness-quiet-"));
  const dir = join(root, "account", "org");
  mkdirSync(dir, { recursive: true });
  const old = Date.now() - 3_600_000;
  const file = join(dir, "local_a.json");
  writeFileSync(file, JSON.stringify({ lastActivityAt: old, isArchived: false }));
  utimesSync(file, new Date(old), new Date(old));
  assert.equal(countActiveSessions(root), 0);
});

test("requireSha turns a blank or bad commit into a reason, so one field cannot sink the snapshot", () => {
  assert.equal(requireSha("726f3baad4\n"), "726f3baad4");
  assert.throws(() => requireSha(""), /no commit/);
  assert.throws(() => requireSha("not-a-sha"), /no commit/);
});

test("recordFailure writes the last failure as one line and a success clears it", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-log-"));
  recordFailure(dir, new Error("bdnick refused the snapshot: HTTP 401"), new Date("2026-11-05T15:00:00.000Z"));
  const file = join(dir, "harness-snapshot-last-failure.txt");
  assert.equal(readFileSync(file, "utf8"), "2026-11-05T15:00:00.000Z bdnick refused the snapshot: HTTP 401\n");
  recordFailure(dir, null);
  assert.equal(existsSync(file), false);
});

test("countSessionsAcross finds a Store build's session store, not only a plain install's", () => {
  const home = mkdtempSync(join(tmpdir(), "harness-home-"));
  const now = Date.now();
  const store = join(home, "AppData", "Local", "Claude-Data", "anthropicpbc.claude_abc123", "claude-code-sessions", "account", "org");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, "local_a.json"), JSON.stringify({ lastActivityAt: now - 1000, isArchived: false }));
  assert.equal(countSessionsAcross(home, now), 1);
  const plain = join(home, "AppData", "Roaming", "Claude", "claude-code-sessions", "account", "org");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, "local_b.json"), JSON.stringify({ lastActivityAt: now - 1000, isArchived: false }));
  assert.equal(countSessionsAcross(home, now), 2);
  assert.throws(() => countSessionsAcross(mkdtempSync(join(tmpdir(), "harness-none-")), now), /no Desktop session store/);
});

test("sendSnapshot posts to the harness door with the key and fails loudly on a refusal", async () => {
  const calls = [];
  const fetchOk = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  await sendSnapshot({ pc: "nicksmax" }, { url: "https://example.test", key: "k" }, fetchOk);
  assert.equal(calls[0].url, "https://example.test/api/devices/harness");
  assert.equal(calls[0].init.headers["x-sync-key"], "k");
  await assert.rejects(sendSnapshot({}, { url: "https://example.test", key: "k" }, async () => ({ ok: false, status: 401 })), /401/);
});
