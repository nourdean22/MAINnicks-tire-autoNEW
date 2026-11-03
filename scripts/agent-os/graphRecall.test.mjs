// Canary for scripts/agent-os/graph-recall.mjs (job 2026-11-03-graphify-always-on): the UserPromptSubmit hook that
// prints file:line, community and callers for the symbols a prompt names, from the graphify MCP over HTTP. Every
// control runs the REAL script as a child against the stub MCP (fixtures/mcp-stub.mjs); the wiring arm runs the
// CONFIGURED command verbatim; mutants are planted copies with one constant changed (positive-control-first).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMcpStub, startMcpStubProcess } from "./fixtures/mcp-stub.mjs";
import { spawn as spawnChild, spawnSync as spawnSyncGit } from "node:child_process";

/** An HTTP listener that answers every POST with 500, in a CHILD process (an in-process server is starved by spawnSync). */
function start500() {
  return new Promise((res, rej) => {
    const child = spawnChild(process.execPath, ["-e", "require('http').createServer((q,s)=>{q.resume();q.on('end',()=>{s.writeHead(500);s.end('boom')})}).listen(0,'127.0.0.1',function(){console.log('port '+this.address().port)})"], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c; const m = /port (\d+)/.exec(out); if (m) res({ port: Number(m[1]), close: () => child.kill() }); });
    child.on("exit", () => rej(new Error("500 server exited early")));
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "graph-recall.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "graph-recall-test-"));
// A child process: the tests drive the hook with spawnSync, which would starve an in-process stub.
const stub = await startMcpStubProcess();
after(() => { stub.close(); rmSync(SCRATCH, { recursive: true, force: true }); });

const configFor = (port, label) => {
  const file = join(SCRATCH, `${label}-local-services.json`);
  writeFileSync(file, JSON.stringify({ version: 1, hosts: ["ANY"], servers: [{ name: "graphify", port, path: "/mcp", kind: "graphify" }], clients: [] }));
  return file;
};
const CONFIG = configFor(stub.port, "stub");

function run(args, { stdin, env = {}, script = SCRIPT, config = CONFIG } = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script, "--config", config, ...args], {
    input: stdin, encoding: "utf8", cwd: ROOT, timeout: 20000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: join(SCRATCH, "state-none"), ...env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: Date.now() - t0 };
}
const lines = (out) => out.split(/\r?\n/).filter(Boolean);
const LINE = /^\[graph-recall\] (fn|file|sym) (\S+) -> (\S+):(\d+) · community (\S+)( · callers: .+)?$/;

test("positive control: a prompt naming relatedActivity prints its file:line, community and caller", () => {
  const r = run(["--text", "fix relatedActivity so the Home card shows the latest row"]);
  assert.equal(r.code, 0, r.err);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.equal(l[0], "[graph-recall] fn relatedActivity() -> apps/statenour/lib/services/related-activity.ts:75 · community goal-pace.ts · callers: related-activity.test.ts");
});

test("a file name resolves too (merge-gate.mjs), and a symbol with no callers prints without the callers part", () => {
  const r = run(["--text", "read scripts/agent-os/merge-gate.mjs before the change"]);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.equal(l[0], "[graph-recall] file merge-gate.mjs -> scripts/agent-os/merge-gate.mjs:1 · community mergeGate.test.mjs");
});

test("negative controls print NOTHING (zero bytes), exit 0: 'hi', a bare slash command, a prompt under 12 chars, prose with no symbol", () => {
  for (const p of ["hi", "/compact", "/clear now", "fix mergeGa", "please merge the open pull request when the checks are green and tell me"]) {
    const r = run(["--text", p]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "", `printed on ${JSON.stringify(p)}:\n${r.out}`);
  }
});

test("a bare slash command with an argument prints nothing; a slash command inside a sentence still recalls (round-3 reader: the rule was dead to the tests)", () => {
  assert.equal(run(["--text", "/ponytail-review mergeGate"]).out, "");
  assert.match(run(["--text", "/loop fix mergeGate every 5 minutes please"]).out, /^\[graph-recall\] fn mergeGate\(\)/);
});

test("a DOWN record older than 24 h is stale: silent on a closed port", async () => {
  const port = await startMcpStub().then(async (s) => { const p = s.port; await s.close(); return p; });
  const cfg = configFor(port, "down-old");
  const stateDir = join(SCRATCH, "state-down-old");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "graph-mcp.json"), JSON.stringify({ state: "DOWN", at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), next: "x" }));
  assert.equal(run(["--text", "fix relatedActivity now"], { config: cfg, env: { NOURCITY_STATE_DIR: stateDir } }).out, "");
});

