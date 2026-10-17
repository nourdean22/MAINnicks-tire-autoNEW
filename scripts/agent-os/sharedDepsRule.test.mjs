/**
 * shared-deps-mutation: a filtered or package-changing pnpm/npm/yarn command can no longer prune the
 * shared node_modules that every junctioned worktree points at.
 *
 * INCIDENT (2026-10-17). A session in the PRIMARY checkout ran `pnpm --filter @statenour/web add ts-fsrs`.
 * pnpm pruned vite 7.3.6, and every worktree's nickstire tsc and vitest broke at once. Nothing guarded it:
 * install-in-junctioned-worktree only fires when cwd is a worktree, and its own `fix` text recommended a
 * filtered install in the primary.
 *
 * These tests run the REAL pretool.mjs (stdin in, exit code and rule id out), with a primary-checkout cwd,
 * through Bash, PowerShell and the MCP runner adapters. guard-red-team: a nonzero exit alone is not proof,
 * so every deny also asserts the rule id.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluate, loadPolicy } from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "pretool.mjs");
const PRIMARY = "C:/Users/nourd/NattyNour/nicks-tire";
const WORKTREE = "C:/Users/nourd/NattyNour/nicks-tire/.claude/worktrees/agent-x";
const RULE = "shared-deps-mutation";
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function run(tool_name, tool_input, cwd = PRIMARY) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), env: ENV, encoding: "utf8", timeout: 30000 });
  return { code: r.status, err: r.stderr ?? "" };
}
function denied(r, ruleId, what) {
  assert.equal(r.code, 2, `${what}: expected a deny (exit 2), got ${r.code}\n${r.err}`);
  assert.match(r.err, new RegExp(`BLOCKED by repo policy: ${ruleId}(?![\\w-])`), `${what}: wrong or missing rule id\n${r.err}`);
}
function allowed(r, what) {
  assert.equal(r.code, 0, `${what}: expected exit 0, got ${r.code}\n${r.err}`);
  assert.doesNotMatch(r.err, /hook error|adapter problem/, `${what}: the hook reported its own error\n${r.err}`);
}

const DENY = [
  "pnpm --filter @statenour/web add ts-fsrs", // the 2026-10-17 incident, verbatim
  "pnpm -F x install",
  'pnpm install --filter "nicks-tire-auto..."',
  "pnpm add zod",
  "pnpm remove x",
  "pnpm update",
  "pnpm prune",
  "npm uninstall x",
  "yarn add x",
  // fix round 1: a positional package on npm install, dedupe, and yarn's workspace form
  "npm install zod",
  "npm i zod",
  "pnpm dedupe",
  "yarn workspace @statenour/web add zod",
  "yarn workspace nicks-tire-auto remove vite",
];
const ALLOW = [
  "pnpm install --frozen-lockfile",
  "pnpm install",
  "pnpm test",
  "pnpm exec vitest run x",
  "pnpm --filter @statenour/web test",
  "pnpm run build:affected",
  'git commit -m "fix the pnpm add guard"',
  'echo "never run pnpm --filter x add y in the primary"',
  "npm install",
  "npm ci",
];

test("the incident and its siblings are DENIED in the primary checkout, through Bash and PowerShell, naming the rule", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    for (const command of DENY) denied(run(tool, { command }), RULE, `${tool}: ${command}`);
  }
});

test("everyday and full-install commands are ALLOWED in the primary checkout", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    for (const command of ALLOW) allowed(run(tool, { command }), `${tool}: ${command}`);
  }
});

test("the MCP runner adapters that run in the session's shell route the incident to the same rule (Terminal MCP, Monitor)", () => {
  const incident = DENY[0];
  denied(run("mcp__terminal__run_in_terminal", { command: incident }), RULE, "Terminal MCP");
  denied(run("Monitor", { command: incident, description: "d", timeout_ms: 1000 }), RULE, "Monitor");
});

test("Desktop Commander's process rows are exempt (they run in DC's OWN cwd): the scratchpad-clone recipe installs there", () => {
  // .claude/skills/harness-worktree-setup/SKILL.md section 3: the new dependency is installed in an isolated clone, and the
  // only runner that can do that from a worktree session is Desktop Commander. A cwd-free rule that judged it would close the
  // sanctioned path this rule's own denial points to. Residual, documented in docs/agent-os/README.md: DC pointed at the primary.
  const DC = "mcp__plugin_desktop-commander_desktop-commander__";
  allowed(run(`${DC}start_process`, { command: "pnpm add ts-fsrs", timeout_ms: 5000 }, WORKTREE), "DC start_process in a scratchpad clone");
  allowed(run(`${DC}interact_with_process`, { pid: 4242, input: "pnpm add ts-fsrs", timeout_ms: 8000 }, WORKTREE), "DC interact_with_process");
  // the exemption is exactly these two rules, so every other rule still judges DC
  denied(run(`${DC}start_process`, { command: "git push origin main", timeout_ms: 5000 }, WORKTREE), "push-to-main", "DC still judged by other rules");
  const rows = loadPolicy().mcpAdapters.filter((a) => a.id === "process-start" || a.id === "process-input");
  assert.equal(rows.length, 2);
  for (const r of rows) assert.deepEqual(r.exceptRules, ["install-in-junctioned-worktree", RULE], `${r.id}.exceptRules`);
});

test("a filter BEFORE the verb is no longer a worktree bypass either (the old rule needed the verb right after pnpm)", () => {
  denied(run("Bash", { command: "pnpm --filter @statenour/web add ts-fsrs" }, WORKTREE), RULE, "worktree, filter before add");
  denied(run("Bash", { command: "pnpm -F x install" }, WORKTREE), RULE, "worktree, -F before install");
  // the worktree rule keeps its own verdicts and its attribution
  denied(run("Bash", { command: "pnpm install" }, WORKTREE), "install-in-junctioned-worktree", "worktree plain install");
  denied(run("Bash", { command: "pnpm add zod" }, WORKTREE), "install-in-junctioned-worktree", "worktree add");
});

test("the global-install path stays open (it never touches the repo's node_modules)", () => {
  allowed(run("Bash", { command: "pnpm add -g typescript" }), "primary, pnpm add -g");
  allowed(run("mcp__plugin_desktop-commander_desktop-commander__start_process", { command: "pnpm add -g typescript", timeout_ms: 5000 }, WORKTREE), "Desktop Commander global install from a worktree session");
});

test("CANARY: with the rule removed, the incident command is allowed (the tests above are not green by accident)", () => {
  const policy = loadPolicy();
  const call = { toolName: "Bash", command: DENY[0], cwd: PRIMARY, filePath: "" };
  assert.equal(evaluate(call, policy).rule?.id, RULE, "the unbroken policy attributes the incident to the rule");
  policy.rules = policy.rules.filter((r) => r.id !== RULE);
  assert.equal(evaluate(call, policy).denied, false, "without the rule, nothing else denies the incident in the primary");
});

test("LINEAR: adversarial long inputs return fast (the first draft split `--x` two ways and took 68 ms at 22 options, x4 per 2 more)", () => {
  const rule = loadPolicy().rules.find((r) => r.id === RULE);
  const re = new RegExp(rule.pattern, rule.flags ?? "");
  const cases = [
    ["pnpm ", "--x ", 40], // the ambiguity axis: 40 options was hours with `-{1,2}[\w-]+`
    ["pnpm ", "-F x ", 40],
    ["pnpm ", "pnpm --x ", 30000],
    ["echo ", "pnpm ", 30000], // the mention lookbehind at every position
    ["", "psql ", 30000],
    ["pnpm install ", "a ", 30000], // the filter lookahead from every tool word
  ];
  for (const [prefix, unit, n] of cases) {
    const text = prefix + unit.repeat(n);
    const t0 = performance.now();
    re.test(text);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${JSON.stringify(unit)} x ${n}: ${ms.toFixed(0)} ms (must stay linear)`);
  }
  // and through the REAL hook, under the 2 s line the class sweep in mcpCoverage.test.mjs uses
  const t0 = Date.now();
  const r = run("Bash", { command: `pnpm ${"--x ".repeat(40)}` });
  assert.equal(r.code, 0);
  assert.ok(Date.now() - t0 < 2000, `real hook took ${Date.now() - t0} ms`);
});

test("the docs agents follow never recommend a filtered install, and AGENTS.md's Enforcement map names the rule", () => {
  // Codex, Cursor, Copilot and Gemini get no hook: for them these docs are the whole guard (fix round 1, 2026-10-17)
  const ROOT = join(HERE, "..", "..");
  const recommended = /--filter[ =]"[^"\n]*\.\.\."/; // the incident's advice: --filter "<app>..."
  for (const f of ["AGENTS.md", ".agents/frameworks/ciitty/SKILL.md", "agent-os/product/tech-stack.md", "agent-os/standards/global/tech-stack.md", ".claude/skills/harness-worktree-setup/SKILL.md"]) {
    const text = readFileSync(join(ROOT, f), "utf8");
    const hit = text.split("\n").findIndex((l) => recommended.test(l));
    assert.equal(hit, -1, `${f}:${hit + 1} still recommends a filtered install`);
  }
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const row = agents.split("\n").find((l) => l.startsWith("| ") && l.includes("blocked at the tool call")) ?? "";
  assert.match(row, /shared-deps-mutation/, "the Enforcement map row names the rule");
  assert.match(agents, /full, unfiltered `pnpm install --frozen-lockfile`/, "AGENTS.md says what to run instead");
});

test("the worktree rule's fix text never recommends a filtered command again", () => {
  const rule = loadPolicy().rules.find((r) => r.id === "install-in-junctioned-worktree");
  assert.doesNotMatch(rule.fix, /--filter|\s-F\s/, "a filtered install is the shape that pruned the shared store on 2026-10-17");
  assert.match(rule.fix, /harness-worktree-setup/, "the fix names the scratchpad-clone recipe");
  assert.match(rule.fix, /pnpm install --frozen-lockfile/, "the fix names the full, unfiltered install");
});
