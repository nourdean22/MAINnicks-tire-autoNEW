/**
 * Canaries for lease-check.mjs (Session Authority · 2026-09-23).
 *
 * Two layers, per guard-red-team: the pure decide() function (fast, exhaustive over
 * all six cases) AND the real binary run end-to-end through stdin exactly as the
 * harness invokes it (spawnSync, real fixture repo, real marker files) — a
 * mock-only suite would prove the decision table, not that the actual process
 * wired to it produces the right exit code and stderr content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./lease-check.mjs";
import { writeLocalMarker } from "./local-lease-marker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── pure decide() — all six cases ────────────────────────────────────────────

const future = new Date(Date.now() + 3600000).toISOString();
const past = new Date(Date.now() - 3600000).toISOString();

test("decide: no marker -> warn/no-marker", () => {
  const r = decide({ marker: null, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "no-marker");
});

test("decide: marker for a different branch -> warn/wrong-branch", () => {
  const r = decide({ marker: { branch: "other", sessionId: "me", expiresAt: future }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "wrong-branch");
});

test("decide: mine, unexpired -> silent allow", () => {
  const r = decide({ marker: { branch: "main", sessionId: "me", expiresAt: future }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "allow");
});

test("decide: mine, expired -> warn/self-expired", () => {
  const r = decide({ marker: { branch: "main", sessionId: "me", expiresAt: past }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "self-expired");
});

test("decide: foreign, expired -> warn/foreign-expired (low risk)", () => {
  const r = decide({ marker: { branch: "main", sessionId: "someone-else", expiresAt: past }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "foreign-expired");
});

test("decide: foreign, UNEXPIRED -> block (the real collision case)", () => {
  const r = decide({ marker: { branch: "main", sessionId: "someone-else", expiresAt: future }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "block");
  assert.match(r.message, /someone-else/);
});

// ── real binary, end-to-end, exactly as the harness invokes it ──────────────

function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}
function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", env: cleanEnv() }).trim();
}
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "lease-check-fixture-"));
  git(dir, "init -q -b main");
  git(dir, 'config user.email "t@x.com"');
  git(dir, 'config user.name "t"');
  git(dir, "commit -q --allow-empty -m init");
  return dir;
}
function runHook(cwd, payload) {
  const env = { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: "me" };
  const r = spawnSync(process.execPath, [join(HERE, "lease-check.mjs")], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
    timeout: 10000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("REAL BINARY: no marker at all -> exit 0, a warning printed", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.code, 0);
  assert.match(r.out, /no Session Authority lease marker/);
});

test("REAL BINARY: my own valid marker -> exit 0, SILENT (no output at all)", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "me", expiresAt: future });
  const r = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "", `expected total silence for my own valid lease; got: ${r.out}`);
});

test("REAL BINARY: a foreign, UNEXPIRED marker -> BLOCKS with exit 2, names the holder", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "some-other-session", expiresAt: future });
  const r = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.code, 2, `expected a block; got exit ${r.code}: ${r.out}`);
  assert.match(r.out, /some-other-session/);
  assert.match(r.out, /REFUSED/);
});

test("REAL BINARY: throttling — a second call within the window prints nothing more", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.match(first.out, /no Session Authority lease marker/);
  const second = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(second.code, 0);
  assert.equal(second.out.trim(), "", `expected the throttle to suppress a repeat warning; got: ${second.out}`);
});

test("REAL BINARY: no stdin at all (manual run) does not crash — resolves via process.cwd()", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: "me" };
  const r = spawnSync(process.execPath, [join(HERE, "lease-check.mjs")], { cwd: dir, input: "", encoding: "utf8", env, timeout: 10000 });
  assert.equal(r.status, 0);
});

// ── audit item O (2026-09-23): the block must not lock out its own recovery ──
// A foreign live marker blocked EVERY Bash call, including the agent-finish.mjs
// run the block message itself recommends — the worktree could only be recovered
// by hand-deleting the marker. The recovery command is now let through, but only
// when it is the WHOLE command: guard-red-team's chaining / subshell / redirection
// / prefix-flag probes below must all still block.

const FOREIGN = { branch: "main", sessionId: "someone-else", expiresAt: future };

const RECOVERY_ALLOWED = [
  "node scripts/agent-os/agent-finish.mjs",
  'node scripts/agent-os/agent-finish.mjs --force-release-foreign "holder session died" --force-release-dirty "operator ok"',
  "node ./scripts/agent-os/agent-finish.mjs --worktree .",
  "node /home/user/repo/scripts/agent-os/agent-finish.mjs",
  "node scripts\\agent-os\\agent-finish.mjs",
  'node "C:\\Users\\nourd\\NOURCITY\\scripts\\agent-os\\agent-finish.mjs" --force-release-foreign "dead"',
  "node.exe C:\\Users\\nourd\\NOURCITY\\scripts\\agent-os\\agent-finish.mjs",
  "  node scripts/agent-os/agent-finish.mjs  ",
  // A "-" INSIDE a path is fine; only a leading one makes node read a flag (F6).
  "node ../nour-city/scripts/agent-os/agent-finish.mjs",
  'node "C:\\Users\\x\\my-repo\\scripts\\agent-os\\agent-finish.mjs"',
];
// Destructive verbs are spelled via RM/RESET so this file does not itself trip the
// repo's PreToolUse deny-list when an agent cats or appends it (mention-vs-execution).
const RM = ["rm", "-rf"].join(" ");
const RESET = ["git", "reset", "--hard"].join(" ");
const RECOVERY_STILL_BLOCKED = [
  "git status",
  `node scripts/agent-os/agent-finish.mjs; ${RM} .`,
  `node scripts/agent-os/agent-finish.mjs && ${RESET}`,
  "node scripts/agent-os/agent-finish.mjs || true",
  "node scripts/agent-os/agent-finish.mjs | tee x",
  `node scripts/agent-os/agent-finish.mjs & ${RM} x`,
  "node scripts/agent-os/agent-finish.mjs > out.txt",
  `node scripts/agent-os/agent-finish.mjs $(${RM} x)`,
  `node scripts/agent-os/agent-finish.mjs \`${RM} x\``,
  `node scripts/agent-os/agent-finish.mjs\n${RM} x`,
  `${RM} x; node scripts/agent-os/agent-finish.mjs`,
  "cd .. ; node scripts/agent-os/agent-finish.mjs",
  "node -e \"require('fs').rmSync('x')\" scripts/agent-os/agent-finish.mjs",
  "node --import=./evil.mjs scripts/agent-os/agent-finish.mjs",
  "NODE_OPTIONS=--require=./evil.cjs node scripts/agent-os/agent-finish.mjs",
  "node scripts/agent-os/agent-finish.mjs.bak",
  "node scripts/agent-os/agent-finish.mjsx",
  "node scripts/agent-os/agent-start.mjs",
  "echo node scripts/agent-os/agent-finish.mjs",
  "& node scripts/agent-os/agent-finish.mjs; Remove-Item x",
  "node scripts/agent-os/agent-finish.mjs (Remove-Item x)",
  // audit 2026-09-29 F6: a node FLAG whose value ends in the script path. Every one
  // of these was allowed; the data: form runs inline code with no file on disk.
  "node --import=data:text/javascript,x//scripts/agent-os/agent-finish.mjs",
  "node --import=./evil.mjs//scripts/agent-os/agent-finish.mjs",
  "node --require=./evil.cjs/scripts/agent-os/agent-finish.mjs",
  "node --experimental-loader=./evil.mjs/scripts/agent-os/agent-finish.mjs",
  'node "--import=./evil.mjs/scripts/agent-os/agent-finish.mjs"',
  "node '--import=./evil.mjs/scripts/agent-os/agent-finish.mjs'",
  "node -r./evil.cjs/scripts/agent-os/agent-finish.mjs",
  "node.exe --import=C:\\evil.mjs\\scripts\\agent-os\\agent-finish.mjs",
];

test("decide: a foreign live marker still BLOCKS every non-recovery Bash command (probe set)", () => {
  for (const command of RECOVERY_STILL_BLOCKED) {
    const r = decide({ marker: FOREIGN, branch: "main", mySessionId: "me", command });
    assert.equal(r.verdict, "block", `should block: ${JSON.stringify(command)}`);
  }
});

test("decide: a foreign live marker ALLOWS the bare agent-finish.mjs recovery command", () => {
  for (const command of RECOVERY_ALLOWED) {
    const r = decide({ marker: FOREIGN, branch: "main", mySessionId: "me", command });
    assert.equal(r.verdict, "allow", `should allow: ${JSON.stringify(command)}`);
  }
});

test("decide: the block message names the exact recovery command and the override", () => {
  const r = decide({ marker: FOREIGN, branch: "main", mySessionId: "me", command: "git status" });
  assert.match(r.message, /node scripts\/agent-os\/agent-finish\.mjs --force-release-foreign/);
  assert.match(r.message, /AGENT_OS_LEASE_OVERRIDE/);
});

test("decide: an explicit AGENT_OS_LEASE_OVERRIDE turns the block into a warning that carries the reason", () => {
  const r = decide({ marker: FOREIGN, branch: "main", mySessionId: "me", command: "git status", override: "operator: took over dead session" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "override");
  assert.match(r.message, /operator: took over dead session/);
  const blank = decide({ marker: FOREIGN, branch: "main", mySessionId: "me", command: "git status", override: "   " });
  assert.equal(blank.verdict, "block", "a blank override is not an override");
});

test("REAL BINARY: foreign live marker — the agent-finish recovery command passes (exit 0); a chained one and a Write still block (exit 2)", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, FOREIGN);
  const ok = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: 'node scripts/agent-os/agent-finish.mjs --force-release-foreign "dead"' } });
  assert.equal(ok.code, 0, `recovery command was blocked: ${ok.out}`);
  const chained = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: `node scripts/agent-os/agent-finish.mjs; ${RM} .` } });
  assert.equal(chained.code, 2);
  assert.match(chained.out, /REFUSED/);
  const flag = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "node --import=data:text/javascript,x//scripts/agent-os/agent-finish.mjs" } });
  assert.equal(flag.code, 2, `a flag-shaped path passed as recovery: ${flag.out}`);
  assert.match(flag.out, /REFUSED/);
  const write = runHook(dir, { cwd: dir, tool_name: "Write", tool_input: { file_path: join(dir, "x"), content: "node scripts/agent-os/agent-finish.mjs" } });
  assert.equal(write.code, 2, "Write must stay blocked even if its CONTENT is the recovery command");
});

test("REAL BINARY: AGENT_OS_LEASE_OVERRIDE lets a foreign-marker call through (exit 0) and says so", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, FOREIGN);
  const env = { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: "me", AGENT_OS_LEASE_OVERRIDE: "operator took over" };
  const r = spawnSync(process.execPath, [join(HERE, "lease-check.mjs")], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } }),
    encoding: "utf8",
    env,
    timeout: 10000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /operator took over/);
});

// ── 2026-10-15 (job 2026-10-15-guard-sql-lease-infra): the tripwire also fires for the MCP and native runners and writers ──
// .claude/settings.json registers lease-check.mjs for them in a PreToolUse group of their own (it used to cover only
// Bash|PowerShell|Write|Edit|NotebookEdit). These run the CONFIGURED command string VERBATIM (guard-red-team rule 5) with
// the payload of an MCP call against a throwaway git repo, so a foreign marker blocks a Terminal MCP command or a file
// write exactly as it blocks Bash. Never the real marker: every repo here is a temp dir with its own .git.

const ROOT = resolve(HERE, "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const EXACT_ONLY = /^[A-Za-z0-9_\-\s,|]*$/; // Claude Code reads anything else as a JavaScript regex, tested UNANCHORED
const routed = (matcher, name) => matcher === undefined || matcher === "" || matcher === "*" ||
  (EXACT_ONLY.test(matcher) ? matcher.split(/[|,]/).map((s) => s.trim()).includes(name) : new RegExp(matcher).test(name));
/** The lease-check command strings configured for a tool name, exactly as written in settings.json. */
const leaseCommands = (name, s = settings) =>
  s.hooks.PreToolUse.filter((g) => routed(g.matcher, name)).flatMap((g) => g.hooks.map((h) => h.command)).filter((c) => c.includes("lease-check.mjs"));