test("--scope global: zero bytes in a checkout of this repo whose settings register this hook (the project entry prints instead)", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const common = spawnSyncGit("git", ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"], { env, encoding: "utf8" }).stdout.trim();
  const registered = join(SCRATCH, "registered-checkout");
  mkdirSync(join(registered, ".claude"), { recursive: true });
  writeFileSync(join(registered, ".git"), `gitdir: ${common.replaceAll("\\", "/")}\n`);
  writeFileSync(join(registered, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "x/scripts/agent-os/graph-recall.mjs"' }] }] } }));
  assert.equal(run(["--scope", "global", "--text", "fix relatedActivity now"], { env: { CLAUDE_PROJECT_DIR: registered } }).out, "");
});

test("a listener that never answers initialize: one UNKNOWN (budget) line inside the budget, not a hang", async () => {
  const hang = await startMcpStubProcess({ mode: "hang" });
  try {
    const r = run(["--text", "fix relatedActivity now"], { config: configFor(hang.port, "hang"), env: { NOURCITY_STATE_DIR: join(SCRATCH, "state-hang") } });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), "[graph-recall] UNKNOWN (budget)");
    assert.ok(r.ms < 5500, `took ${r.ms} ms`);
  } finally { hang.close(); }
});

test("a prompt whose only symbol is unknown to the graph prints nothing (no node, no line)", () => {
  const r = run(["--text", "rename zzzNoSuchSymbol everywhere"]);
  assert.equal(r.out, "");
  assert.equal(r.code, 0);
});

test("hook mode: stdin JSON with a prompt field prints the same line", () => {
  const r = run([], { stdin: JSON.stringify({ prompt: "why does mergeGate hold the lease", hook_event_name: "UserPromptSubmit" }) });
  assert.equal(lines(r.out).length, 1, r.out);
  assert.match(lines(r.out)[0], /^\[graph-recall\] fn mergeGate\(\) -> scripts\/agent-os\/merge-gate\.mjs:338 · community mergeGate\.test\.mjs · callers: retryGate\(\), mergeGate\.test\.mjs$/);
});

test("at most 6 lines even when 10 symbols resolve", () => {
  const r = run(["--text", "touch manySym1 manySym2 manySym3 manySym4 manySym5 manySym6 manySym7 manySym8 manySym9 manySym10"]);
  assert.equal(lines(r.out).length, 6, r.out);
  for (const l of lines(r.out)) assert.match(l, LINE);
});

test("budget: a symbol the server answers after 5 s is dropped; the hook returns inside 3.5 s + process start and prints nothing", () => {
  const r = run(["--text", "look at slowSymbol please"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "", r.out);
  assert.ok(r.ms < 5500, `took ${r.ms} ms`);
});

// Manager measurement on the primary, 2026-11-03 17:26Z, 5 runs of the configured hook: 311 / 1867 / 1916 / 1748 / 369 ms;
// runs 2 and 3 printed NOTHING at the old 1.5 s budget while the MCP answered. The settings.json hook timeout is 5 s.
test("budget: a server that answers every request after 1,200 ms still prints the line (the 1.5 s budget printed nothing under load)", async () => {
  const slow = await startMcpStubProcess({ mode: "slow:1200" });
  try {
    const r = run(["--text", "fix relatedActivity so the Home card shows the latest row"], { config: configFor(slow.port, "slow1200") });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^\[graph-recall\] fn relatedActivity\(\) -> apps\/statenour\/lib\/services\/related-activity\.ts:75 · community goal-pace\.ts/, r.out);
    assert.ok(r.ms < 5500, `took ${r.ms} ms`);
  } finally { slow.close(); }
});

