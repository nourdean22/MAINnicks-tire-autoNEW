/**
 * MCP and native command-runner coverage - canaries (2026-10-15, job guard-mcp-coverage).
 *
 * THE GAP. `.claude/settings.json` registered pretool.mjs only for
 * `Bash|PowerShell|Write|Edit|NotebookEdit`, and every rule in config/agent-os/policy.json
 * carries a `tools` allowlist. So the SAME forbidden command delivered through any other tool
 * that runs commands or writes files was never judged. Probed 2026-10-15 by piping synthetic
 * JSON into the real hook: `git push origin main` exited 0 through the Terminal MCP
 * (run_in_terminal), through Desktop Commander and through the native Monitor tool, and a
 * `.env.local` write exited 0 through an MCP file tool.
 *
 * THE FIX UNDER TEST. A declarative `mcpAdapters` table in policy.json maps such a tool call
 * onto the logical tool the rules already understand (Bash or Write). adaptToolCall() in
 * policy.mjs does the mapping, pretool.mjs judges the mapped calls with the unchanged
 * evaluate(), and a second PreToolUse matcher group routes those tool names to pretool.mjs.
 * No rule text is duplicated: every rule applies through every adapter automatically.
 *
 * WHAT THIS FILE PINS - each block is a way the fix could be a silent instrument:
 *   1. the table is well formed, anchored, disjoint and documented
 *   2. every existing rule's deny and allow examples behave identically through the adapters
 *      (in-process, all rules x all adapters)
 *   3. the REAL pretool.mjs, stdin in and exit code out, per tool shape, with the field names
 *      copied from the live tool definitions; deny asserts the rule id, never just "nonzero"
 *   4. only the NAMED fields are read: content, old_string, Gmail bodies and unknown tools pass
 *   5. weird and oversized payloads never throw and are still judged at both ends
 *   6. the registration: the matcher parses, routes exactly the intended names, and means the
 *      same whether Claude Code treats it as an anchored or an unanchored regex
 *   7. BREAKS: a copy of the real hook with the table emptied, miswired or malformed stops
 *      denying, while the unbroken copy and native Bash keep denying
 *   8. SQL text tools (Neon run_sql, run_sql_transaction, explain_sql_statement, complete_database_migration;
 *      Prisma execute_sql_query, execute_prisma_postgres_schema_update): rows with a psql clientHint, an ARRAY
 *      reader for sql_statements, the matcher suffixes, every registration, and the documented limits (section 10)
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Namespace import on purpose: before the fix this module has no adaptToolCall, and a named import
// would fail the whole file at link time instead of failing the individual canaries.
import * as engine from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const HOOK = join(HERE, "pretool.mjs");

const policy = engine.loadPolicy();
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const README = readFileSync(join(ROOT, "docs", "agent-os", "README.md"), "utf8");

// Hook env carries no GIT_* (guard-red-team rule 6). The hook runs no git; the habit is the point.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

const NORMAL = "C:/Users/nourd/NOURCITY";
const WORKTREE = "C:/Users/nourd/NOURCITY/.claude/worktrees/some-session";
const NIGHT = "C:/Users/nourd/NOURCITY/.worktrees/night-shift-2026-09-15";

// Desktop Commander is registered TWICE on the operator's machine, as a plugin and as a connector
// UUID. The middle segment is not stable across accounts, so adapters match the tool-name SUFFIX.
const DC_PLUGIN = "mcp__plugin_desktop-commander_desktop-commander__";
const DC_CONNECTOR = "mcp__c23af5b4-e7d0-40b0-b6c6-346adaf3336c__";
const TERMINAL = "mcp__terminal__run_in_terminal";
// @modelcontextprotocol/server-filesystem: write set named in docs/codebase-memory-mcp.md.
const FS = "mcp__filesystem__";

// Input shapes below use the field names of the live tool definitions (read 2026-10-15).
const COMMAND_SHAPES = [
  { name: TERMINAL, input: (c) => ({ command: c, title: "t" }) },
  { name: "Monitor", input: (c) => ({ command: c, description: "watch", timeout_ms: 60000 }) },
  ...[DC_PLUGIN, DC_CONNECTOR].flatMap((p) => [
    { name: `${p}start_process`, input: (c) => ({ command: c, timeout_ms: 5000, shell: "powershell.exe" }) },
    { name: `${p}interact_with_process`, input: (c) => ({ pid: 4242, input: c, timeout_ms: 8000, wait_for_prompt: true }) },
  ]),
];

const FILE_SHAPES = [
  ...[DC_PLUGIN, DC_CONNECTOR].flatMap((p) => [
    { name: `${p}write_file`, field: "path", input: (v) => ({ path: v, content: "A=1", mode: "rewrite" }) },
    { name: `${p}edit_block`, field: "file_path", input: (v) => ({ file_path: v, old_string: "a", new_string: "b", expected_replacements: 1 }) },
    { name: `${p}move_file`, field: "destination", input: (v) => ({ source: "tmp/a.txt", destination: v }) },
    { name: `${p}move_file`, field: "source", input: (v) => ({ source: v, destination: "tmp/b.txt" }) },
  ]),
  { name: `${DC_PLUGIN}write_pdf`, field: "path", input: (v) => ({ path: v, content: "# t" }) },
  { name: `${DC_PLUGIN}write_pdf`, field: "outputPath", input: (v) => ({ path: "docs/in.pdf", content: [], outputPath: v }) },
  { name: `${FS}write_file`, field: "path", input: (v) => ({ path: v, content: "A=1" }) },
  { name: `${FS}edit_file`, field: "path", input: (v) => ({ path: v, edits: [{ oldText: "a", newText: "b" }] }) },
  { name: `${FS}move_file`, field: "destination", input: (v) => ({ source: "tmp/a.txt", destination: v }) },
  { name: `${FS}move_file`, field: "source", input: (v) => ({ source: v, destination: "tmp/b.txt" }) },
];

// SQL text tools (job 2026-10-15-guard-sql-lease-infra): judged by the same Bash rules as a command, through a
// psql clientHint (README "SQL text tools"). Field names are copied from the live tool schemas (read 2026-10-15).
// Every registration on this machine is listed: the middle segment of the tool name is per account and changes on
// reconnect, so the rows match the tool-name SUFFIX and the synthetic registrations in the SQL block prove it.
const NEON = "mcp__08daf860-d901-4ecf-8033-a2b41fe7f23d__";
const PRISMA_CONNECTOR = "mcp__1c28426e-fc0c-4e02-a13b-409e6d539b14__";
const PRISMA_PLUGIN = "mcp__plugin_prisma_Prisma-Remote__";
const SQL_SHAPES = [
  { name: `${NEON}run_sql`, field: "sql", row: "neon-sql", input: (v) => ({ sql: v, project_id: "p-1", branch_id: "br-1", database_name: "neondb" }) },
  { name: `${NEON}explain_sql_statement`, field: "sql", row: "neon-sql", input: (v) => ({ sql: v, analyze: false }) },
  { name: `${NEON}run_sql_transaction`, field: "sql_statements", array: true, row: "neon-sql-transaction", input: (v) => ({ sql_statements: v, project_id: "p-1" }) },
  { name: `${NEON}complete_database_migration`, field: "migration_sql", row: "neon-migration-apply", input: (v) => ({ migration_id: "m-1", migration_sql: v, database_name: "neondb", temporary_branch_id: "br-t", parent_branch_id: "br-p" }) },
  ...[PRISMA_CONNECTOR, PRISMA_PLUGIN].flatMap((p) => [
    { name: `${p}execute_sql_query`, field: "query", row: "prisma-sql", input: (v) => ({ query: v, projectId: "proj_1", databaseId: "db_1", reason: "r" }) },
    { name: `${p}execute_prisma_postgres_schema_update`, field: "query", row: "prisma-sql", input: (v) => ({ query: v, projectId: "proj_1", databaseId: "db_1" }) },
  ]),
];
const SQL_ROW_IDS = ["neon-sql", "neon-sql-transaction", "neon-migration-apply", "prisma-sql"];
// Registrations that do not exist on this machine but may on another account: the suffix match must claim them.
const SQL_SYNTHETIC = [
  ["mcp__plugin_neon_neon__run_sql", "neon-sql"],
  ["mcp__0000-synthetic__explain_sql_statement", "neon-sql"],
  ["mcp__plugin_neon_neon__run_sql_transaction", "neon-sql-transaction"],
  ["mcp__a-b-c__complete_database_migration", "neon-migration-apply"],
  ["mcp__plugin_prisma_prisma__execute_sql_query", "prisma-sql"],
];
// Tools of the same servers that are deliberately NOT judged by text (README "SQL text tools").
const SQL_UNJUDGED = [
  `${NEON}prepare_database_migration`, `${NEON}prepare_query_tuning`, `${NEON}complete_query_tuning`, `${NEON}get_connection_string`,
  `${PRISMA_CONNECTOR}introspect_database_schema`, `${PRISMA_PLUGIN}list_prisma_postgres_databases`,
];
const sqlInput = (shape, text) => shape.input(shape.array ? [text] : text);
const leaf = (name) => name.split("__").pop();

const NATIVE = ["Bash", "PowerShell", "Write", "Edit", "NotebookEdit"];
const NATIVE_MATCHER = "Bash|PowerShell|Write|Edit|NotebookEdit";

const FORBIDDEN = [
  ["git push origin main", "push-to-main"],
  ["git push --force origin chore/x", "force-push"],
  ['psql -c "DROP TABLE leads"', "destructive-sql"],
  ["pnpm prisma migrate reset --force", "destructive-prisma"],
];

// --- harness ----------------------------------------------------------------------------------

function run(tool_name, tool_input, cwd = NORMAL, hook = HOOK) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name, tool_input, cwd }),
    env: ENV,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { code: r.status, signal: r.signal, err: r.stderr ?? "", ms: Date.now() - t0 };
}

function denied(r, ruleId, what) {
  assert.equal(r.code, 2, `${what}: expected a deny (exit 2), got ${r.code}\n${r.err}`);
  assert.match(r.err, new RegExp(`BLOCKED by repo policy: ${ruleId}(?![\\w-])`), `${what}: wrong or missing rule attribution\n${r.err}`);
}

function allowed(r, what) {
  assert.equal(r.code, 0, `${what}: expected exit 0, got ${r.code}\n${r.err}`);
  assert.doesNotMatch(r.err, /hook error|adapter problem/, `${what}: the hook reported its own error\n${r.err}`);
}

// In-process: judge a tool call exactly as pretool.mjs does.
function judge(toolName, input, cwd, pol = policy) {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const calls = engine.adaptToolCall(toolName, input, cwd, pol);
  assert.ok(Array.isArray(calls), `${toolName}: no adapter claims this tool`);
  for (const call of calls) {
    const res = engine.evaluate(call, pol);
    if (res.denied) return res;
  }
  return { denied: false };
}

const cwdFor = (rule) => rule.cwdExample ?? (rule.onlyWhenCwdMatches ? WORKTREE : NORMAL);
const adapters = () => policy.mcpAdapters ?? [];
const bashRules = policy.rules.filter((r) => r.pattern && (Array.isArray(r.tools) ? r.tools.includes("Bash") : true));
const fileRules = policy.rules.filter((r) => r.pathPattern && (Array.isArray(r.tools) ? r.tools.includes("Write") : true));

// A copy of the REAL hook (pretool.mjs + policy.mjs) beside a policy.json we are free to break.
// policy.mjs resolves policy.json relative to itself, so the copy needs no env var or flag.
function withTree(mutate, fn, mutateSource) {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-mcp-"));
  try {
    mkdirSync(join(dir, "scripts", "agent-os"), { recursive: true });
    mkdirSync(join(dir, "config", "agent-os"), { recursive: true });
    for (const f of ["pretool.mjs", "policy.mjs"]) copyFileSync(join(HERE, f), join(dir, "scripts", "agent-os", f));
    if (mutateSource) {
      // Source-level BREAKS arm: rewrite the COPY of policy.mjs. A replace that finds nothing would test nothing, so it must change the text.
      const path = join(dir, "scripts", "agent-os", "policy.mjs");
      const before = readFileSync(path, "utf8");
      const after = mutateSource(before);
      assert.notEqual(after, before, "the source mutation changed nothing in policy.mjs: the BREAKS arm would be vacuous");
      writeFileSync(path, after);
    }
    const p = JSON.parse(readFileSync(engine.POLICY_PATH, "utf8"));
    mutate?.(p);
    writeFileSync(join(dir, "config", "agent-os", "policy.json"), JSON.stringify(p));
    return fn(join(dir, "scripts", "agent-os", "pretool.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 1 - the table --------------------------------------------------------------------------

test("adapter table: present, well formed, anchored, disjoint and documented", () => {
  assert.ok(Array.isArray(policy.mcpAdapters), "policy.json has no mcpAdapters table");
  assert.ok(policy.mcpAdapters.length >= 6, `expected the 6 runner and file adapters, got ${policy.mcpAdapters.length}`);
  const ids = policy.mcpAdapters.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "adapter ids must be unique");
  for (const a of policy.mcpAdapters) {
    assert.ok(a.id && typeof a.id === "string", "adapter missing id");
    assert.ok(a.why?.length > 20, `${a.id}: 'why' must name the tool and the field it judges`);
    assert.ok(typeof a.toolPattern === "string" && a.toolPattern.startsWith("^") && a.toolPattern.endsWith("$"),
      `${a.id}: toolPattern must be anchored ^...$ (a substring match would claim look-alike tool names)`);
    assert.doesNotThrow(() => new RegExp(a.toolPattern), `${a.id}: toolPattern does not compile`);
    assert.ok(a.as === "Bash" || a.as === "Write", `${a.id}: 'as' must be Bash or Write`);
    const fields = a.as === "Write" ? a.pathFields : a.commandFields;
    const other = a.as === "Write" ? a.commandFields : a.pathFields;
    assert.ok(Array.isArray(fields) && fields.length >= 1 && fields.every((f) => typeof f === "string" && f), `${a.id}: needs a non-empty list of field names`);
    assert.equal(other, undefined, `${a.id}: a Bash adapter reads commandFields only, a Write adapter pathFields only`);
    assert.ok(a.cwdField === undefined || (typeof a.cwdField === "string" && a.cwdField), `${a.id}: cwdField must be a field name`);
    assert.ok(Array.isArray(a.exampleTools) && a.exampleTools.length >= 1, `${a.id}: needs >=1 exampleTools (the canaries iterate them)`);
    for (const n of NATIVE) assert.ok(!new RegExp(a.toolPattern).test(n), `${a.id}: must not claim the native tool ${n}`);
    // optional fields (review fixes 2026-10-15): strict, independent shape checks
    if (a.clientHint !== undefined) assert.ok(a.as === "Bash" && typeof a.clientHint === "string" && a.clientHint, `${a.id}: clientHint is a non-empty string on a Bash row`);
    // no dead or mistyped config: every key of a row is one the code reads (a stray key is silently ignored)
    for (const key of Object.keys(a)) {
      assert.ok(["id", "toolPattern", "as", "commandFields", "pathFields", "cwdField", "exceptRules", "clientHint", "skipWhenTrue", "expandDirectory", "exampleTools", "why"].includes(key),
        `${a.id}: unknown row field '${key}'`);
    }
    if (a.exceptRules !== undefined) {
      assert.ok(Array.isArray(a.exceptRules) && a.exceptRules.length >= 1, `${a.id}: exceptRules must list rule ids`);
      for (const id of a.exceptRules) assert.ok(policy.rules.some((r) => r.id === id), `${a.id}: exceptRules names '${id}', which is not a rule in policy.json`);
    }
    if (a.skipWhenTrue !== undefined) assert.ok(Array.isArray(a.skipWhenTrue) && a.skipWhenTrue.length >= 1 && a.skipWhenTrue.every((k) => typeof k === "string" && k), `${a.id}: skipWhenTrue must list field names`);
    if (a.expandDirectory !== undefined) {
      assert.equal(a.as, "Write", `${a.id}: expandDirectory yields Write judgments, so it belongs on a Write row`);
      assert.ok(a.pathFields.includes(a.expandDirectory.from) && a.pathFields.includes(a.expandDirectory.to), `${a.id}: expandDirectory from/to must be path fields of the row`);
    }
  }
});

test("adapter table: every example tool is claimed by its own adapter and by no other", () => {
  assert.ok(adapters().length >= 6, "no adapter table to check (a loop over nothing is a silent green)");
  for (const a of adapters()) {
    for (const tool of a.exampleTools) {
      const claimants = adapters().filter((b) => new RegExp(b.toolPattern).test(tool)).map((b) => b.id);
      assert.deepEqual(claimants, [a.id], `${tool} must be claimed by exactly ${a.id}, got [${claimants}]`);
    }
  }
});

test("adapter table: both Desktop Commander registrations are claimed (suffix match, not a pinned server segment)", () => {
  for (const p of [DC_PLUGIN, DC_CONNECTOR]) {
    for (const t of ["start_process", "interact_with_process", "write_file", "edit_block", "move_file"]) {
      assert.ok(adapters().some((a) => new RegExp(a.toolPattern).test(`${p}${t}`)), `no adapter claims ${p}${t}`);
    }
  }
});

// --- 2 - in-process parity: every rule through every adapter -----------------------------------

test("parity: every Bash-family denyExample is denied by the SAME rule through every command adapter", () => {
  const cmdAdapters = adapters().filter((a) => a.as === "Bash");
  assert.ok(cmdAdapters.length >= 4, "expected the command adapters");
  let checked = 0;
  for (const a of cmdAdapters) {
    for (const tool of a.exampleTools) {
      for (const field of a.commandFields) {
        for (const rule of bashRules) {
          // a row is exempt from exactly the rules in its exceptRules; that exemption has its own canaries
          if (a.exceptRules?.includes(rule.id)) continue;
          for (const sample of rule.denyExamples) {
            const res = judge(tool, { [field]: sample }, cwdFor(rule));
            assert.ok(res.denied, `${tool}.${field}: ${rule.id} should DENY ${JSON.stringify(sample)}`);
            assert.equal(res.rule.id, rule.id, `${tool}.${field}: ${JSON.stringify(sample)} was denied by '${res.rule.id}', not '${rule.id}'`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked >= 400, `only ${checked} deny judgments ran: the loop is not reaching the rules`);
});

test("parity: every Bash-family allowExample stays allowed through every command adapter", () => {
  assert.ok(adapters().filter((x) => x.as === "Bash").length >= 4, "expected the command adapters (a loop over nothing is a silent green)");
  for (const a of adapters().filter((x) => x.as === "Bash")) {
    for (const tool of a.exampleTools) {
      for (const field of a.commandFields) {
        for (const rule of bashRules) {
          for (const sample of rule.allowExamples) {
            const res = judge(tool, { [field]: sample }, cwdFor(rule));
            assert.ok(!res.denied, `${tool}.${field}: should ALLOW ${JSON.stringify(sample)} but '${res.rule?.id}' blocked it`);
          }
        }
      }
    }
  }
});

test("parity: every file-rule denyExample is denied by the SAME rule through every file adapter and path field", () => {
  const fileAdapters = adapters().filter((a) => a.as === "Write");
  assert.ok(fileAdapters.length >= 2, "expected the file adapters");
  let checked = 0;
  for (const a of fileAdapters) {
    for (const tool of a.exampleTools) {
      for (const field of a.pathFields) {
        for (const rule of fileRules) {
          for (const sample of rule.denyExamples) {
            const res = judge(tool, { [field]: sample }, cwdFor(rule));
            assert.ok(res.denied, `${tool}.${field}: ${rule.id} should DENY ${JSON.stringify(sample)}`);
            assert.equal(res.rule.id, rule.id, `${tool}.${field}: ${JSON.stringify(sample)} was denied by '${res.rule.id}', not '${rule.id}'`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked >= 200, `only ${checked} deny judgments ran: the loop is not reaching the rules`);
});

test("parity: every file-rule allowExample stays allowed through every file adapter", () => {
  assert.ok(adapters().filter((x) => x.as === "Write").length >= 2, "expected the file adapters (a loop over nothing is a silent green)");
  for (const a of adapters().filter((x) => x.as === "Write")) {
    for (const tool of a.exampleTools) {
      for (const field of a.pathFields) {
        for (const rule of fileRules) {
          for (const sample of rule.allowExamples) {
            const res = judge(tool, { [field]: sample }, cwdFor(rule));
            assert.ok(!res.denied, `${tool}.${field}: should ALLOW ${JSON.stringify(sample)} but '${res.rule?.id}' blocked it`);
          }
        }
      }
    }
  }
});

test("native tools are never adapted, even if an adapter pattern would match them", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const hostile = structuredClone(policy);
  hostile.mcpAdapters = [{ id: "catch-all", toolPattern: ".*", as: "Bash", commandFields: ["command"], exampleTools: ["x"], why: "a catch-all must not capture the native tools" }];
  for (const n of NATIVE) {
    assert.equal(engine.adaptToolCall(n, { command: "git push origin main", file_path: ".env" }, NORMAL, hostile), null, `${n} must reach the rules as itself`);
    assert.equal(engine.adaptToolCall(n, { command: "git push origin main" }, NORMAL, policy), null, `${n} must not be adapted by the real table`);
  }
});

test("unclaimed tools are returned as null (judged as themselves, which no rule claims)", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  for (const n of ["Read", "mcp__plugin_small-business_gmail__create_draft", "mcp__unknown__exec_cmd", "", undefined, null, 7]) {
    assert.equal(engine.adaptToolCall(n, { command: "git push origin main" }, NORMAL, policy), null, `${String(n)} must be unclaimed`);
  }
});

test("a tool claimed by an adapter yields only the NAMED fields, in table order, with provenance", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const calls = engine.adaptToolCall(`${DC_PLUGIN}move_file`, { source: "a/.env.local", destination: "b/c.txt", content: "ignored", note: ".env" }, NORMAL, policy);
  assert.deepEqual(calls.map((c) => [c.toolName, c.filePath, c.command]), [["Write", "a/.env.local", ""], ["Write", "b/c.txt", ""]]);
  assert.ok(calls.every((c) => /^file-move\./.test(c.via)), "each judged call must say which adapter row produced it");
});

// --- 3 - end to end through the REAL hook, per tool shape -------------------------------------

for (const shape of COMMAND_SHAPES) {
  test(`e2e command runner ${shape.name.replace(/^mcp__/, "")}: DENIED for push/force/SQL/prisma, ALLOWED for a benign command and a mention`, () => {
    for (const [command, rule] of FORBIDDEN) {
      denied(run(shape.name, shape.input(command)), rule, `${shape.name} <- ${command}`);
    }
    allowed(run(shape.name, shape.input("git status --porcelain")), `${shape.name} benign`);
    // mention is not execution: the same preprocessing the Bash path has applies here, no worse
    allowed(run(shape.name, shape.input('git commit -m "docs: forbid git push origin main"')), `${shape.name} commit message mention`);
    allowed(run(shape.name, shape.input('rg -n "git push origin main" docs/')), `${shape.name} read-only search mention`);
  });
}

for (const shape of FILE_SHAPES) {
  test(`e2e file tool ${shape.name.replace(/^mcp__/, "")} [${shape.field}]: .env files DENIED, ordinary paths and .env.example ALLOWED`, () => {
    for (const p of [".env.local", "apps/statenour/.env.production", "C:\\repo\\apps\\nickstire\\.env"]) {
      denied(run(shape.name, shape.input(p)), "secret-file-write", `${shape.name}.${shape.field}=${p}`);
    }
    allowed(run(shape.name, shape.input("docs/agent-os/README.md")), `${shape.name}.${shape.field} benign path`);
    allowed(run(shape.name, shape.input("apps/statenour/.env.example")), `${shape.name}.${shape.field} .env.example is the tracked contract`);
  });
}

test("e2e control: native tools are still judged exactly as before (unbroken Bash control)", () => {
  denied(run("Bash", { command: "git push origin main" }), "push-to-main", "Bash push to main");
  denied(run("PowerShell", { command: "git push origin main" }), "push-to-main", "PowerShell push to main");
  denied(run("Write", { file_path: "apps/statenour/.env.local", content: "x" }), "secret-file-write", "Write .env.local");
  denied(run("Edit", { file_path: ".env", old_string: "a", new_string: "b" }), "secret-file-write", "Edit .env");
  denied(run("NotebookEdit", { notebook_path: "apps/x/.env.local" }), "secret-file-write", "NotebookEdit .env.local");
  allowed(run("Bash", { command: "git status" }), "Bash benign");
  allowed(run("Write", { file_path: "docs/x.md", content: "git push origin main" }), "Write content that mentions a push");
});

// --- cwd-scoped rules reach the MCP runners ---------------------------------------------------

test("cwd-scoped rules apply through MCP runners: the SESSION cwd is judged and a tool-supplied cwd cannot launder it", () => {
  denied(run(TERMINAL, { command: "pnpm install" }, WORKTREE), "install-in-junctioned-worktree", "session cwd is a worktree");
  denied(run(TERMINAL, { command: "pnpm install", cwd: WORKTREE }, NORMAL), "install-in-junctioned-worktree", "tool cwd is a worktree");
  denied(run(TERMINAL, { command: "pnpm install", cwd: NORMAL }, WORKTREE), "install-in-junctioned-worktree", "a decoy tool cwd must not launder the session cwd");
  allowed(run(TERMINAL, { command: "pnpm install", cwd: NORMAL }, NORMAL), "install in the primary checkout is legitimate");
});

test("night-shift identity rules reach EVERY command runner (Terminal, Monitor, both Desktop Commander process tools) and the file tools; a normal session is untouched", () => {
  const start = `${DC_PLUGIN}start_process`;
  for (const shape of COMMAND_SHAPES) {
    denied(run(shape.name, shape.input("gh pr merge 2401 --squash"), NIGHT), "night-shift-no-merge", `${shape.name}: merge`);
    denied(run(shape.name, shape.input("git push -u origin chore/sneaky"), NIGHT), "night-shift-push-scope", `${shape.name}: off-branch push`);
    denied(run(shape.name, shape.input("echo x > .claude/settings.json"), NIGHT), "night-shift-no-judge-edits-shell", `${shape.name}: judge write`);
  }
  denied(run(`${DC_PLUGIN}write_file`, { path: "config/agent-os/policy.json", content: "{}" }, NIGHT), "night-shift-no-judge-edits", "judge write through write_file");
  denied(run(`${FS}edit_file`, { path: "scripts/agent-os/pretool.mjs", edits: [] }, NIGHT), "night-shift-no-judge-edits", "judge edit through edit_file");
  allowed(run(start, { command: "gh pr merge 2401 --squash", timeout_ms: 1000 }, NORMAL), "merge is normal work in a normal session");
  allowed(run(`${DC_PLUGIN}write_file`, { path: "config/agent-os/policy.json", content: "{}" }, NORMAL), "editing the policy is normal work in a normal session");
});

// --- 4 - only the NAMED fields are read -------------------------------------------------------

const MENTION = "git push origin main\npsql -c 'DROP TABLE leads'\nAPI_KEY=x";

test("file tools judge PATHS only: content, old_string and new_string that mention forbidden text pass", () => {
  allowed(run(`${DC_PLUGIN}write_file`, { path: "docs/notes.md", content: MENTION }), "write_file content");
  allowed(run(`${DC_PLUGIN}edit_block`, { file_path: "docs/notes.md", old_string: "git push origin main", new_string: "git push --force origin main" }), "edit_block strings");
  allowed(run(`${FS}edit_file`, { path: "docs/notes.md", edits: [{ oldText: "a", newText: "git push origin main" }] }), "edit_file edits");
});

test("tools that merely carry text are never scanned (Gmail, Linear, Sheets), and reads are not writes", () => {
  for (const [name, input] of [
    ["mcp__plugin_small-business_gmail__create_draft", { to: ["a@b.co"], subject: "git push origin main", body: MENTION }],
    ["mcp__7033aacf-5b65-4517-9c59-2946508a1630__save_comment", { issueId: "X-1", body: MENTION }],
    ["mcp__9f7fe135-9ee9-4703-b6dd-9f1d76e80d55__update_values", { range: "A1", values: [[MENTION]] }],
    ["mcp__terminal__read_terminal", { lines: 5 }],
    ["Read", { file_path: ".env.local" }],
    [`${DC_PLUGIN}read_file`, { path: ".env.local" }],
    [`${DC_PLUGIN}start_search`, { path: "C:/repo", pattern: "git push origin main" }],
    ["Monitor", { ws: { url: "wss://events.example.com/stream" }, description: "deploy events", timeout_ms: 60000 }],
  ]) {
    allowed(run(name, input), name);
  }
});

test("unknown runners are NOT guessed at: a new runner is a table row (README), not a field scan", () => {
  allowed(run("mcp__unknown__exec_cmd", { command: "git push origin main" }), "unregistered tool with a command field");
});

// --- 5 - weird and oversized payloads ---------------------------------------------------------

test("missing, non-string and malformed fields never throw (no hook error, exit 0)", () => {
  const weird = [undefined, null, "git push origin main", 42, true, [], ["git push origin main"],
    { command: 123 }, { command: null }, { command: { x: "git push origin main" } },
    { command: "" }, { path: 7 }, { path: ["a"] }, { file_path: { a: 1 } }, { source: null, destination: false }, { cwd: 5, command: "git status" },
    { command: [null, 5, { x: "git push origin main" }, ["git push origin main"]] }];
  for (const name of [TERMINAL, "Monitor", `${DC_PLUGIN}write_file`, `${DC_PLUGIN}move_file`, `${DC_CONNECTOR}interact_with_process`]) {
    for (const tool_input of weird) {
      allowed(run(name, tool_input), `${name} <- ${JSON.stringify(tool_input)}`);
    }
  }
});

test("a LIST in a named field is judged element by element, so it can only add denials (changed 2026-10-15: it used to be skipped)", () => {
  // The list reader serves run_sql_transaction.sql_statements. It reads every named field, so a list in a command field
  // is judged too: the tools' schemas only accept strings there, and a string element that holds a forbidden command is
  // denied rather than silently skipped. Non-string elements and nested lists stay ignored (the weird-field canary above).
  const r = run(TERMINAL, { command: ["git status", "git push origin main"] });
  denied(r, "push-to-main", "a forbidden command inside a list given for a command field");
  assert.match(r.err, /Judged through MCP adapter terminal-run\.command\[1\] on tool /);
  allowed(run(TERMINAL, { command: ["git status", "git diff"] }), "a list of benign commands");
});

test("oversized fields never throw or hang, and are judged at the head and the tail", () => {
  const filler = "A".repeat(2_000_000);
  const benign = run(TERMINAL, { command: filler });
  allowed(benign, "2 MB benign command");
  assert.equal(benign.signal, null, "the hook must not run into its own timeout on a huge field");
  assert.ok(benign.ms < 8000, `a 2 MB field took ${benign.ms} ms; the hook timeout is 10 s and a timeout fails OPEN`);
  denied(run(TERMINAL, { command: `git push origin main\n${filler}` }), "push-to-main", "forbidden text at the head of 2 MB");
  denied(run(TERMINAL, { command: `${filler}\ngit push origin main` }), "push-to-main", "forbidden text at the tail of 2 MB");
  allowed(run(`${DC_PLUGIN}write_file`, { path: "docs/big.md", content: filler }), "2 MB of file content is never scanned");
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const calls = engine.adaptToolCall(TERMINAL, { command: filler }, NORMAL, policy);
  assert.ok(calls.length === 2 && calls.every((c) => c.command.length <= engine.FIELD_CAP / 2), "an oversized field is judged as two slices, each within half the cap");
});

// --- 6 - the registration ---------------------------------------------------------------------

// Claude Code hook matcher semantics, per code.claude.com/docs/en/hooks (read 2026-10-15): a string
// of only letters, digits, _ - space , | is an exact name or a list of exact names; anything else is
// a JavaScript regex tested UNANCHORED with RegExp.prototype.test. "*", "" and omitted match all.
const EXACT_ONLY = /^[A-Za-z0-9_\-\s,|]*$/;
function matcherMatches(matcher, toolName) {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (EXACT_ONLY.test(matcher)) return matcher.split(/[|,]/).map((s) => s.trim()).includes(toolName);
  return new RegExp(matcher).test(toolName);
}
const preGroups = (s) => s.hooks?.PreToolUse ?? [];
const groupsFor = (s, toolName) => preGroups(s).filter((g) => matcherMatches(g.matcher, toolName));
const commandsOf = (g) => (g.hooks ?? []).filter((h) => h.type === "command").map((h) => h.command);
const runsPretool = (g) => commandsOf(g).some((c) => /scripts\/agent-os\/pretool\.mjs/.test(c));

const ROUTED = [...new Set([...COMMAND_SHAPES.map((s) => s.name), ...FILE_SHAPES.map((s) => s.name), ...SQL_SHAPES.map((s) => s.name)])];
const NOT_ROUTED = [
  "Read", "Grep", "Glob", "WebFetch", "Skill", "TaskStop",
  "mcp__plugin_small-business_gmail__create_draft",
  "mcp__terminal__read_terminal", "mcp__terminal__open_terminal_tab", "mcp__terminal__stop_terminal_tab", "mcp__terminal__list_terminal_tabs",
  `${DC_PLUGIN}read_file`, `${DC_PLUGIN}list_directory`, `${DC_PLUGIN}read_process_output`, `${DC_PLUGIN}kill_process`,
  `${DC_PLUGIN}force_terminate`, `${DC_PLUGIN}start_search`, `${DC_PLUGIN}get_config`, `${DC_CONNECTOR}read_file`,
  "mcp__ccd_pr__set_monitor",
  ...SQL_UNJUDGED,
];
// Names that a sloppy, unanchored pattern would route. None is a real tool: the point is exactness.
const TRICKY = ["TaskMonitor", "MonitorX", "xmcp__x__start_process", "mcp__x__run_in_terminal_extra",
  "mcp__x__not_start_process", "mcp__x__write_file_to_cloud", "mcp__x__interact_with_process2", "mcp__start_process",
  "mcp__x__run_sql_extra", "mcp__x__not_run_sql", "mcp__x__run_sql_transaction_extra", "mcp__x__explain_sql_statement_v2",
  "mcp__x__execute_sql_query2", "mcp__x__complete_database_migration_all", "xmcp__x__run_sql", "mcp__run_sql"];

test("registration: every runner and file tool is routed to pretool.mjs by a PreToolUse group", () => {
  for (const name of ROUTED) {
    assert.ok(groupsFor(settings, name).some(runsPretool), `no PreToolUse group routes ${name} to pretool.mjs`);
  }
  for (const a of adapters()) {
    for (const t of a.exampleTools) {
      assert.ok(groupsFor(settings, t).some(runsPretool), `adapter ${a.id}: ${t} is claimed by the table but never routed to the hook`);
    }
  }
});

test("registration: nothing else is routed, and native tools keep their original group alone", () => {
  for (const name of [...NOT_ROUTED, ...TRICKY]) {
    assert.deepEqual(groupsFor(settings, name).filter(runsPretool).length, 0, `${name} must not be routed to the hook`);
  }
  for (const name of NATIVE) {
    const groups = groupsFor(settings, name).filter(runsPretool);
    assert.equal(groups.length, 1, `${name} must match exactly one pretool group`);
    assert.equal(groups[0].matcher, NATIVE_MATCHER, `${name} must still be routed by the original matcher`);
  }
});

test("registration: the original group is untouched (pretool then lease-check) and the MCP group runs pretool ONLY", () => {
  const original = preGroups(settings).find((g) => g.matcher === NATIVE_MATCHER);
  assert.ok(original, "the original Bash|PowerShell|Write|Edit|NotebookEdit group is gone");
  assert.deepEqual(commandsOf(original).map((c) => c.match(/(pretool|lease-check)\.mjs/)?.[1]), ["pretool", "lease-check"]);
  const mcp = groupsFor(settings, TERMINAL);
  assert.equal(mcp.length, 1, `exactly one group should route ${TERMINAL}, got ${mcp.length}`);
  assert.deepEqual(commandsOf(mcp[0]).map((c) => c.match(/([\w-]+)\.mjs/)?.[1]), ["pretool"],
    "the MCP group must run pretool.mjs only: lease-check keeps its own tool set (documented in the README)");
});

test("registration: the matcher is a regex that means the same anchored or unanchored", () => {
  const group = groupsFor(settings, TERMINAL)[0];
  assert.ok(group, `no group routes ${TERMINAL}`);
  const m = group.matcher;
  assert.ok(!EXACT_ONLY.test(m), "a matcher of only letters, digits and _ - , | would be an EXACT-name list, not a regex, and would match nothing here");
  assert.doesNotThrow(() => new RegExp(m), "the matcher must compile as a JavaScript regex");
  for (const name of [...ROUTED, ...NOT_ROUTED, ...TRICKY, ...NATIVE]) {
    const unanchored = new RegExp(m).test(name);
    const anchored = new RegExp(`^(?:${m})$`).test(name);
    assert.equal(unanchored, anchored, `${name}: the matcher gives a different answer anchored (${anchored}) and unanchored (${unanchored})`);
    assert.equal(unanchored, ROUTED.includes(name), `${name}: routed=${unanchored}, expected ${ROUTED.includes(name)}`);
  }
});

test("registration: the configured command string, run VERBATIM, denies through an MCP tool (guard-red-team rule 5)", () => {
  const group = groupsFor(settings, TERMINAL).find(runsPretool);
  assert.ok(group, `no group routes ${TERMINAL}`);
  const command = commandsOf(group).find((c) => /pretool\.mjs/.test(c));
  assert.ok(!command.includes("\\"), "a backslash separator does not resolve on Linux (cloud sessions)");
  const env = { ...ENV, CLAUDE_PROJECT_DIR: ROOT };
  // cmd.exe does not expand ${VAR}: on Windows expand it here; POSIX shells expand it themselves.
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const go = (input) => spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify(input), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  const bad = go({ tool_name: TERMINAL, tool_input: { command: "git push origin main" }, cwd: NORMAL });
  assert.equal(bad.status, 2, `expected a deny through the configured command, got ${bad.status}\n${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /BLOCKED by repo policy: push-to-main/);
  const ok = go({ tool_name: TERMINAL, tool_input: { command: "git status" }, cwd: NORMAL });
  assert.equal(ok.status, 0, `a harmless command was not allowed (exit ${ok.status})\n${ok.stdout}${ok.stderr}`);
});

test("BREAKS: dropping the MCP group from the registration makes the reachability canary fail", () => {
  const broken = structuredClone(settings);
  broken.hooks.PreToolUse = broken.hooks.PreToolUse.filter((g) => !matcherMatches(g.matcher, TERMINAL));
  assert.ok(groupsFor(settings, TERMINAL).some(runsPretool), "control: the real registration routes the terminal tool");
  assert.ok(!groupsFor(broken, TERMINAL).some(runsPretool), "the broken registration must NOT route it, or the registration canaries prove nothing");
  assert.ok(groupsFor(broken, "Bash").some(runsPretool), "control: the original group survives the mutation");
});

// --- 7 - BREAK the real hook ------------------------------------------------------------------

test("BREAKS: a copy of the real hook denies through MCP; emptying or miswiring the table makes the same call pass", () => {
  const payload = (hook) => run(TERMINAL, { command: "git push origin main" }, NORMAL, hook);
  const native = (hook) => run("Bash", { command: "git push origin main" }, NORMAL, hook);
  withTree(null, (hook) => denied(payload(hook), "push-to-main", "unbroken copy of the hook"));
  withTree((p) => { p.mcpAdapters = []; }, (hook) => {
    allowed(payload(hook), "empty adapter table");
    denied(native(hook), "push-to-main", "native Bash in the same tree");
  });
  withTree((p) => { delete p.mcpAdapters; }, (hook) => allowed(payload(hook), "no adapter table at all"));
  withTree((p) => { for (const a of p.mcpAdapters ?? []) if (a.commandFields) a.commandFields = ["cmd"]; }, (hook) => allowed(payload(hook), "adapter reads the wrong field"));
  // a WELL-FORMED row that treats the command text as a file path: the rules never see a command
  withTree((p) => {
    for (const a of p.mcpAdapters ?? []) {
      if (a.as === "Bash") { a.as = "Write"; a.pathFields = a.commandFields; delete a.commandFields; delete a.clientHint; }
    }
  }, (hook) => allowed(payload(hook), "adapter maps onto the wrong logical tool"));
  withTree((p) => { for (const a of p.mcpAdapters ?? []) a.toolPattern = "^nothing$"; }, (hook) => allowed(payload(hook), "adapter pattern matches no real tool"));
});

test("a malformed adapter row costs only that row: loud stderr, the other rows and native rules keep denying", () => {
  const broken = { id: "broken", toolPattern: "(", as: "Bash", commandFields: ["command"], exampleTools: ["x"], why: "an invalid regex must not disable the table" };
  const noPattern = { id: "no-pattern", as: "Bash", commandFields: ["command"], exampleTools: ["x"], why: "a missing pattern must not claim every tool" };
  const noFields = { id: "no-fields", toolPattern: "^mcp__.+__run_in_terminal$", as: "Bash", commandFields: [], exampleTools: ["x"], why: "an empty field list must not claim the tool" };
  withTree((p) => { p.mcpAdapters = [broken, noPattern, noFields, ...(p.mcpAdapters ?? [])]; }, (hook) => {
    const r = run(TERMINAL, { command: "git push origin main" }, NORMAL, hook);
    denied(r, "push-to-main", "a valid row after malformed rows");
    assert.match(r.err, /\[agent-os\] pretool MCP adapter problem/, "a malformed row must be reported on stderr");
    // the row with no pattern must not claim every tool (new RegExp(undefined) matches everything)
    const gmail = run("mcp__plugin_small-business_gmail__create_draft", { body: "git push origin main" }, NORMAL, hook);
    assert.equal(gmail.code, 0, `a row with no pattern captured an unrelated tool\n${gmail.err}`);
    denied(run("Bash", { command: "git push origin main" }, NORMAL, hook), "push-to-main", "native Bash beside malformed rows");
  });
  // the only row that WOULD claim the tool is malformed: that call fails open, loudly, and native still denies
  withTree((p) => { p.mcpAdapters = [{ ...broken, toolPattern: "^mcp__terminal__run_in_terminal$(" }]; }, (hook) => {
    const r = run(TERMINAL, { command: "git push origin main" }, NORMAL, hook);
    assert.equal(r.code, 0, `a malformed only-row fails open, got ${r.code}\n${r.err}`);
    assert.match(r.err, /\[agent-os\] pretool MCP adapter problem/);
    denied(run("Bash", { command: "git push origin main" }, NORMAL, hook), "push-to-main", "native Bash beside a malformed table");
  });
});

// --- 8 - docs ----------------------------------------------------------------------------------

test("README documents every adapter, the unguarded inventory and the live check", () => {
  for (const a of adapters()) assert.ok(README.includes(`\`${a.id}\``), `docs/agent-os/README.md does not mention adapter ${a.id}`);
  assert.match(README, /### Still unguarded/, "README needs the honest unguarded inventory");
  assert.match(README, /### Live check after merge/, "README needs the 2-minute live check");
  for (const s of SQL_SHAPES) {
    assert.ok(README.includes(`\`${leaf(s.name)}\``), `the README adapter table must name the SQL tool ${leaf(s.name)}`);
  }
  for (const field of ["clientHint", "exceptRules", "skipWhenTrue", "expandDirectory"]) {
    assert.ok(README.includes(`\`${field}\``), `README does not document the adapter field ${field}`);
  }
  assert.doesNotMatch(README, /sessionCwd/, "sessionCwd was removed: the README must not document dead config");
  for (const limit of [/persistent shell/i, /unscanned middle/i, /directory walk/i]) {
    assert.match(README, limit, `README must state the documented limit ${limit}`);
  }
});

// --- 9 - review fixes (2026-10-15: five review findings and one regression on the first commit) ---

const GLOBAL_INSTALL = "pnpm add -g typescript"; // matches install-in-junctioned-worktree
const typedInto = (name, text, cwd) => run(name, { pid: 4242, input: text, timeout_ms: 8000, wait_for_prompt: true }, cwd);

test("review-fix table: each optional field sits on exactly the intended row", () => {
  const rows = Object.fromEntries(adapters().map((a) => [a.id, a]));
  const only = (field, id, value) => {
    assert.deepEqual(rows[id]?.[field], value, `${id}.${field} must be ${JSON.stringify(value)}`);
    for (const other of Object.keys(rows)) if (other !== id) assert.equal(rows[other][field], undefined, `${other} must not carry ${field}`);
  };
  // clientHint: the typed-text row and the four SQL text rows (bare SQL has no client word of its own), all "psql", no other row
  for (const id of ["process-input", ...SQL_ROW_IDS]) assert.equal(rows[id]?.clientHint, "psql", `${id}.clientHint must be "psql"`);
  for (const other of Object.keys(rows)) if (other !== "process-input" && !SQL_ROW_IDS.includes(other)) assert.equal(rows[other].clientHint, undefined, `${other} must not carry clientHint`);
  only("skipWhenTrue", "file-edit", ["dryRun"]);
  only("expandDirectory", "file-move", { from: "source", to: "destination" });
  for (const id of ["process-start", "process-input"]) {
    assert.deepEqual(rows[id]?.exceptRules, ["install-in-junctioned-worktree"], `${id} runs in Desktop Commander's own cwd: exempt from the worktree-install rule only`);
  }
  for (const id of ["terminal-run", "monitor", "file-write", "file-edit", "file-move"]) {
    assert.ok(rows[id], `adapter ${id} is missing`);
    assert.equal(rows[id].exceptRules, undefined, `${id} is judged by every rule`);
  }
});

// R1 - SQL typed into a REPL ----------------------------------------------------------------

test("R1: SQL typed into a running process (a psql REPL) is judged as SQL sent to a client, through both Desktop Commander registrations", () => {
  for (const p of [DC_PLUGIN, DC_CONNECTOR]) {
    const tool = `${p}interact_with_process`;
    for (const sql of ["DROP TABLE leads;", "drop table leads", "TRUNCATE TABLE leads;", "TRUNCATE leads", "DROP SCHEMA public CASCADE;", "BEGIN;\nDROP DATABASE nick;\nCOMMIT;"]) {
      denied(typedInto(tool, sql), "destructive-sql", `${tool} <- ${JSON.stringify(sql)}`);
    }
    for (const text of ["SELECT * FROM leads LIMIT 5;", "echo hello", "git status", "y", "\\dt", 'grep -rn "DROP TABLE" drizzle/', "rg 'TRUNCATE' apps/statenour/prisma/"]) {
      allowed(typedInto(tool, text), `${tool} <- ${JSON.stringify(text)}`);
    }
  }
});

test("R1: the hint is prefixed to typed text only, never to a read-only search (mention is not execution), and only on the row that declares it", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const input = `${DC_PLUGIN}interact_with_process`;
  assert.deepEqual(engine.adaptToolCall(input, { input: "DROP TABLE x;" }, NORMAL, policy).map((c) => c.command), ["psql DROP TABLE x;"]);
  const search = 'grep -rn "DROP TABLE" drizzle/';
  assert.deepEqual(engine.adaptToolCall(input, { input: search }, NORMAL, policy).map((c) => c.command), [search], "a read-only search must stay a read-only search");
  assert.deepEqual(engine.adaptToolCall(`${DC_PLUGIN}start_process`, { command: "DROP TABLE x;" }, NORMAL, policy).map((c) => c.command), ["DROP TABLE x;"], "process-start carries no hint");
});

test("R1 controls: process-start, Bash and Write are unchanged by the hint", () => {
  allowed(run(`${DC_PLUGIN}start_process`, { command: "DROP TABLE leads;", timeout_ms: 5000 }), "start_process has no hint");
  allowed(run("Bash", { command: "DROP TABLE leads;" }), "native Bash has no hint");
  denied(run("Bash", { command: 'psql -c "DROP TABLE leads"' }), "destructive-sql", "native Bash with a client word still denies");
  denied(run(`${DC_PLUGIN}start_process`, { command: 'psql -c "DROP TABLE leads"', timeout_ms: 5000 }), "destructive-sql", "start_process with a client word still denies");
  denied(run("Write", { file_path: ".env.local", content: "x" }), "secret-file-write", "Write control");
});

// R2 - Desktop Commander runs in its own cwd -------------------------------------------------

test("R2: a global install through Desktop Commander from a worktree session exits 0, the sanctioned path (.claude/skills/harness-worktree-setup/SKILL.md)", () => {
  // SKILL.md: "Sanctioned path for a global install: a process runner with a non-worktree cwd (e.g. the Desktop
  // Commander MCP), never a rule edit." Desktop Commander runs processes in ITS cwd, not the Claude session cwd.
  for (const p of [DC_PLUGIN, DC_CONNECTOR]) {
    allowed(run(`${p}start_process`, { command: GLOBAL_INSTALL, timeout_ms: 5000 }, WORKTREE), `${p}start_process global install`);
    allowed(typedInto(`${p}interact_with_process`, GLOBAL_INSTALL, WORKTREE), `${p}interact_with_process global install`);
  }
});

test("R2 controls: Bash, PowerShell, the Terminal MCP and Monitor still deny an install in a worktree; Desktop Commander still denies cwd-free rules", () => {
  denied(run("Bash", { command: GLOBAL_INSTALL }, WORKTREE), "install-in-junctioned-worktree", "Bash");
  denied(run("PowerShell", { command: GLOBAL_INSTALL }, WORKTREE), "install-in-junctioned-worktree", "PowerShell");
  denied(run(TERMINAL, { command: GLOBAL_INSTALL }, WORKTREE), "install-in-junctioned-worktree", "Terminal MCP: its tab starts in the session cwd");
  denied(run("Monitor", { command: GLOBAL_INSTALL, description: "d", timeout_ms: 1000 }, WORKTREE), "install-in-junctioned-worktree", "Monitor: runs in the Bash shell environment");
  for (const p of [DC_PLUGIN, DC_CONNECTOR]) {
    denied(run(`${p}start_process`, { command: "git push origin main", timeout_ms: 5000 }, WORKTREE), "push-to-main", `${p}start_process`);
    denied(typedInto(`${p}interact_with_process`, "git push origin main", WORKTREE), "push-to-main", `${p}interact_with_process`);
    denied(run(`${p}start_process`, { command: "git stash pop", timeout_ms: 5000 }, WORKTREE), "stash-pop", `${p}start_process`);
  }
});

test("R2 documented limit: the hook is stateless, so a persistent shell's cwd across calls is invisible (a pin: it fails the day this is fixed)", () => {
  const fixedHint = "if this now denies, per-process cwd tracking exists: update the README 'Still unguarded' entry and replace this pin";
  const WT_DIR = "C:/Users/nourd/NOURCITY/.claude/worktrees/x";
  allowed(run(`${DC_PLUGIN}start_process`, { command: `cd ${WT_DIR}`, timeout_ms: 5000 }, NORMAL), `call 1: cd into a worktree (${fixedHint})`);
  allowed(typedInto(`${DC_PLUGIN}interact_with_process`, GLOBAL_INSTALL, NORMAL), `call 2: install in that shell (${fixedHint})`);
  allowed(run(`${DC_PLUGIN}start_process`, { command: `cd ${WT_DIR}; ${GLOBAL_INSTALL}`, timeout_ms: 5000 }, NORMAL), `same line (${fixedHint})`);
  allowed(run("Bash", { command: `cd ${WT_DIR}; ${GLOBAL_INSTALL}` }, NORMAL), "native Bash from a primary session has the same blind spot: this is no worse than before the PR");
});

test("R2 narrower fix: Desktop Commander process rows are exempt from the worktree-install rule ONLY; the session-scoped night-shift rules still reach them", () => {
  // install-in-junctioned-worktree is PROCESS-cwd scoped (it protects a worktree's junctioned node_modules) and
  // Desktop Commander runs outside the worktree; the night-shift rules restrict the SESSION wherever its shell runs.
  for (const p of [DC_PLUGIN, DC_CONNECTOR]) {
    for (const cwd of [WORKTREE, NIGHT]) {
      allowed(run(`${p}start_process`, { command: GLOBAL_INSTALL, timeout_ms: 5000 }, cwd), `${p}start_process global install, session cwd ${cwd}`);
      allowed(typedInto(`${p}interact_with_process`, GLOBAL_INSTALL, cwd), `${p}interact_with_process global install, session cwd ${cwd}`);
    }
    denied(run(`${p}start_process`, { command: "gh pr merge 2401 --squash", timeout_ms: 1000 }, NIGHT), "night-shift-no-merge", `${p}start_process in a night-shift session`);
    denied(typedInto(`${p}interact_with_process`, "gh pr merge 2401 --squash", NIGHT), "night-shift-no-merge", `${p}interact_with_process in a night-shift session`);
  }
  // the exemption is not a hole for any other tool
  denied(run(TERMINAL, { command: GLOBAL_INSTALL }, WORKTREE), "install-in-junctioned-worktree", "terminal-run");
  denied(run("Monitor", { command: GLOBAL_INSTALL, description: "d", timeout_ms: 1000 }, WORKTREE), "install-in-junctioned-worktree", "monitor");
});

test("evaluate() honours skipRules for exactly the listed rule ids", () => {
  const base = { toolName: "Bash", command: "git push origin main", cwd: NORMAL, filePath: "" };
  assert.equal(engine.evaluate(base, policy).rule?.id, "push-to-main");
  assert.equal(engine.evaluate({ ...base, skipRules: ["install-in-junctioned-worktree"] }, policy).rule?.id, "push-to-main", "skipping an unrelated rule changes nothing");
  assert.equal(engine.evaluate({ ...base, skipRules: ["push-to-main"] }, policy).denied, false, "the listed rule is skipped");
  assert.equal(engine.evaluate({ ...base, command: "git push --force origin main", skipRules: ["push-to-main"] }, policy).rule?.id, "force-push", "a skip is per rule: the next matching rule still fires");
});

test("exceptRules rides on the judged calls of the rows that declare it, and on no others", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  for (const p of [DC_PLUGIN, DC_CONNECTOR]) {
    assert.deepEqual(engine.adaptToolCall(`${p}start_process`, { command: "x" }, NORMAL, policy)[0].skipRules, ["install-in-junctioned-worktree"]);
    assert.deepEqual(engine.adaptToolCall(`${p}interact_with_process`, { input: "x" }, NORMAL, policy)[0].skipRules, ["install-in-junctioned-worktree"]);
  }
  for (const name of [TERMINAL, "Monitor", `${DC_PLUGIN}write_file`, `${FS}edit_file`, `${DC_PLUGIN}move_file`]) {
    const calls = engine.adaptToolCall(name, { command: "x", path: "x", source: "x", destination: "y" }, NORMAL, policy);
    assert.ok(calls.length >= 1 && calls.every((c) => c.skipRules === undefined), `${name} must not carry an exemption`);
  }
});

test("exceptRules is validated: a malformed list or an unknown or mistyped rule id is reported and the exemption is IGNORED, so the rule applies", () => {
  const sanctioned = (hook) => run(`${DC_PLUGIN}start_process`, { command: GLOBAL_INSTALL, timeout_ms: 5000 }, WORKTREE, hook);
  withTree(null, (hook) => allowed(sanctioned(hook), "control: the real table lets the sanctioned global install through"));
  for (const bad of [["install-in-junctioned-worktre"], ["no-such-rule"], ["install-in-junctioned-worktree", "typo-rule"], "install-in-junctioned-worktree", [], [42], [""]]) {
    withTree((p) => {
      for (const a of p.mcpAdapters ?? []) if (a.exceptRules) a.exceptRules = bad;
    }, (hook) => {
      const r = sanctioned(hook);
      denied(r, "install-in-junctioned-worktree", `exceptRules ${JSON.stringify(bad)}: the rule must apply`);
      assert.match(r.err, /\[agent-os\] pretool MCP adapter problem \(exemption ignored, every rule applies\)/, `exceptRules ${JSON.stringify(bad)} must be reported on stderr`);
    });
  }
});

// R3 - dry-run edits ---------------------------------------------------------------------------

test("R3: filesystem edit_file with dryRun true previews and writes nothing, so it is not judged; only the strict boolean true counts", () => {
  const edit = (extra) => run(`${FS}edit_file`, { path: ".env.local", edits: [{ oldText: "a", newText: "b" }], ...extra });
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  assert.deepEqual(engine.adaptToolCall(`${FS}edit_file`, { path: ".env.local", dryRun: true }, NORMAL, policy), [], "claimed, nothing to judge");
  allowed(edit({ dryRun: true }), "dryRun: true");
  for (const v of [false, "true", 1, null, "yes", [], {}]) denied(edit({ dryRun: v }), "secret-file-write", `dryRun: ${JSON.stringify(v)} is not strictly true`);
  denied(edit({}), "secret-file-write", "dryRun absent");
});

test("R3: dryRun is honoured by edit_file ONLY; no other file tool can use it to slip a write past the hook", () => {
  for (const [name, input] of [
    [`${DC_PLUGIN}write_file`, { path: ".env.local", content: "x", dryRun: true }],
    [`${DC_PLUGIN}edit_block`, { file_path: ".env.local", old_string: "a", new_string: "b", dryRun: true }],
    [`${DC_PLUGIN}write_pdf`, { path: ".env.local", content: "# t", dryRun: true }],
    [`${FS}write_file`, { path: ".env.local", content: "x", dryRun: true }],
    [`${FS}move_file`, { source: "a", destination: ".env.local", dryRun: true }],
  ]) {
    denied(run(name, input), "secret-file-write", `${name} with dryRun true`);
  }
});

// R4 - oversized fields are judged as two slices -----------------------------------------------

test("R4: an oversized field is judged as two slices on their own, so head and tail never combine into a command the field never held", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const half = engine.FIELD_CAP / 2;
  const head = `${"x".repeat(half - 5)} psql`; // the head slice ends with a client word
  const tail = `DROP TABLE leads;${"z".repeat(half - 17)}`; // the tail slice starts with the statement
  assert.equal(head.length, half);
  assert.equal(tail.length, half);
  const field = `${head}${"f".repeat(30000)}${tail}`;
  allowed(run(TERMINAL, { command: field }), "client word ends the head, the statement starts the tail, 30k apart (review R4)");
  denied(run(TERMINAL, { command: `psql -c "DROP TABLE leads" ${"f".repeat(40000)}` }), "destructive-sql", "statement fully inside the head");
  denied(run(TERMINAL, { command: `${"f".repeat(40000)} psql -c "DROP TABLE leads"` }), "destructive-sql", "statement fully inside the tail");
  const calls = engine.adaptToolCall(TERMINAL, { command: field }, NORMAL, policy);
  assert.deepEqual(calls.map((c) => c.via), ["terminal-run.command#head", "terminal-run.command#tail"]);
  assert.ok(calls.every((c) => c.command.length <= half), "each slice is within half the cap");
});

// R5 - directory moves -------------------------------------------------------------------------

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-move-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function touch(p) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
}
// Bulk empty files for the walk tests. Hard links to a few seed files OUTSIDE the directory keep creation cheap
// (4,000 real files made this suite the slowest by far on a filesystem with a scanner); the walk reads names only.
// NTFS allows about 1,000 links per file, so the seeds rotate; any failure falls back to a real file.
function bulkFiles(dir, names) {
  mkdirSync(dir, { recursive: true });
  const seeds = new Map();
  names.forEach((name, i) => {
    const target = join(dir, name);
    const k = Math.floor(i / 800);
    try {
      if (!seeds.has(k)) {
        const seed = join(dirname(dir), `seed-${basename(dir)}-${k}`);
        writeFileSync(seed, "");
        seeds.set(k, seed);
      }
      linkSync(seeds.get(k), target);
    } catch {
      writeFileSync(target, "");
    }
  });
}
const CAP_NOTE = /\[agent-os\] pretool move_file: directory too large to inspect fully, descendants beyond the cap not judged/;

test("R5: moving a DIRECTORY judges the file names below it as if written at the destination (names only), through every move_file registration", () => {
  withTempDir((dir) => {
    touch(join(dir, "holds-env", "app", ".env.local"));
    touch(join(dir, "holds-env", "readme.txt"));
    touch(join(dir, "benign", "a.txt"));
    touch(join(dir, "benign", "sub", "b.md"));
    touch(join(dir, "example", ".env.example"));
    touch(join(dir, "example", "c.txt"));
    for (const p of [DC_PLUGIN, DC_CONNECTOR, FS]) {
      const mv = (source, destination, cwd) => run(`${p}move_file`, { source, destination }, cwd);
      const r = mv(join(dir, "holds-env"), join(dir, "dest-benign"));
      denied(r, "secret-file-write", `${p}move_file: a directory holding .env.local`);
      assert.match(r.err, /Judged through MCP adapter file-move\./);
      denied(mv("holds-env", "dest-benign", dir), "secret-file-write", `${p}move_file: relative source resolved against the session cwd`);
      allowed(mv(join(dir, "benign"), join(dir, "dest-benign")), `${p}move_file: a directory of benign files`);
      allowed(mv(join(dir, "example"), join(dir, "dest-benign")), `${p}move_file: a directory holding .env.example`);
      allowed(mv(join(dir, "does-not-exist"), join(dir, "dest-benign")), `${p}move_file: a nonexistent source`);
      // a plain file move behaves exactly as before
      denied(mv(join(dir, "benign", "a.txt"), join(dir, ".env.local")), "secret-file-write", `${p}move_file: a file moved ONTO .env.local`);
      denied(mv(join(dir, "holds-env", "app", ".env.local"), join(dir, "elsewhere.txt")), "secret-file-write", `${p}move_file: a .env.local file moved away`);
      allowed(mv(join(dir, "benign", "a.txt"), join(dir, "b.txt")), `${p}move_file: a benign file move`);
    }
  });
});

test("R5: an over-cap directory is judged as far as the walk got, with ONE stderr line; descendants beyond the cap are not judged (a pin)", () => {
  withTempDir((dir) => {
    const big = join(dir, "big");
    bulkFiles(big, Array.from({ length: 2005 }, (_, i) => `f${String(i).padStart(4, "0")}.txt`));
    touch(join(big, "zz", ".env.local")); // below the cap: never listed
    const r = run(`${DC_PLUGIN}move_file`, { source: big, destination: join(dir, "dest") });
    allowed(r, "an over-cap directory fails open (if this now denies, the cap was lifted: update the README directory walk limit and this pin)");
    assert.match(r.err, CAP_NOTE, "the cap must be announced on stderr");
    assert.equal(r.err.match(new RegExp(CAP_NOTE.source, "g")).length, 1, "exactly one stderr line");
  });
});

test("R5: a 2000-entry directory is walked completely, far inside the hook timeout", (t) => {
  withTempDir((dir) => {
    const full = join(dir, "full");
    bulkFiles(full, Array.from({ length: 1999 }, (_, i) => `g${String(i).padStart(4, "0")}.txt`));
    touch(join(full, ".env.local")); // entry 2000: inside the cap
    const r = run(`${DC_PLUGIN}move_file`, { source: full, destination: join(dir, "dest") });
    denied(r, "secret-file-write", "a 2000-entry directory holding .env.local");
    assert.doesNotMatch(r.err, /too large to inspect/);
    t.diagnostic(`hook wall time on a 2000-entry directory move: ${r.ms} ms`);
    assert.ok(r.ms < 5000, `a 2000-entry walk took ${r.ms} ms; the hook timeout is 10 s and a timeout fails OPEN`);
  });
});

test("R5: the walk stops at depth 6 (documented) and never follows a symlink", () => {
  withTempDir((dir) => {
    const mv = (source) => run(`${DC_PLUGIN}move_file`, { source, destination: join(dir, "dest") });
    touch(join(dir, "d6", "a", "b", "c", "d", "e", ".env.local")); // the file sits at depth 6
    denied(mv(join(dir, "d6")), "secret-file-write", "a file at depth 6 is judged");
    touch(join(dir, "d7", "a", "b", "c", "d", "e", "f", ".env.local")); // depth 7
    const deep = mv(join(dir, "d7"));
    allowed(deep, "a file at depth 7 is beyond the walk (if this now denies, the depth cap moved: update the README and this pin)");
    assert.match(deep.err, CAP_NOTE);
    // symlinks and junctions: names only, never followed
    touch(join(dir, "real", ".env.local"));
    mkdirSync(join(dir, "linked"));
    touch(join(dir, "linked", "ok.txt"));
    let linked = true;
    try {
      symlinkSync(join(dir, "real"), join(dir, "linked", "link"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      linked = false; // no permission to create links here: the follow check cannot run
    }
    if (linked) allowed(mv(join(dir, "linked")), "a symlinked directory below the source is not followed");
  });
});

// --- 10 - SQL text tools (job 2026-10-15-guard-sql-lease-infra, commit 1) -------------------------
//
// THE GAP. Neon run_sql, Prisma execute_sql_query and their relatives receive BARE SQL, and destructive-sql needs a
// DB client word on the line, so those tools were never judged (listed as unguarded on 2026-10-15). The fix is table
// rows with a psql clientHint plus the matcher suffixes. Each block is a way that could be a silent instrument: the
// rows (every registration), the reader of ARRAY fields (run_sql_transaction), the registration, and the limits.

const DESTRUCTIVE_SQL = [
  "DROP TABLE leads", "drop table leads;", "TRUNCATE TABLE leads", "TRUNCATE leads", "DROP SCHEMA public CASCADE", "BEGIN;\nDROP DATABASE nick;\nCOMMIT;",
  // the 870-row class (extended 2026-10-15): a DELETE or UPDATE with no WHERE in its own statement, and ALTER TABLE ... DROP
  "DELETE FROM leads", "delete from public.leads;", 'DELETE FROM "public"."leads"', "DELETE\nFROM ONLY leads", "DELETE FROM leads RETURNING *",
  "UPDATE leads SET status = 'x'", "update only public.leads l set status = 'x'", "UPDATE leads\nSET a = 1",
  "WITH d AS (DELETE FROM leads RETURNING *) SELECT count(*) FROM d", "DELETE FROM a WHERE x; DELETE FROM b;",
  "ALTER TABLE leads DROP COLUMN note", "alter table leads drop constraint c", "DROP INDEX idx_leads_name", "DROP MATERIALIZED VIEW mv",
];
const BENIGN_SQL = [
  "SELECT 1", "SELECT * FROM leads LIMIT 5", "INSERT INTO leads (name) VALUES ('Ann')", "EXPLAIN SELECT * FROM leads", "CREATE INDEX idx_leads_name ON leads (name)",
  "DELETE FROM leads WHERE id = 1", "delete from leads where id = 1", "DELETE FROM t USING u WHERE t.id = u.id", "UPDATE leads SET status = 'x' WHERE id = 1",
  "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = excluded.a", "SELECT * FROM leads WHERE note = 'x'", "SELECT update_time FROM leads",
  "CREATE TABLE a (b int REFERENCES b(id) ON UPDATE CASCADE ON DELETE SET NULL, c int REFERENCES c(id) ON UPDATE CASCADE ON DELETE SET NULL)",
];
const DROP_KINDS = ["EXTENSION vector", "INDEX i", "VIEW v", "MATERIALIZED VIEW m", "FUNCTION f()", "PROCEDURE p()", "TYPE t", "ROLE r", "USER u", "SEQUENCE s",
  "TRIGGER t ON leads", "POLICY p ON leads", "OWNED BY app", "COLUMN c", "CONSTRAINT c"];
const SQL_RUN = SQL_SHAPES[0];
const SQL_TX = SQL_SHAPES.find((s) => s.array);

test("SQL rows: every real registration and the synthetic ones are claimed by exactly their own row; look-alikes and unjudged tools are not claimed", () => {
  assert.equal(SQL_SHAPES.length, 8, "4 Neon tools, and 2 Prisma tools on each of the 2 Prisma registrations");
  for (const id of SQL_ROW_IDS) assert.ok(adapters().some((a) => a.id === id), `row ${id} is missing from policy.json mcpAdapters`);
  for (const [name, row] of [...SQL_SHAPES.map((s) => [s.name, s.row]), ...SQL_SYNTHETIC]) {
    const claimants = adapters().filter((b) => new RegExp(b.toolPattern).test(name)).map((b) => b.id);
    assert.deepEqual(claimants, [row], `${name} must be claimed by exactly ${row}, got [${claimants}]`);
  }
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const everyField = { sql: "DROP TABLE x", query: "DROP TABLE x", migration_sql: "DROP TABLE x", sql_statements: ["DROP TABLE x"] };
  for (const name of [...SQL_UNJUDGED, ...TRICKY.filter((n) => /sql|migration/.test(n))]) {
    assert.equal(engine.adaptToolCall(name, everyField, NORMAL, policy), null, `${name} must not be claimed`);
  }
});

for (const shape of SQL_SHAPES) {
  test(`e2e SQL tool ${shape.name.replace(/^mcp__/, "")}: destructive SQL DENIED with the rule id, reads and benign writes ALLOWED`, () => {
    for (const sql of DESTRUCTIVE_SQL) {
      const r = run(shape.name, sqlInput(shape, sql));
      denied(r, "destructive-sql", `${shape.name} <- ${JSON.stringify(sql)}`);
      const last = r.err.trimEnd().split("\n").at(-1);
      assert.ok(last.startsWith(`Judged through MCP adapter ${shape.row}.${shape.field}`) && last.endsWith(` on tool ${shape.name}.`), `the Judged-through text must be the LAST line, got: ${last}`);
    }
    for (const sql of BENIGN_SQL) allowed(run(shape.name, sqlInput(shape, sql)), `${shape.name} <- ${JSON.stringify(sql)}`);
  });
}

test("array field: each element is judged on its own, so one bad element denies and names its index; an all-benign list and an empty list pass", () => {
  const second = run(SQL_TX.name, SQL_TX.input(["SELECT 1", "DROP TABLE leads"]));
  denied(second, "destructive-sql", "bad element at index 1");
  assert.match(second.err, /Judged through MCP adapter neon-sql-transaction\.sql_statements\[1\] on tool /);
  const first = run(SQL_TX.name, SQL_TX.input(["TRUNCATE leads", "SELECT 1"]));
  denied(first, "destructive-sql", "bad element at index 0");
  assert.match(first.err, /neon-sql-transaction\.sql_statements\[0\] on tool /);
  allowed(run(SQL_TX.name, SQL_TX.input(["SELECT 1", "SELECT 2", "INSERT INTO leads (name) VALUES ('Ann')"])), "all benign");
  allowed(run(SQL_TX.name, SQL_TX.input([])), "empty list");
});

test("array field: elements are never joined, non-string elements are ignored without a hook error, and the index is the position in the original array", () => {
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const split = engine.adaptToolCall(SQL_TX.name, { sql_statements: ["DROP", "TABLE leads"] }, NORMAL, policy);
  assert.deepEqual(split.map((c) => c.command), ["psql DROP", "psql TABLE leads"], "each element is its own judged text, hint included, nothing joined");
  allowed(run(SQL_TX.name, SQL_TX.input(["DROP", "TABLE leads"])), "a statement split across two elements was never one statement");
  for (const weird of [[null, 5, true, { sql: "DROP TABLE x" }, ["DROP TABLE y"], "SELECT 1"], null, 7, true, {}, [[["DROP TABLE x"]]], [undefined]]) {
    allowed(run(SQL_TX.name, { sql_statements: weird }), `sql_statements = ${JSON.stringify(weird)}`);
  }
  const mixed = engine.adaptToolCall(SQL_TX.name, { sql_statements: [null, "SELECT 1", 5, "SELECT 2"] }, NORMAL, policy);
  assert.deepEqual(mixed.map((c) => c.via), ["neon-sql-transaction.sql_statements[1]", "neon-sql-transaction.sql_statements[3]"]);
});

test("array field: at most ARRAY_MAX elements are judged and ONE stderr line says the rest were not (a pin: it fails the day the cap moves)", () => {
  assert.equal(typeof engine.ARRAY_MAX, "number", "policy.mjs must export ARRAY_MAX");
  const CAP = engine.ARRAY_MAX;
  const list = (n, badAt) => Array.from({ length: n }, (_, i) => (i === badAt ? "DROP TABLE leads" : "SELECT 1"));
  denied(run(SQL_TX.name, SQL_TX.input(list(CAP + 50, CAP - 1))), "destructive-sql", "the last element inside the cap");
  const over = run(SQL_TX.name, SQL_TX.input(list(CAP + 50, CAP)));
  allowed(over, "the first element beyond the cap is not judged (if this now denies the cap moved: update the README and this pin)");
  assert.equal(over.err.match(/array field longer than the cap/g)?.length, 1, "exactly one stderr line");
  assert.equal(engine.adaptToolCall(SQL_TX.name, { sql_statements: list(CAP + 50, -1) }, NORMAL, policy).length, CAP);
  const exact = run(SQL_TX.name, SQL_TX.input(list(CAP, -1)));
  allowed(exact, "exactly ARRAY_MAX elements");
  assert.doesNotMatch(exact.err, /longer than the cap/, "no stderr line at the cap itself");
});

test("array field: a string given for an array field is judged as a string; an element over FIELD_CAP is judged as head and tail slices, never joined", () => {
  denied(run(SQL_TX.name, { sql_statements: "DROP TABLE leads" }), "destructive-sql", "a bare string in the array field");
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  const half = engine.FIELD_CAP / 2;
  const straddle = `${"x".repeat(half - 4)}DROP${"f".repeat(30000)}TABLE leads${"z".repeat(half - 11)}`; // DROP ends the head, TABLE starts the tail
  const calls = engine.adaptToolCall(SQL_TX.name, { sql_statements: ["SELECT 1", straddle] }, NORMAL, policy);
  assert.deepEqual(calls.map((c) => c.via), ["neon-sql-transaction.sql_statements[0]", "neon-sql-transaction.sql_statements[1]#head", "neon-sql-transaction.sql_statements[1]#tail"]);
  allowed(run(SQL_TX.name, SQL_TX.input(["SELECT 1", straddle])), "a statement that straddles the unscanned middle of one element is not judged (documented slip window)");
  const tail = run(SQL_TX.name, SQL_TX.input([`${"f".repeat(40000)} DROP TABLE leads`]));
  denied(tail, "destructive-sql", "statement fully inside the tail slice of an element");
  assert.match(tail.err, /neon-sql-transaction\.sql_statements\[0\]#tail on tool /);
});

test("SQL: a 25,000-character benign field and 200 elements of 20,000 characters pass fast (a hook timeout fails OPEN)", (t) => {
  const field = `SELECT 1 ${"UNION SELECT 2 ".repeat(1667)}`;
  assert.ok(field.length > 25000);
  const one = run(SQL_RUN.name, SQL_RUN.input(field));
  allowed(one, "25,000 benign characters");
  const element = `SELECT 1 ${"UNION SELECT 2 ".repeat(1332)}`;
  assert.ok(element.length <= engine.FIELD_CAP);
  const many = run(SQL_TX.name, SQL_TX.input(Array.from({ length: engine.ARRAY_MAX }, () => element)));
  allowed(many, "ARRAY_MAX elements of FIELD_CAP characters each");
  t.diagnostic(`hook wall time including node start: 25k field ${one.ms} ms, ${engine.ARRAY_MAX} x ${element.length} chars ${many.ms} ms`);
  for (const r of [one, many]) {
    assert.equal(r.signal, null, "the hook must not run into its own timeout");
    assert.ok(r.ms < 6000, `took ${r.ms} ms; the hook timeout is 10 s and a timeout fails OPEN`);
  }
});

test("destructive-sql is linear in the text length: 60,000 benign characters are judged fast, and the same pattern without its ^ anchor is not (positive control)", () => {
  // The array reader multiplies judgments (ARRAY_MAX elements of FIELD_CAP characters each), which is only affordable
  // because the rule is anchored: unanchored, the engine retries the whole lookahead from every start position.
  // Measured 2026-10-15: 200 elements of 20,000 characters ran into the 30 s test timeout on the unanchored form.
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  assert.ok(rule?.pattern.startsWith("^"), "the shipped pattern must be anchored");
  const text = `${"SELECT x FROM t ".repeat(3750)}psql`;
  const time = (source) => {
    const re = new RegExp(source, rule.flags);
    const t0 = process.hrtime.bigint();
    const hit = re.test(text);
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, hit };
  };
  const shipped = time(rule.pattern);
  assert.equal(shipped.hit, false, "benign text must not match");
  assert.ok(shipped.ms < 500, `the shipped pattern took ${shipped.ms} ms on 60,000 benign characters`);
  const unanchored = time(rule.pattern.replace(/^\^/, ""));
  assert.equal(unanchored.hit, false);
  assert.ok(unanchored.ms > 500, `positive control: without its ^ the pattern took only ${unanchored.ms} ms, so this canary cannot tell an anchored rule from an unanchored one`);
});

test("SQL: prepare_database_migration (a temporary branch) and the other tools of these servers are NOT judged by text", () => {
  for (const name of SQL_UNJUDGED) {
    allowed(run(name, { migration_sql: "DROP TABLE leads", sql: "DROP TABLE leads", query: "DROP TABLE leads", suggested_sql_statements: ["DROP TABLE leads"] }), name);
  }
});

test("SQL documented limits, pinned: a hinted row also denies SQL words inside a string literal, an apply_changes false discard is judged too, explain with analyze is judged like run_sql", () => {
  denied(run(SQL_RUN.name, SQL_RUN.input("INSERT INTO notes (body) VALUES ('please drop table x')")), "destructive-sql", "DROP TABLE inside a string literal (accepted: the tool cannot tell a mention from an execution)");
  const apply = SQL_SHAPES.find((s) => leaf(s.name) === "complete_database_migration");
  denied(run(apply.name, { ...apply.input("DROP TABLE leads"), apply_changes: false }), "destructive-sql", "a DISCARD with destructive SQL (if this now allows, a skipWhenFalse exists: update the README and this pin)");
  const explain = SQL_SHAPES.find((s) => leaf(s.name) === "explain_sql_statement");
  denied(run(explain.name, { sql: "DROP TABLE leads", analyze: true }), "destructive-sql", "explain_sql_statement with analyze:true executes the statement");
});

// The DENY probes of the DELETE / UPDATE / ALTER TABLE ... DROP / DROP-kind arms of destructive-sql. They are NOT policy.json
// denyExamples: docs/agent-audit/CONTROL-CANARY-COVERAGE.md pins that total (coverage-doc.test.mjs) and is outside the platform
// lane, so they live here and are checked the way a denyExample is: denied BY THIS RULE, through every command adapter, and
// (acceptance probes below) through the real hook. Move them into policy.json with that doc's number in one change.
const DESTRUCTIVE_PROBES = [
  'psql -c "DELETE FROM leads"', "mysql -e 'delete from leads;'", 'psql -c "DELETE FROM public.leads"', `psql -c 'DELETE FROM "public"."leads"'`,
  'psql -c "DELETE\nFROM leads"', 'psql -c "DELETE FROM ONLY leads"', 'psql -c "DELETE FROM leads RETURNING *"', 'mysql -e "DELETE LOW_PRIORITY FROM leads"',
  'psql -c "WITH d AS (DELETE FROM leads RETURNING *) SELECT count(*) FROM d"', 'psql -c "DELETE FROM a WHERE x; DELETE FROM b;"',
  "railway run -- psql -c 'DELETE FROM leads'", 'Invoke-Sqlcmd -Query "DELETE FROM leads"',
  `psql -c "UPDATE leads SET status = 'x'"`, `psql -c "UPDATE ONLY leads SET status = 'x'"`, `psql -c "update public.leads l set status = 'x'"`,
  `psql -c 'UPDATE "public"."leads" SET status = 1'`, 'psql -c "UPDATE leads\nSET a = 1"', 'mysql -e "UPDATE IGNORE leads SET a = 1"',
  'psql -c "BEGIN; UPDATE leads SET a = 1; COMMIT;"', 'psql -c "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = excluded.a; UPDATE t SET b = 1"',
  'psql -c "ALTER TABLE leads DROP COLUMN note"', 'psql -c "alter table leads drop constraint c"', 'psql -c "ALTER TABLE IF EXISTS ONLY public.leads DROP COLUMN IF EXISTS note"',
  ...DROP_KINDS.map((k) => `psql -c "DROP ${k}"`), 'psql -c "drop materialized\nview mv"',
];

test("destructive-sql deny probes: each is denied BY THIS RULE as native Bash and PowerShell, and through every command adapter (in process)", () => {
  assert.ok(DESTRUCTIVE_PROBES.length >= 38, "the probe list is the proof surface for the extended arms");
  const rowsAsBash = adapters().filter((a) => a.as === "Bash");
  assert.ok(rowsAsBash.length >= 8, "4 runner rows and 4 SQL rows (a loop over nothing is a silent green)");
  for (const command of DESTRUCTIVE_PROBES) {
    for (const toolName of ["Bash", "PowerShell"]) {
      const res = engine.evaluate({ toolName, command, cwd: NORMAL, filePath: "" }, policy);
      assert.equal(res.rule?.id, "destructive-sql", `${toolName}: ${JSON.stringify(command)} was denied by '${res.rule?.id}', not destructive-sql`);
    }
    for (const a of rowsAsBash) {
      for (const field of a.commandFields) {
        const res = judge(a.exampleTools[0], { [field]: command }, NORMAL);
        assert.equal(res.rule?.id, "destructive-sql", `${a.id}.${field}: ${JSON.stringify(command)} was denied by '${res.rule?.id}', not destructive-sql`);
      }
    }
  }
});

test("SQL: the whole probe set, every DROP kind and the benign set are judged the same through all 8 registrations (in process)", () => {
  for (const shape of SQL_SHAPES) {
    for (const sql of DESTRUCTIVE_SQL) assert.equal(judge(shape.name, sqlInput(shape, sql), NORMAL).rule?.id, "destructive-sql", `${shape.name} should DENY ${JSON.stringify(sql)}`);
    for (const kind of DROP_KINDS) assert.equal(judge(shape.name, sqlInput(shape, `DROP ${kind}`), NORMAL).rule?.id, "destructive-sql", `${shape.name} should DENY DROP ${kind}`);
    for (const sql of BENIGN_SQL) assert.equal(judge(shape.name, sqlInput(shape, sql), NORMAL).denied, false, `${shape.name} should ALLOW ${JSON.stringify(sql)}`);
  }
});

test("acceptance probes through the real hook: exit code AND rule id (job 2026-10-15-guard-sql-lease-infra)", () => {
  const shape = (l, prefix) => SQL_SHAPES.find((s) => leaf(s.name) === l && (!prefix || s.name.startsWith(prefix)));
  const runSql = shape("run_sql"), tx = shape("run_sql_transaction"), apply = shape("complete_database_migration"), explain = shape("explain_sql_statement");
  const prismaQuery = shape("execute_sql_query", PRISMA_CONNECTOR);
  denied(run(runSql.name, { sql: "DROP TABLE leads" }), "destructive-sql", "Neon run_sql DROP TABLE");
  denied(run(prismaQuery.name, { query: "TRUNCATE TABLE leads" }), "destructive-sql", "Prisma execute_sql_query TRUNCATE");
  denied(run(tx.name, { sql_statements: ["SELECT 1", "DELETE FROM leads"] }), "destructive-sql", "run_sql_transaction with a bare DELETE");
  for (const sql of ["DELETE FROM leads WHERE id = 1", "SELECT * FROM leads WHERE note = 'x'", "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = excluded.a", "UPDATE leads SET status = 'x' WHERE id = 1"]) {
    allowed(run(runSql.name, { sql }), `run_sql ${sql}`);
  }
  denied(run(runSql.name, { sql: "UPDATE leads SET status = 'x'" }), "destructive-sql", "UPDATE with no WHERE");
  denied(run(apply.name, apply.input("ALTER TABLE t DROP COLUMN c")), "destructive-sql", "complete_database_migration applies to the parent branch");
  allowed(run(`${NEON}prepare_database_migration`, { migration_sql: "ALTER TABLE t DROP COLUMN c" }), "prepare_database_migration runs on a temporary branch");
  denied(run(explain.name, { sql: "DROP TABLE x" }), "destructive-sql", "explain_sql_statement");
  denied(run("Bash", { command: 'psql -c "DELETE FROM leads"' }), "destructive-sql", "native Bash psql DELETE with no WHERE");
  denied(run("PowerShell", { command: 'Invoke-Sqlcmd -Query "DELETE FROM leads"' }), "destructive-sql", "native PowerShell Invoke-Sqlcmd");
  for (const command of ['grep -rn "DELETE FROM" drizzle/', "rg 'DELETE FROM' apps/", 'git log --grep "UPDATE leads SET" --oneline', 'git commit -m "docs: psql DELETE FROM leads is denied"']) {
    allowed(run("Bash", { command }), `mention is not execution: ${command}`);
  }
});

test("destructive-sql documented limits, pinned (each fails the day it is fixed: update the README 'SQL limits' and this pin)", () => {
  const denies = (sql) => judge(SQL_RUN.name, SQL_RUN.input(sql), NORMAL).denied;
  // Not goals, they pass: any WHERE in the statement counts, a keyword split by a comment is not seen, MySQL multi-table forms are not parsed
  for (const sql of [
    "DELETE FROM leads WHERE true", "DELETE FROM leads WHERE 1 = 1", "DELETE FROM leads -- WHERE id = 1", "UPDATE leads SET note = 'where'", "DELETE/**/FROM leads",
    "WITH d AS (DELETE FROM leads RETURNING id) SELECT * FROM u WHERE u.id IN (SELECT id FROM d)",
    "DELETE t1 FROM t1 JOIN t2 ON t1.id = t2.id", "UPDATE a JOIN b ON a.id = b.a_id SET a.x = 1",
  ]) assert.equal(denies(sql), false, `not a goal, so it passes: ${JSON.stringify(sql)}`);
  // Accepted false positives, they deny: the safe direction, one line to ask the operator
  for (const sql of [
    "ALTER TABLE leads ALTER COLUMN note DROP NOT NULL", "UPDATE leads SET a = 1 ORDER BY id LIMIT 5", "UPDATE t SET a = 'x;y' WHERE id = 1",
    "INSERT INTO notes (body) VALUES ('please delete from the schedule')",
  ]) assert.equal(denies(sql), true, `accepted false positive, so it denies: ${JSON.stringify(sql)}`);
});