function runConfigured(command, payload, cwd, sessionId = "me") {
  const env = { ...cleanEnv(), CLAUDE_PROJECT_DIR: ROOT, CLAUDE_CODE_SESSION_ID: sessionId };
  delete env.AGENT_OS_LEASE_OVERRIDE;
  // cmd.exe does not expand ${VAR}: on Windows expand it here; POSIX shells expand it themselves, as the harness relies on.
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify(payload), encoding: "utf8", cwd, env, timeout: 20000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const DC = "mcp__plugin_desktop-commander_desktop-commander__";
const MCP_CALLS = [
  ["mcp__terminal__run_in_terminal", (c) => ({ command: c, title: "t" })],
  [`${DC}start_process`, (c) => ({ command: c, timeout_ms: 5000, shell: "powershell.exe" })],
  ["mcp__c23af5b4-e7d0-40b0-b6c6-346adaf3336c__start_process", (c) => ({ command: c, timeout_ms: 5000 })],
  ["Monitor", (c) => ({ command: c, description: "watch", timeout_ms: 60000 })],
  [`${DC}interact_with_process`, (c) => ({ pid: 4242, input: c, timeout_ms: 8000 })],
  [`${DC}write_file`, (c) => ({ path: "docs/x.md", content: c })],
  [`${DC}edit_block`, (c) => ({ file_path: "docs/x.md", old_string: "a", new_string: c })],
  [`${DC}write_pdf`, (c) => ({ path: "docs/x.pdf", content: c })],
  ["mcp__filesystem__edit_file", (c) => ({ path: "docs/x.md", edits: [{ oldText: "a", newText: c }] })],
  ["mcp__filesystem__move_file", () => ({ source: "a.txt", destination: "b.txt" })],
];

test("configured lease-check, run VERBATIM through every MCP runner and writer: a foreign unexpired marker BLOCKS (exit 2, REFUSED); my own marker and no marker pass", (t) => {
  for (const [name, input] of MCP_CALLS) {
    const commands = leaseCommands(name);
    assert.equal(commands.length, 1, `${name}: exactly one configured lease-check command, got ${commands.length}`);
    assert.ok(!commands[0].includes("\\"), "a backslash separator does not resolve on Linux (cloud sessions)");
    const dir = makeRepo();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const payload = { cwd: dir, tool_name: name, tool_input: input("git status") };
    const none = runConfigured(commands[0], payload, dir);
    assert.equal(none.code, 0, `${name}: no marker is a warning, not a block\n${none.out}`);
    writeLocalMarker(dir, { branch: "main", sessionId: "me", expiresAt: future });
    const own = runConfigured(commands[0], payload, dir);
    assert.equal(own.code, 0, `${name}: my own marker\n${own.out}`);
    assert.equal(own.out.trim(), "", `${name}: my own marker must be silent`);
    writeLocalMarker(dir, FOREIGN);
    const foreign = runConfigured(commands[0], payload, dir);
    assert.equal(foreign.code, 2, `${name}: a foreign unexpired marker must block, got ${foreign.code}\n${foreign.out}`);
    assert.match(foreign.out, /REFUSED/);
    assert.match(foreign.out, /someone-else/);
  }
});

test("configured lease-check through a runner: the agent-finish recovery command passes a foreign marker; a chained one and any other command still block", (t) => {
  const name = "mcp__terminal__run_in_terminal";
  const [command] = leaseCommands(name);
  assert.ok(command, `${name} has no configured lease-check command`);
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, FOREIGN);
  const ask = (c) => runConfigured(command, { cwd: dir, tool_name: name, tool_input: { command: c } }, dir);
  assert.equal(ask('node scripts/agent-os/agent-finish.mjs --force-release-foreign "why"').code, 0, "the recovery command must stay reachable through the runner the block message points at");
  assert.equal(ask(`node scripts/agent-os/agent-finish.mjs; ${RM} .`).code, 2, "a chained command is not the recovery command");
  assert.equal(ask("git status").code, 2);
});