test("budget: a server that answers after 4,000 ms gets one UNKNOWN (budget) line inside the hook's 5 s timeout, not a hang", async () => {
  const slow = await startMcpStubProcess({ mode: "slow:4000" });
  try {
    const r = run(["--text", "fix relatedActivity so the Home card shows the latest row"], { config: configFor(slow.port, "slow4000"), env: { NOURCITY_STATE_DIR: join(SCRATCH, "state-slow4000") } });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), "[graph-recall] UNKNOWN (budget)");
    assert.ok(r.ms < 5000, `took ${r.ms} ms; the settings.json hook timeout is 5 s`);
  } finally { slow.close(); }
});

test("settings: the hook timeout leaves at least 1 s over the budget", () => {
  const hook = (SETTINGS.hooks.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).find((h) => h.command.includes("graph-recall.mjs"));
  const budget = Number(/const BUDGET_MS = (\d+);/.exec(readFileSync(SCRIPT, "utf8"))?.[1]);
  assert.ok(budget >= 3500, `BUDGET_MS ${budget}`);
  assert.ok(hook.timeout * 1000 - budget >= 1000, `timeout ${hook.timeout} s vs budget ${budget} ms`);
});

// Nour, 2026-11-03: "Well the graph needs to be used whenever possible not just when I ask". The hook printed only when a
// prompt named a code symbol; he writes in plain words ("And still the graph isnt being used to context and history?").
test("plain words: 'commitments vs missions vs goals' prints the Commitment, Mission and LifeGoal model lines, one per word, and nothing for 'vs'", () => {
  const r = run(["--text", "commitments vs missions vs goals"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), [
    "[graph-recall] model Commitment -> apps/statenour/prisma/schema.prisma:812 · community Commitments",
    "[graph-recall] model Mission -> apps/statenour/prisma/schema.prisma:300 · community Missions",
    "[graph-recall] model LifeGoal -> apps/statenour/prisma/schema.prisma:250 · community Goals",
  ]);
});

test("plain words: a file named for the word prints (commitments.ts), at most 3 lines, never a doc heading, a .md file, a test-file node or a SQL column", () => {
  const r = run(["--text", "where do the commitments live in the code"]);
  assert.deepEqual(lines(r.out), [
    "[graph-recall] model Commitment -> apps/statenour/prisma/schema.prisma:812 · community Commitments",
    "[graph-recall] file commitments.ts -> apps/statenour/lib/services/commitments.ts:1 · community ref_node_crypto",
  ]);
});

test("plain words: every word gets its first line before any word gets a second (3 hits for alpha must not crowd out beta)", () => {
  assert.deepEqual(lines(run(["--text", "compare alpha with beta"]).out), [
    "[graph-recall] model Alpha -> a/one.ts:1 · community a",
    "[graph-recall] model Beta -> b/one.ts:1 · community b",
    "[graph-recall] model Alpha -> a/two.ts:2 · community a",
  ]);
});

test("plain words: a prompt with no content word (hb now?), a stopword-only prompt and a no-match prompt print nothing", () => {
  for (const p of ["hb now?", "hb now ok so then it is", "please tell me what that was about", "something unrelated entirely"]) {
    const r = run(["--text", p]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "", `printed on ${JSON.stringify(p)}:\n${r.out}`);
  }
});

test("plain words: a match that is only a markdown heading or .md file prints nothing, and so does one that is only in a test file", () => {
  assert.equal(run(["--text", "show me the roadmap again"]).out, "", "docs and headings are not code");
  assert.equal(run(["--text", "check the fixture helpers"]).out, "", "test-file nodes are not context");
  assert.equal(run(["--text", "what does scratchy do"]).out, "", "a one-off scratch script is not context");
});

test("plain words: the fallback runs only when the prompt names no symbol (a symbol prompt prints the symbol line alone)", () => {
  const r = run(["--text", "fix relatedActivity for the commitments page"]);
  assert.equal(lines(r.out).length, 1, r.out);
  assert.match(lines(r.out)[0], /^\[graph-recall\] fn relatedActivity\(\)/);
});

test("plain words: a slow answer is UNKNOWN (budget) once per 30 min, inside the budget", () => {
  const env = { NOURCITY_STATE_DIR: join(SCRATCH, "state-slowword") };
  const r1 = run(["--text", "tell me about slowword please"], { env });
  assert.equal(r1.out.trim(), "[graph-recall] UNKNOWN (budget)");
  assert.ok(r1.ms < 5500, `took ${r1.ms} ms`);
  assert.equal(run(["--text", "tell me about slowword please"], { env }).out, "", "the second UNKNOWN inside 30 min is silent");
});

