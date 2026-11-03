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
const LINE = /^\[graph-recall\] (\S+) -> (\S+):(\d+) · community (\S+)( · callers: .+)?$/;

test("positive control: a prompt naming relatedActivity prints its file:line, community and caller", () => {
  const r = run(["--text", "fix relatedActivity so the Home card shows the latest row"]);
  assert.equal(r.code, 0, r.err);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.equal(l[0], "[graph-recall] relatedActivity() -> apps/statenour/lib/services/related-activity.ts:75 · community goal-pace.ts · callers: related-activity.test.ts");
});

test("a file name resolves too (merge-gate.mjs), and a symbol with no callers prints without the callers part", () => {
  const r = run(["--text", "read scripts/agent-os/merge-gate.mjs before the change"]);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.equal(l[0], "[graph-recall] merge-gate.mjs -> scripts/agent-os/merge-gate.mjs:1 · community mergeGate.test.mjs");
});

test("negative controls print NOTHING (zero bytes), exit 0: 'hi', a bare slash command, a prompt under 12 chars, prose with no symbol", () => {
  for (const p of ["hi", "/compact", "/clear now", "fix mergeGa", "please merge the open pull request when the checks are green and tell me"]) {
    const r = run(["--text", p]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "", `printed on ${JSON.stringify(p)}:\n${r.out}`);
  }
});

test("a prompt whose only symbol is unknown to the graph prints nothing (no node, no line)", () => {
  const r = run(["--text", "rename zzzNoSuchSymbol everywhere"]);
  assert.equal(r.out, "");
  assert.equal(r.code, 0);
});

test("hook mode: stdin JSON with a prompt field prints the same line", () => {
  const r = run([], { stdin: JSON.stringify({ prompt: "why does mergeGate hold the lease", hook_event_name: "UserPromptSubmit" }) });
  assert.equal(lines(r.out).length, 1, r.out);
  assert.match(lines(r.out)[0], /^\[graph-recall\] mergeGate\(\) -> scripts\/agent-os\/merge-gate\.mjs:338 · community mergeGate\.test\.mjs · callers: retryGate\(\), mergeGate\.test\.mjs$/);
});

test("at most 6 lines even when 10 symbols resolve", () => {
  const r = run(["--text", "touch manySym1 manySym2 manySym3 manySym4 manySym5 manySym6 manySym7 manySym8 manySym9 manySym10"]);
  assert.equal(lines(r.out).length, 6, r.out);
  for (const l of lines(r.out)) assert.match(l, LINE);
});

test("budget: a symbol the server answers after 3 s is dropped; the hook returns inside 1.5 s + process start and prints nothing", () => {
  const r = run(["--text", "look at slowSymbol please"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "", r.out);
  assert.ok(r.ms < 4000, `took ${r.ms} ms`);
});

test("budget: the fast symbol still prints when a slow one is in the same prompt", () => {
  const r = run(["--text", "slowSymbol calls mergeGate twice"]);
  const l = lines(r.out);
  assert.equal(l.length, 1, r.out);
  assert.match(l[0], /^\[graph-recall\] mergeGate\(\)/);
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
  const r = run(["--text", "look at slowSymbol please"], { script: mutant("nobudget", "const BUDGET_MS = 1500;", "const BUDGET_MS = 10000;") });
  assert.match(r.out, /^\[graph-recall\] slowSymbol\(\) -> x\/slow\.ts:9/, r.out);
});

test("MUTANT no-floor: MIN_PROMPT_CHARS 0 prints on a short prompt that names a symbol (the floor arm is live)", () => {
  const r = run(["--text", "mergeGate"], { script: mutant("nofloor", "const MIN_PROMPT_CHARS = 12;", "const MIN_PROMPT_CHARS = 0;") });
  assert.match(r.out, /^\[graph-recall\] mergeGate\(\)/, r.out);
  assert.equal(run(["--text", "mergeGate"]).out, "", "the real script stays silent under 12 chars");
});