test("registration: the configured command string, run VERBATIM, denies destructive SQL through a SQL tool and allows a read (guard-red-team rule 5)", () => {
  const group = groupsFor(settings, SQL_RUN.name).find(runsPretool);
  assert.ok(group, `no group routes ${SQL_RUN.name}`);
  const command = commandsOf(group).find((c) => /pretool\.mjs/.test(c));
  const env = { ...ENV, CLAUDE_PROJECT_DIR: ROOT };
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const go = (input) => spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify(input), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  const bad = go({ tool_name: SQL_RUN.name, tool_input: SQL_RUN.input("DROP TABLE leads"), cwd: NORMAL });
  assert.equal(bad.status, 2, `expected a deny through the configured command, got ${bad.status}\n${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /BLOCKED by repo policy: destructive-sql/);
  const txBad = go({ tool_name: SQL_TX.name, tool_input: SQL_TX.input(["SELECT 1", "DROP TABLE leads"]), cwd: NORMAL });
  assert.equal(txBad.status, 2, `array field through the configured command: ${txBad.status}\n${txBad.stdout}${txBad.stderr}`);
  const ok = go({ tool_name: SQL_RUN.name, tool_input: SQL_RUN.input("SELECT 1"), cwd: NORMAL });
  assert.equal(ok.status, 0, `a harmless query was not allowed (exit ${ok.status})\n${ok.stdout}${ok.stderr}`);
});

const PRE_SQL_MATCHER = "^(?:Monitor|mcp__.+__(?:run_in_terminal|start_process|interact_with_process|write_file|edit_file|edit_block|write_pdf|move_file))$";

test("BREAKS: the matcher as it stood before the SQL suffixes routes none of the SQL tools (the registration canary would fail)", () => {
  const broken = structuredClone(settings);
  const group = broken.hooks.PreToolUse.find((g) => runsPretool(g) && g.matcher !== NATIVE_MATCHER);
  assert.ok(group, "the MCP group exists");
  group.matcher = PRE_SQL_MATCHER;
  for (const s of SQL_SHAPES) {
    assert.ok(groupsFor(settings, s.name).some(runsPretool), `control: the real registration routes ${s.name}`);
    assert.ok(!groupsFor(broken, s.name).some(runsPretool), `the old matcher must not route ${s.name}, or the registration canaries prove nothing`);
  }
  assert.ok(groupsFor(broken, TERMINAL).some(runsPretool), "control: the old matcher still routes the runners");
});

test("BREAKS: no SQL rows, the wrong field or no clientHint lets destructive SQL through; the unbroken copy and native Bash still deny", () => {
  const one = (hook) => run(SQL_RUN.name, SQL_RUN.input("DROP TABLE leads"), NORMAL, hook);
  const tx = (hook) => run(SQL_TX.name, SQL_TX.input(["SELECT 1", "DROP TABLE leads"]), NORMAL, hook);
  withTree(null, (hook) => {
    denied(one(hook), "destructive-sql", "unbroken copy, string field");
    denied(tx(hook), "destructive-sql", "unbroken copy, array field");
  });
  withTree((p) => { p.mcpAdapters = p.mcpAdapters.filter((a) => !SQL_ROW_IDS.includes(a.id)); }, (hook) => {
    allowed(one(hook), "no SQL rows");
    allowed(tx(hook), "no SQL rows, array field");
    denied(run("Bash", { command: 'psql -c "DROP TABLE leads"' }, NORMAL, hook), "destructive-sql", "native Bash in the same tree");
  });
  withTree((p) => { for (const a of p.mcpAdapters) if (SQL_ROW_IDS.includes(a.id)) a.commandFields = ["nope"]; }, (hook) => allowed(one(hook), "rows read the wrong field"));
  withTree((p) => { for (const a of p.mcpAdapters) if (SQL_ROW_IDS.includes(a.id)) delete a.clientHint; }, (hook) => allowed(one(hook), "no clientHint: bare SQL has no client word"));
});

test("BREAKS: without the array reader a bad element inside sql_statements passes, while a string field still denies", () => {
  withTree(null, (hook) => {
    allowed(run(SQL_TX.name, SQL_TX.input(["SELECT 1", "DROP TABLE leads"]), NORMAL, hook), "array reader removed from the copy of policy.mjs");
    denied(run(SQL_RUN.name, SQL_RUN.input("DROP TABLE leads"), NORMAL, hook), "destructive-sql", "the string field path is untouched");
  }, (src) => src.replace("if (Array.isArray(v)) return arraySlices(v, report);", "if (false) return [];"));
});