test("budget: the fast symbol still prints when a slow one is in the same prompt", () => {
  const r = run(["--text", "slowSymbol calls mergeGate twice"]);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.match(l[0], /^\[graph-recall\] fn mergeGate\(\)/);
});

// Manager probe 2026-11-03: "why does relatedActivity drop task rows after the stale-tasks cron bumps updatedAt" printed
// `updatedAt -> .../approval-review-dismiss.test.ts:36`. Only real symbols print now.
test("noise: a property-like name that resolves to a degree-1 node in a test file prints nothing; the real symbol beside it still prints", () => {
  const r = run(["--text", "why does relatedActivity drop task rows after the stale-tasks cron bumps updatedAt"]);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.match(l[0], /^\[graph-recall\] fn relatedActivity\(\)/);
  assert.equal(run(["--text", "the cron bumps updatedAt on every row"]).out, "", "updatedAt alone prints nothing");
});

test("noise: a name the server calls Ambiguous (status: 24 nodes) prints nothing", () => {
  assert.equal(run(["--text", "the status field is wrong on the Home card"]).out, "");
});

test("a test FILE the prompt names by its file name still prints (the author pointed at it)", () => {
  const r = run(["--text", "extend mergeGate.test.mjs with a rebuild arm"]);
  assert.equal(lines(r.out).length, 1, r.out);
  assert.match(lines(r.out)[0], /^\[graph-recall\] file mergeGate\.test\.mjs -> scripts\/agent-os\/mergeGate\.test\.mjs:1/);
});

test("MUTANT no-degree-floor: MIN_DEGREE 0 lets the degree-1 test-file node through (the floor arm is live)", () => {
  const r = run(["--text", "the cron bumps updatedAt on every row"], { script: mutant("nodegree", "const MIN_DEGREE = 3;", "const MIN_DEGREE = 0;") });
  assert.equal(r.out, "", "degree 0 alone is not enough: the node is in a test file the prompt did not name");
  const r2 = run(["--text", "the cron bumps updatedAt on every row"], { script: mutant("nodegree-notest", "const MIN_DEGREE = 3;\nconst TEST_PATH = ", "const MIN_DEGREE = 0;\nconst TEST_PATH = /(?!)/; const _unused = ") });
  assert.match(r2.out, /^\[graph-recall\] sym updatedAt -> apps\/statenour\/tests\/trpc\/approval-review-dismiss\.test\.ts:36/, r2.out);
});

test("MCP down (nothing on the port): silent, exit 0; with a DOWN verdict from graph-ensure-mcp on disk: one `mcp down` line", async () => {
  const port = await startMcpStub().then(async (s) => { const p = s.port; await s.close(); return p; });
  const cfg = configFor(port, "down");
  const quiet = run(["--text", "fix relatedActivity now"], { config: cfg });
  assert.equal(quiet.code, 0, quiet.err);
  assert.equal(quiet.out, "");
  const stateDir = join(SCRATCH, "state-down");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "graph-mcp.json"), JSON.stringify({ state: "DOWN", at: new Date().toISOString(), next: "powershell x -Start" }));
  const loud = run(["--text", "fix relatedActivity now"], { config: cfg, env: { NOURCITY_STATE_DIR: stateDir } });
  assert.equal(loud.code, 0);
  assert.equal(loud.out.trim(), "[graph-recall] mcp down, next: powershell x -Start");
  writeFileSync(join(stateDir, "graph-mcp.json"), JSON.stringify({ state: "started", at: new Date().toISOString() }));
  assert.equal(run(["--text", "fix relatedActivity now"], { config: cfg, env: { NOURCITY_STATE_DIR: stateDir } }).out, "", "a server that is starting is not down");
});