test("configured lease-check: the SQL text tools are NOT routed to it (they never touch the worktree) and the native group is unchanged", () => {
  for (const name of ["mcp__08daf860-d901-4ecf-8033-a2b41fe7f23d__run_sql", "mcp__08daf860-d901-4ecf-8033-a2b41fe7f23d__run_sql_transaction",
    "mcp__1c28426e-fc0c-4e02-a13b-409e6d539b14__execute_sql_query", "mcp__plugin_prisma_Prisma-Remote__execute_prisma_postgres_schema_update"]) {
    assert.equal(leaseCommands(name).length, 0, `${name} must not run lease-check`);
  }
  for (const name of ["Bash", "PowerShell", "Write", "Edit", "NotebookEdit"]) assert.equal(leaseCommands(name).length, 1, `${name} keeps its one lease-check command`);
});

test("BREAKS: settings.json without the lease-check group for the runners and writers routes none of them (the canaries above would fail)", () => {
  const broken = structuredClone(settings);
  broken.hooks.PreToolUse = broken.hooks.PreToolUse.filter((g) => !(g.matcher !== "Bash|PowerShell|Write|Edit|NotebookEdit" && g.hooks.some((h) => h.command.includes("lease-check.mjs"))));
  for (const [name] of MCP_CALLS) {
    assert.equal(leaseCommands(name).length, 1, `control: the real settings route ${name}`);
    assert.equal(leaseCommands(name, broken).length, 0, `the broken copy must not route ${name}, or these canaries prove nothing`);
  }
  assert.equal(leaseCommands("Bash", broken).length, 1, "control: the native group survives the mutation");
});