// Round-2 reader: every failure but "port closed" used to print zero bytes and record nothing.
test("a listener that answers initialize with 500: one `[graph-recall] UNKNOWN (...)` line, then silence for 30 min (stamp file), exit 0", async () => {
  const bad = await start500();
  const cfg = configFor(bad.port, "http500");
  const stateDir = join(SCRATCH, "state-unknown");
  try {
    const r1 = run(["--text", "fix relatedActivity now"], { config: cfg, env: { NOURCITY_STATE_DIR: stateDir } });
    assert.equal(r1.code, 0, r1.err);
    assert.match(r1.out.trim(), /^\[graph-recall\] UNKNOWN \(initialize answered 500\)$/, r1.out);
    const r2 = run(["--text", "fix relatedActivity now"], { config: cfg, env: { NOURCITY_STATE_DIR: stateDir } });
    assert.equal(r2.out, "", "the second UNKNOWN inside 30 min is silent");
  } finally { bad.close(); }
});

test("--scope global: silent in a checkout of ANOTHER repo (the graph is this repo's), prints in a checkout of this repo", () => {
  const other = join(SCRATCH, "other-repo");
  mkdirSync(other, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  assert.equal(spawnSyncGit("git", ["init", "-q", other], { env }).status, 0);
  const r = run(["--scope", "global", "--text", "fix relatedActivity now"], { env: { CLAUDE_PROJECT_DIR: other } });
  assert.equal(r.out, "", `printed NOURCITY file:line inside another repo:\n${r.out}`);
  // A second checkout of THIS repo (a gitdir file at the shared common dir) with no settings of its own: the global entry prints.
  const mine = join(SCRATCH, "mine-checkout");
  mkdirSync(mine, { recursive: true });
  const common = spawnSyncGit("git", ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"], { env, encoding: "utf8" }).stdout.trim();
  writeFileSync(join(mine, ".git"), `gitdir: ${common.replaceAll("\\", "/")}\n`);
  const r2 = run(["--scope", "global", "--text", "fix relatedActivity now"], { env: { CLAUDE_PROJECT_DIR: mine } });
  assert.match(r2.out, /^\[graph-recall\] fn relatedActivity\(\)/, r2.out);
});

test("a 40k-character paste is answered inside the budget: only the first 8000 chars are scanned", () => {
  // Through stdin (hook mode): a 40k-char argv exceeds the Windows command-line limit, which is not the thing under test.
  const paste = `${"x".repeat(9000)} relatedActivity ${"a/b/c-".repeat(3000)}.ts`;
  const r = run([], { stdin: JSON.stringify({ prompt: `${"filler ".repeat(1200)}${paste}` }) });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "", "the symbol sits past the scan window");
  // The ceiling is a sanity bound, not the harness timeout: right after a reboot with 40 sessions starting, node start-up
  // alone pushed this to 4.5 s (verify7, 2026-11-03). The cap itself is proven by the two outputs, not by the clock.
  assert.ok(r.ms < 8000, `took ${r.ms} ms`);
  const r2 = run([], { stdin: JSON.stringify({ prompt: `fix relatedActivity ${"a/b/c-".repeat(6000)}.ts` }) });
  assert.match(r2.out, /relatedActivity/, "a symbol inside the window still prints");
  assert.ok(r2.ms < 8000, `took ${r2.ms} ms`);
});

test("garbage stdin fails open: one off line, exit 0 (exit 2 would veto the prompt)", () => {
  const r = run([], { stdin: "not json" });
  assert.equal(r.code, 0);
  assert.match(r.out.trim(), /^\[graph-recall\] off: /);
});

test("settings: UserPromptSubmit runs graph-recall after memory-recall, forward slashes, timeout 5; the CONFIGURED command runs verbatim and is silent on 'hi'", () => {
  const cmds = (SETTINGS.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);
  const at = cmds.findIndex((c) => c.includes("graph-recall.mjs"));
  const mem = cmds.findIndex((c) => c.includes("memory-recall.mjs"));
  assert.ok(at > mem && mem >= 0, `graph-recall must follow memory-recall: ${JSON.stringify(cmds)}`);
  assert.doesNotMatch(cmds[at], /\\/);
  const hook = (SETTINGS.hooks.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).find((h) => h.command.includes("graph-recall.mjs"));
  assert.equal(hook.timeout, 5);
  const cmd = process.platform === "win32" ? cmds[at].replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : cmds[at];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ prompt: "hi" }), encoding: "utf8", cwd: ROOT, env: { ...env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: join(SCRATCH, "wired") }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  // A do-nothing command would also print nothing on "hi": garbage stdin proves the configured command reached the script.
  const r2 = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: "not json", encoding: "utf8", cwd: ROOT, env: { ...env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: join(SCRATCH, "wired") }, timeout: 20000 });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout.trim(), /^\[graph-recall\] off: /, r2.stdout);
});