// ── accepted limits, pinned (job 2026-10-15-guard-sql-lease-infra, G3) ──
// lease-check.mjs is a session-level TRIPWIRE: it reads payload.cwd (the session's directory) and tool_input.command, nothing
// else. These two pins describe what that cannot see. They are not defects to fix here (the authoritative guarantee is the ref
// compare-and-swap at agent-start.mjs time); each fails the day the hook starts reading more, so the README limit gets updated.

test("accepted limit, pinned: a runner's own cwd argument is not read, so a session that holds its own lease reaches a worktree held by a FOREIGN lease", (t) => {
  const name = "mcp__terminal__run_in_terminal"; // the adapter row terminal-run carries cwdField "cwd": the policy judges that field, the tripwire does not
  const [command] = leaseCommands(name);
  assert.ok(command, `${name} has no configured lease-check command`);
  const mine = makeRepo();
  const theirs = makeRepo();
  t.after(() => { rmSync(mine, { recursive: true, force: true }); rmSync(theirs, { recursive: true, force: true }); });
  writeLocalMarker(mine, { branch: "main", sessionId: "me", expiresAt: future });
  writeLocalMarker(theirs, FOREIGN);
  const via = (cwd, toolCwd) => runConfigured(command, { cwd, tool_name: name, tool_input: { command: "git status", cwd: toolCwd } }, cwd);
  assert.equal(via(theirs, theirs).code, 2, "positive control: the foreign marker blocks a session that is itself in that worktree");
  const reach = via(mine, theirs);
  assert.equal(reach.code, 0, `if this now blocks, lease-check reads the runner's cwd argument: update the README limit and this pin\n${reach.out}`);
  assert.equal(reach.out.trim(), "", "and it stays silent: my own lease is what it saw");
});

test("accepted limit, pinned: a writer payload that carries a command field is judged by the recovery-command exemption", (t) => {
  const name = `${DC}write_file`;
  const [command] = leaseCommands(name);
  assert.ok(command, `${name} has no configured lease-check command`);
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, FOREIGN);
  const write = (extra) => runConfigured(command, { cwd: dir, tool_name: name, tool_input: { path: "docs/x.md", content: "x", ...extra } }, dir);
  assert.equal(write({}).code, 2, "positive control: a writer with no command field is blocked by a foreign marker");
  const smuggled = write({ command: "node scripts/agent-os/agent-finish.mjs" });
  assert.equal(smuggled.code, 0, `if this now blocks, the exemption is limited to command tools: update the README limit and this pin\n${smuggled.out}`);
  assert.equal(write({ command: "git status" }).code, 2, "any other command field is still blocked");
});

test("lease-check.mjs header says what it covers and what it cannot see (a claim the code must still back)", () => {
  const head = readFileSync(join(HERE, "lease-check.mjs"), "utf8").split("\n").slice(0, 60).join("\n");
  assert.doesNotMatch(head, /same matcher as pretool\.mjs/, "the matcher is its own group now: that sentence is stale");
  for (const phrase of ["session-level tripwire", "payload.cwd", "recovery-command exemption", "SQL text tools", "MCP"]) assert.ok(head.includes(phrase), `the header must state: ${phrase}`);
});