/** A copy of the script with one edit, its sibling imports pointed back at the real files. */
function mutant(label, from, to) {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes(from), `mutation anchor not found: ${from}`);
  const file = join(SCRATCH, `${label}.mjs`);
  writeFileSync(file, src.replace(from, to).replaceAll(/from "\.\/([\w-]+\.mjs)"/g, (_, f) => `from ${JSON.stringify(pathToFileURL(join(HERE, f)).href)}`));
  return file;
}

test("MUTANT no-cap: MAX_SYMBOLS 60 prints all 10 symbols (the cap arm is live)", () => {
  const r = run(["--text", "touch manySym1 manySym2 manySym3 manySym4 manySym5 manySym6 manySym7 manySym8 manySym9 manySym10"], { script: mutant("nocap", "const MAX_SYMBOLS = 6;", "const MAX_SYMBOLS = 60;") });
  assert.equal(lines(r.out).length, 10, r.out);
});

test("MUTANT no-budget: BUDGET_MS 10000 waits for the slow symbol and prints it (the budget arm is live)", () => {
  const r = run(["--text", "look at slowSymbol please"], { script: mutant("nobudget", "const BUDGET_MS = 3500;", "const BUDGET_MS = 10000;") });
  assert.match(r.out, /^\[graph-recall\] fn slowSymbol\(\) -> x\/slow\.ts:9/, r.out);
});

test("MUTANT plain-words no-test-filter: dropping the test-file arm prints the fixture nodes (the arm is live)", () => {
  const r = run(["--text", "check the fixture helpers"], { script: mutant("wordtest", "|| TEST_PATH.test(src)) continue;", ") continue;") });
  assert.match(r.out, /^\[graph-recall\] model Fixture -> apps\/statenour\/tests\/e2e\/fixtures\/x\.ts:3/, r.out);
});

test("MUTANT plain-words no-doc-filter: dropping the heading, markdown and docs arms prints the roadmap nodes (the arm is live)", () => {
  const r = run(["--text", "show me the roadmap again"], { script: mutant("worddoc", "/\\s/.test(label) || /\\.md$/i.test(label) || /\\.(md|sql)$/i.test(src) || /(^|\\/)(?:docs|scratch)\\//.test(src) ||", "") });
  assert.match(r.out, /roadmap/i, r.out);
  assert.match(run(["--text", "what does scratchy do"], { script: mutant("wordscratch", "/(^|\\/)(?:docs|scratch)\\//.test(src) ||", "") }).out, /scratchy/, "the scratch arm is live");
});

test("MUTANT plain-words no-line-cap: MAX_WORD_LINES 9 prints the fourth line (the cap arm is live)", () => {
  const r = run(["--text", "commitments vs missions vs goals"], { script: mutant("wordcap", "const MAX_WORD_LINES = 3;", "const MAX_WORD_LINES = 9;") });
  assert.equal(lines(r.out).length, 4, r.out);
});

test("MUTANT plain-words no-lead: without one line per word first, alpha's three hits crowd beta out (the ordering arm is live)", () => {
  const r = run(["--text", "compare alpha with beta"], { script: mutant("wordlead", "return [...lead, ...rest].slice(", "return hits.slice(") });
  assert.doesNotMatch(r.out, /Beta/, r.out);
});

test("MUTANT no-floor: MIN_PROMPT_CHARS 0 prints on a short prompt that names a symbol (the floor arm is live)", () => {
  const r = run(["--text", "mergeGate"], { script: mutant("nofloor", "const MIN_PROMPT_CHARS = 12;", "const MIN_PROMPT_CHARS = 0;") });
  assert.match(r.out, /^\[graph-recall\] fn mergeGate\(\)/, r.out);
  assert.equal(run(["--text", "mergeGate"]).out, "", "the real script stays silent under 12 chars");
});
