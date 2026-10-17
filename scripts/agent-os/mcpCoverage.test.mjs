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
import { spawn, spawnSync } from "node:child_process";
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
// This file tests the runner, file and SQL rows. Two SQL tools (Neon complete_database_migration, Prisma execute_prisma_postgres_schema_update) are
// ALSO denied by name (rule infra-mutation-tool, which has no override), so a benign statement through them is denied by that rule. Where this file
// needs the SQL rows alone it skips that rule in process (judge) or runs a hook copy without the name row (the e2e SQL arm); mcpInfraDeny.test.mjs
// proves the name rule itself and that both rows judge those two tools.
const INFRA_RULE_ID = "infra-mutation-tool";
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
  // complete_query_tuning is no longer here: it is denied BY NAME now (a Neon leaf of infra-mutation-tool), so it is claimed and routed
  `${NEON}prepare_database_migration`, `${NEON}prepare_query_tuning`, `${NEON}get_connection_string`,
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

function run(tool_name, tool_input, cwd = NORMAL, hook = HOOK, killMs = 30000) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name, tool_input, cwd }),
    env: ENV,
    encoding: "utf8",
    timeout: killMs,
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
    // the infra name rule is judged in mcpInfraDeny.test.mjs; here it is skipped exactly as the override skips it in the hook, so the two SQL tools it also denies are judged by their SQL rows
    const res = engine.evaluate({ ...call, skipRules: [...(call.skipRules ?? []), INFRA_RULE_ID] }, pol);
    if (res.denied) return res;
  }
  return { denied: false };
}

const cwdFor = (rule) => rule.cwdExample ?? (rule.onlyWhenCwdMatches ? WORKTREE : NORMAL);
const adapters = () => policy.mcpAdapters ?? [];
// Rows that judge a tool's INPUT FIELDS. The infra-name row (nameAsText) judges the tool NAME and has no field: its canaries are in mcpInfraDeny.test.mjs.
const fieldAdapters = () => adapters().filter((a) => !a.nameAsText);
// A denyExample whose denial rests on a SHELL boundary: a statement ended by `&&` or a pipe, or by a second -c/-Query flag. A rawText (SQL) row has no shell, so it does not judge these.
const SHELL_BOUNDARY_EXAMPLE = /&&|\s\|\s|\s-(?:query|[A-Za-z0-9]*[cefq])\b[\s\S]*\s-(?:query|[A-Za-z0-9]*[cefq])\b/i;
// infra-mutation-tool is excluded: its examples are TOOL NAMES, judged through the name row (mcpInfraDeny.test.mjs), not command text for a runner.
const bashRules = policy.rules.filter((r) => r.id !== INFRA_RULE_ID && r.pattern && (Array.isArray(r.tools) ? r.tools.includes("Bash") : true));
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
    if (a.nameAsText === undefined) {
      assert.ok(Array.isArray(fields) && fields.length >= 1 && fields.every((f) => typeof f === "string" && f), `${a.id}: needs a non-empty list of field names`);
      assert.equal(other, undefined, `${a.id}: a Bash adapter reads commandFields only, a Write adapter pathFields only`);
    } else {
      // the one name row (2026-10-15, job infra-deny-by-name): it judges the tool NAME, so it has no field list; mcpInfraDeny.test.mjs pins it in full
      assert.equal(a.nameAsText, true, `${a.id}: nameAsText is the strict boolean true or absent`);
      assert.equal(a.as, "Bash", `${a.id}: a name row hands the name to Bash rules`);
      assert.deepEqual(a.onlyRules, [INFRA_RULE_ID], `${a.id}: a name row is judged by ${INFRA_RULE_ID} alone`);
      assert.equal(a.commandFields ?? a.pathFields, undefined, `${a.id}: a name row reads no input field`);
    }
    assert.ok(a.cwdField === undefined || (typeof a.cwdField === "string" && a.cwdField), `${a.id}: cwdField must be a field name`);
    assert.ok(Array.isArray(a.exampleTools) && a.exampleTools.length >= 1, `${a.id}: needs >=1 exampleTools (the canaries iterate them)`);
    for (const n of NATIVE) assert.ok(!new RegExp(a.toolPattern).test(n), `${a.id}: must not claim the native tool ${n}`);
    // optional fields (review fixes 2026-10-15): strict, independent shape checks
    if (a.clientHint !== undefined) assert.ok(a.as === "Bash" && typeof a.clientHint === "string" && a.clientHint, `${a.id}: clientHint is a non-empty string on a Bash row`);
    // no dead or mistyped config: every key of a row is one the code reads (a stray key is silently ignored)
    for (const key of Object.keys(a)) {
      assert.ok(["id", "toolPattern", "as", "commandFields", "pathFields", "cwdField", "exceptRules", "onlyRules", "rawText", "nameAsText", "clientHint", "skipWhenTrue", "expandDirectory", "exampleTools", "why"].includes(key),
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
      // the name row may CO-claim the two SQL tools that are also denied by name (complete_database_migration, execute_prisma_postgres_schema_update);
      // a field row's example must still be claimed by exactly one FIELD row, and the name row's own examples by the name row alone
      const claimants = (a.nameAsText ? adapters() : fieldAdapters()).filter((b) => new RegExp(b.toolPattern).test(tool)).map((b) => b.id);
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
  const cmdAdapters = fieldAdapters().filter((a) => a.as === "Bash");
  assert.ok(cmdAdapters.length >= 4, "expected the command adapters");
  let checked = 0;
  for (const a of cmdAdapters) {
    for (const tool of a.exampleTools) {
      for (const field of a.commandFields) {
        for (const rule of bashRules) {
          // a row is exempt from exactly the rules in its exceptRules, and judged by ONLY the rules in its onlyRules; both have their own canaries
          if (a.exceptRules?.includes(rule.id)) continue;
          if (a.onlyRules && !a.onlyRules.includes(rule.id)) continue;
          for (const sample of rule.denyExamples) {
            // a rawText row reads SQL, where `&&`, `|` and a second -c are operators or text, not the end of a shell command (the SQL door canary pins that)
            if (a.rawText && SHELL_BOUNDARY_EXAMPLE.test(sample)) continue;
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
  assert.ok(fieldAdapters().filter((x) => x.as === "Bash").length >= 4, "expected the command adapters (a loop over nothing is a silent green)");
  for (const a of fieldAdapters().filter((x) => x.as === "Bash")) {
    for (const tool of a.exampleTools) {
      for (const field of a.commandFields) {
        for (const rule of bashRules) {
          for (const sample of rule.allowExamples) {
            // a rawText row reads SQL, not a shell command: a shell-mention form (a commit message, a read-only search) is not what it judges
            if (a.rawText && engine.preprocessCommand(sample) !== sample) continue;
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

// What runs for a tool name, in settings order: "pretool" judges the command or path, "lease-check" is the Session Authority tripwire.
// stuck-watch.mjs (2026-10-16 loop watchdog) observes every tool (matcher "") and judges repeats, not names; this pins
// the guard routing only. Its own canaries: stuck-watch.test.mjs and hookCommand.test.mjs.
const hooksFor = (s, toolName) =>
  groupsFor(s, toolName).flatMap((g) => commandsOf(g).map((c) => c.match(/([\w-]+)\.mjs/)?.[1])).filter((h) => h !== "stuck-watch");
const LEASE_TOOLS = [...new Set([...COMMAND_SHAPES.map((s) => s.name), ...FILE_SHAPES.map((s) => s.name)])]; // runners and writers, never SQL
const runsLease = (g) => commandsOf(g).some((c) => /scripts\/agent-os\/lease-check\.mjs/.test(c));
const leaseGroups = (s) => preGroups(s).filter((g) => runsLease(g) && g.matcher !== NATIVE_MATCHER);

/** Every way the PreToolUse registration of the two hooks is wrong, as readable lines. [] means right. */
function routingProblems(s) {
  const problems = [];
  const expect = (name, want) => {
    const got = hooksFor(s, name);
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...want].sort())) problems.push(`${name}: runs [${got}], expected [${want}]`);
  };
  for (const name of NATIVE) expect(name, ["pretool", "lease-check"]);
  for (const name of LEASE_TOOLS) expect(name, ["pretool", "lease-check"]);
  for (const shape of SQL_SHAPES) expect(shape.name, ["pretool"]);
  for (const name of [...NOT_ROUTED, ...TRICKY]) expect(name, []);
  return problems;
}

test("registration: runners and writers run pretool AND lease-check, SQL tools pretool only, native tools their original pair (2026-10-15)", () => {
  const original = preGroups(settings).find((g) => g.matcher === NATIVE_MATCHER);
  assert.ok(original, "the original Bash|PowerShell|Write|Edit|NotebookEdit group is gone");
  assert.deepEqual(commandsOf(original).map((c) => c.match(/(pretool|lease-check)\.mjs/)?.[1]), ["pretool", "lease-check"]);
  assert.deepEqual(routingProblems(settings), []);
  const lease = leaseGroups(settings);
  assert.equal(lease.length, 1, "exactly one lease-check group for the MCP and native runners and writers");
  assert.deepEqual(commandsOf(lease[0]).map((c) => c.match(/([\w-]+)\.mjs/)?.[1]), ["lease-check"], "that group runs lease-check ONLY: pretool has its own group");
  for (const shape of SQL_SHAPES) assert.ok(!groupsFor(settings, shape.name).some(runsLease), `${shape.name} never touches the worktree: lease-check must not route it`);
});

test("registration: the lease-check matcher is an anchored regex that routes exactly the runner and writer names, anchored or not", () => {
  const [group] = leaseGroups(settings);
  assert.ok(group, "no lease-check group for the MCP and native runners and writers");
  const m = group.matcher;
  assert.ok(!EXACT_ONLY.test(m), "a matcher of only letters, digits and _ - , | would be an EXACT-name list, not a regex");
  assert.doesNotThrow(() => new RegExp(m));
  for (const name of [...ROUTED, ...NOT_ROUTED, ...TRICKY, ...NATIVE]) {
    const unanchored = new RegExp(m).test(name);
    const anchored = new RegExp(`^(?:${m})$`).test(name);
    assert.equal(unanchored, anchored, `${name}: the lease matcher gives a different answer anchored (${anchored}) and unanchored (${unanchored})`);
    assert.equal(unanchored, LEASE_TOOLS.includes(name), `${name}: lease routed=${unanchored}, expected ${LEASE_TOOLS.includes(name)}`);
  }
});

test("BREAKS: a registration without the lease group, or with the SQL tools inside it, is reported by tool name", () => {
  assert.deepEqual(routingProblems(settings), [], "control: the real registration is right");
  const dropped = structuredClone(settings);
  dropped.hooks.PreToolUse = dropped.hooks.PreToolUse.filter((g) => !(runsLease(g) && g.matcher !== NATIVE_MATCHER));
  const missing = routingProblems(dropped);
  assert.equal(missing.length, LEASE_TOOLS.length, `exactly the runner and writer tools are reported: ${missing.join(" | ")}`);
  assert.ok(missing.some((l) => l.startsWith(`${TERMINAL}:`)) && missing.some((l) => l.startsWith("Monitor:")));
  const widened = structuredClone(settings);
  const pretoolMcp = preGroups(settings).find((g) => runsPretool(g) && g.matcher !== NATIVE_MATCHER);
  widened.hooks.PreToolUse.find((g) => runsLease(g) && g.matcher !== NATIVE_MATCHER).matcher = pretoolMcp.matcher; // this one carries the SQL suffixes
  const extra = routingProblems(widened);
  assert.equal(extra.length, SQL_SHAPES.length, `exactly the SQL tools are reported: ${extra.join(" | ")}`);
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
      if (a.as === "Bash" && !a.nameAsText) { a.as = "Write"; a.pathFields = a.commandFields; delete a.commandFields; delete a.clientHint; }
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
  for (const field of ["clientHint", "exceptRules", "onlyRules", "rawText", "skipWhenTrue", "expandDirectory"]) {
    assert.ok(README.includes(`\`${field}\``), `README does not document the adapter field ${field}`);
  }
  assert.doesNotMatch(README, /sessionCwd/, "sessionCwd was removed: the README must not document dead config");
  for (const limit of [/persistent shell/i, /unscanned middle/i, /directory walk/i]) {
    assert.match(README, limit, `README must state the documented limit ${limit}`);
  }
  // 2026-10-15 (jobs guard-sql-lease-infra and infra-deny-by-name): the infra deny layer, the list reader, the lease group, the SQL limits and the live-check probes
  assert.match(README, /### Infra tools: deny by name/, "README needs the infra deny-by-name section (the ask section it replaced is gone)");
  assert.ok(README.includes("`infra-name`") && README.includes("`nameAsText`"), "README must document the name row and its nameAsText field");
  assert.match(README, /### How `destructive-sql` reads SQL/, "README must state the boundary the SQL rule scans to");
  for (const phrase of ["a lone `|`", "5,000 characters", "`&&`", "`--command`", "Written-out whitespace", "Quoted identifiers"]) assert.ok(README.includes(phrase), `README must state the SQL rule's boundary: ${phrase}`);
  for (const phrase of ["SQL_FIELD_CAP", "psql -f cleanup.sql", "sqlcmd", "-- drop table later", "analyze: false", "CHAINED read-only search", "git commit -F <file>", "MERGE ... WHEN MATCHED"]) {
    assert.ok(README.includes(phrase), `README must state the accepted SQL limit: ${phrase}`);
  }
  assert.doesNotMatch(README, /quadratic in the text length/, "destructive-sql is anchored and bounded now: the README must not call it quadratic");
  for (const phrase of ["permissions.ask", "bypassPermissions", "mcpInfraDeny.test.mjs", "ARRAY_MAX", "ARRAY_CHAR_BUDGET", "CONTROL-CANARY-COVERAGE.md",
    "Unclassified infrastructure tools", "neon-sql.sql", "neon-sql-transaction.sql_statements[1]", "guard_live_check_probe", "delete-service", "delete_project"]) {
    assert.ok(README.includes(phrase), `README must mention ${phrase}`);
  }
  assert.doesNotMatch(README, /lease-check\.mjs. is not extended/, "lease-check IS extended now: the README must not say otherwise");
  assert.match(README, /lease-check\.mjs. also fires for the runners and writers/);
  for (const limit of [/WHERE true/, /DROP NOT NULL/, /ORDER BY/, /multi-table/, /apply_changes: false/, /string literal/, /DOMAIN, AGGREGATE/]) {
    assert.match(README, limit, `README must state the documented SQL limit ${limit}`);
  }
});

// 2026-10-15 G3 (docs truth): a claim the code cannot back is a defect, so these pin the wording where a claim is made.
test("docs truth: the live check is runnable from a worktree session, the lease and ask limits are stated, and the claims in AGENTS.md, policy.json and the ledger match the code", () => {
  const live = README.slice(README.indexOf("### Live check after merge"));
  assert.ok(live.length > 100, "README needs the live check section");
  for (const phrase of ["0. ", "fast-forward the PRIMARY checkout", "merge --ff-only origin/main", "never `reset --hard`", "FRESH session", "worktree session", "cannot test a `settings.json` that is not merged",
    "bypassPermissions", "positive control", "list-projects", "PASS", "FAIL", "INCONCLUSIVE"]) {
    assert.ok(live.includes(phrase), `README live check must say: ${phrase}`);
  }
  for (const phrase of ["session-level tripwire", "`run_in_terminal`'s own `cwd` argument", "recovery-command exemption", "KNOWN_UNCLASSIFIED", "Refresh recipe", "snapshot: 2026-10-15", "get_edge_configs", "20x slower"]) {
    assert.ok(README.includes(phrase), `README must state: ${phrase}`);
  }
  // 2026-10-15 re-review: the scan claims that were wrong ("every scan is bounded, so linear"), pinned in their corrected wording
  for (const phrase of ["HYPHEN AXIS", "AMBIGUITY AXIS", "CLASS SWEEP", "QUADRATIC AXIS", "Each character is consumed exactly ONE way", "a short-flag CLUSTER", "up to 12 quote-like characters", "UPDATE t1, t2 SET", "hex and octal escapes"]) {
    assert.ok(README.includes(phrase), `README must state: ${phrase}`);
  }
  assert.doesNotMatch(README, /so\s+its\s+cost\s+is\s+linear\s+in\s+their\s+length/, "the 'every scan is bounded, so linear' claim was wrong (an ambiguous scan costs 2^k whatever its bound)");
  assert.doesNotMatch(README, /Every scan is bounded, so a text costs/, "bounded alone is not the cost model: each character must also be consumed one way");
  // and the engine claims (onlyRules, rawText, the SQL door), pinned in their corrected wording
  for (const phrase of ["judged BOTH ways", "denied if EITHER denies", "only sound for `destructive-sql`", "is exactly `[\"destructive-sql\"]` also judges", "any other list keeps `FIELD_CAP`", "be able to judge the row's tool", "On the SQL tool rows only `;` ends a statement"]) {
    assert.ok(README.includes(phrase), `README must state: ${phrase}`);
  }
  assert.doesNotMatch(README, /reported and ignored \(the shell treatment stays on\)/, "a malformed rawText is no longer ignored");
  assert.doesNotMatch(README, /(?:is|and) reported and read as `true`/, "a malformed rawText is judged both ways: reading it as true alone erased --force, --no-verify and -A on a shell row (round 4)");
  const stale = README.split("\n").filter((l) => l.includes("list_edge_configs"));
  assert.ok(stale.length <= 1 && stale.every((l) => l.includes("get_edge_configs")), "the stale Vercel name may only appear beside its live replacement");
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  // the first Enforcement-map row is the one that names the hook's config; found by that, not by the rule count it opens with (that count moves when a rule is added)
  const row = agents.split("\n").find((l) => l.startsWith("| ") && l.includes("config/agent-os/policy.json") && l.includes("blocked at the tool call")) ?? "";
  assert.ok(row, "AGENTS.md first Enforcement-map row (the pretool hook row) not found");
  // 2026-10-15 live check, step 7 FAIL: the 135 `mcp__*__<leaf>` ask rules ran NO prompt in bypassPermissions. Job infra-deny-by-name replaced them with a hook deny by name
  // (rule infra-mutation-tool): the row now says DENIED by name. The full wording is pinned in mcpInfraDeny.test.mjs; this is the cross-file backstop for the old claims.
  for (const phrase of ["DENIED by name", "infra-mutation-tool", "no override", "`lease-check.mjs`", "SQL text tools"]) assert.ok(row.includes(phrase), `AGENTS.md row must say: ${phrase}`);
  assert.doesNotMatch(row, /\bPROMPTED\b|proven live|are prompted|prompts? even in bypass|even in bypass \(list|gate nothing yet|NO working gate/, "the old claims (PROMPTED, prompts even in bypass, the infra tools have no working gate) are false now and must not return");
  // Codex #3053 (P2) still holds: the README's KNOWN_UNCLASSIFIED writers (Vercel create_drain, update_sandbox, ...) were never classified, so they are not denied
  for (const phrase of ["were never covered", "docs/agent-os/README.md"]) assert.ok(row.includes(phrase), `AGENTS.md row must say: ${phrase}`);
  // the README side of the same truth, read from the section that makes the claim (whitespace-normalised: the wording wraps across lines)
  const denyAt = README.indexOf("### Infra tools: deny by name");
  const deny = README.slice(denyAt, README.indexOf("### Still unguarded")).replace(/\s+/g, " ");
  assert.ok(denyAt >= 0 && deny.length > 3000, "README 'Infra tools: deny by name' section not found");
  for (const phrase of ["FAILED their live check", "pause_project", "delete_prisma_postgres_database", "was not separated", "denied by name", "There is NO override"]) assert.ok(deny.includes(phrase), `README 'Infra tools: deny by name' must say: ${phrase}`);
  const live1 = live.replace(/\s+/g, " ");
  for (const phrase of ["Recorded result, 2026-10-15", "Steps 1 to 4 PASS", "Steps 5 and 6 PASS", "Step 7 FAIL", "BLOCKED by repo policy: infra-mutation-tool", "no operator taps"]) assert.ok(live1.includes(phrase), `README live check must say: ${phrase}`);
  assert.doesNotMatch(README.replace(/\s+/g, " "), /makes Claude Code prompt before each one|Documented, not proven live|\*\*What prompts\.\*\*|The 135 protected leaves prompt|the native ask rules have no such window\.|If it fails, replace the globs with exact names|replace the `mcp__\*__<leaf>` entries with exact tool names/, "an old unqualified ask-rule claim or instruction returned: the live check disproved it and the deny replaced it");
  for (const phrase of ["`DELETE dbo.leads`", "UPDATE TOP (100) PERCENT", "FROM is optional in T-SQL", "ON DELETE CASCADE"]) assert.ok(README.includes(phrase), `README must list the T-SQL limit: ${phrase}`);
  const why = policy.rules.find((r) => r.id === "destructive-sql").why;
  assert.match(why, /the listed DROP kinds/);
  assert.doesNotMatch(why, /other DROP kinds|every DROP kind/, "the rule lists its DROP kinds; DOMAIN, AGGREGATE and the rest pass");
  const ledger = readFileSync(join(ROOT, "docs", "agent-os", "MANAGER-LEDGER.md"), "utf8").split("\n").find((l) => l.startsWith("| 2026-10-15-guard-sql-lease-infra |")) ?? "";
  assert.ok(ledger, "the ledger row for this job is missing");
  assert.doesNotMatch(ledger, /every DROP kind/, "the ledger row must say the listed DROP kinds");
  // The guard row is a record whose Status and Next move with the job (the infra live check rewrites its Next); a pin on that text failed the every-PR job on the next ledger edit
  // (2026-10-15). So only history is pinned, and never the Next cell (cell[7]): the phrases below live in the Job, PR and Lesson cells. "144 to 219" (the denyExamples total after
  // that job) sits in Next, so it is no longer pinned; the CURRENT total is pinned by coverage-doc.test.mjs.
  const cell = ledger.split("|").map((c) => c.trim());
  const history = cell.filter((_, i) => i !== 7).join("|");
  for (const phrase of ["the listed DROP kinds", "fast-forward", "G4 the re-review, two commits"]) assert.ok(history.includes(phrase), `the ledger row must say: ${phrase}`);
  assert.ok(["MERGED", "LIVE-VERIFIED"].includes(cell[5]), `the guard row's Status must be MERGED or LIVE-VERIFIED (it merged), not ${cell[5]}`);
  assert.ok(cell[6].includes("#3053 (b6faf90d9"), "the guard row's PR cell must name #3053 and its merge SHA");
  assert.ok(cell[8].includes("live result 2026-10-15"), "the guard row's Lesson must carry the live result next to the 'fails closed' claim it disproved");
});

// A literal pipe inside a ledger cell (even inside backticks) is a column delimiter to a table parser: the 2026-10-15 guard row held `|` in its Job cell, read as 9 cells
// with Status = "platform". Every row is 8 cells with a Status from the header's list; the old row fails this, the other 27 passed it when this was written.
test("ledger: every row is eight cells and its Status is one of the header's words", () => {
  const text = readFileSync(join(ROOT, "docs", "agent-os", "MANAGER-LEDGER.md"), "utf8");
  const allowed = new Set(text.match(/^Status: (.+)$/m)?.[1].split(" | ") ?? []);
  assert.ok(allowed.size >= 5 && allowed.has("MERGED"), "the ledger's Status line was not found");
  const rows = text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Job id") && !l.startsWith("|---"));
  assert.ok(rows.length >= 28, `expected the ledger's rows, found ${rows.length}`);
  for (const l of rows) {
    const cells = l.split("|");
    assert.equal(cells.length, 10, `ledger row ${l.slice(0, 40)}: ${cells.length - 2} cells, want 8 (a literal pipe in a cell splits it: reword)`);
    assert.ok(allowed.has(cells[5].trim()), `ledger row ${l.slice(0, 40)}: Status "${cells[5].trim()}" is not one of ${[...allowed].join(", ")}`);
  }
  // the two jobs that merged beside the guard on 2026-10-15 and had no row (a merged job with no row is invisible to the next manager start)
  for (const id of ["2026-10-15-pr3014-turbo-pins", "2026-10-15-branch-triage-closeout"]) {
    const row = rows.find((l) => l.startsWith(`| ${id} |`));
    assert.ok(row, `the ledger row ${id} is missing`);
    assert.ok(["MERGED", "LIVE-VERIFIED"].includes(row.split("|")[5].trim()), `${id} must be MERGED or LIVE-VERIFIED (a merged job's row)`); // not "MERGED" alone: Status moves on to LIVE-VERIFIED
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
  // onlyRules and rawText: the four SQL text rows and no other (SQL is not a shell command; the typed-text row stays a full-rule shell row)
  for (const id of SQL_ROW_IDS) {
    assert.deepEqual(rows[id]?.onlyRules, ["destructive-sql"], `${id} is judged by destructive-sql alone`);
    assert.equal(rows[id]?.rawText, true, `${id} reads raw SQL`);
  }
  for (const other of Object.keys(rows)) {
    if (SQL_ROW_IDS.includes(other)) continue;
    if (rows[other].nameAsText) {
      // the infra name row: judged by its own rule alone, and never rawText (it would erase the hyphens of the Railway names)
      assert.deepEqual(rows[other].onlyRules, [INFRA_RULE_ID], `${other} is judged by ${INFRA_RULE_ID} alone`);
      assert.equal(rows[other].rawText, undefined, `${other} must not carry rawText`);
      continue;
    }
    assert.equal(rows[other].onlyRules, undefined, `${other} must not carry onlyRules`);
    assert.equal(rows[other].rawText, undefined, `${other} must not carry rawText`);
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
  // string literals are NOT stripped before matching (stripping would let a DO block hide its EXECUTE text)
  "DO $$ BEGIN EXECUTE 'DROP TABLE x'; END $$", "DO $$ BEGIN EXECUTE 'DELETE FROM x'; END $$",
  // a quoted first identifier: statenour has 15 PascalCase Prisma models that exist ONLY as quoted names like "Task"
  'TRUNCATE "Task" CASCADE', "TRUNCATE ONLY \"Task\"", "TRUNCATE `leads`", "TRUNCATE [dbo].[leads]", "UPDATE \"Task\" SET status = 'x'", "UPDATE public.\"Task\" t SET status = 'x'",
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
    // among the FIELD rows: the name row also claims the two SQL tools that are denied by name too (mcpInfraDeny.test.mjs pins that co-claim)
    const claimants = fieldAdapters().filter((b) => new RegExp(b.toolPattern).test(name)).map((b) => b.id);
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
    // a hook copy without the infra name row: the SQL ROWS are under test, and complete_database_migration and execute_prisma_postgres_schema_update
    // would otherwise deny every benign statement by name (the real policy; proven in mcpInfraDeny.test.mjs)
    withTree((p) => { p.mcpAdapters = p.mcpAdapters.filter((a) => !a.nameAsText); }, (hook) => {
      for (const sql of DESTRUCTIVE_SQL) {
        const r = run(shape.name, sqlInput(shape, sql), NORMAL, hook);
        denied(r, "destructive-sql", `${shape.name} <- ${JSON.stringify(sql)}`);
        const last = r.err.trimEnd().split("\n").at(-1);
        assert.ok(last.startsWith(`Judged through MCP adapter ${shape.row}.${shape.field}`) && last.endsWith(` on tool ${shape.name}.`), `the Judged-through text must be the LAST line, got: ${last}`);
      }
      for (const sql of BENIGN_SQL) allowed(run(shape.name, sqlInput(shape, sql), NORMAL, hook), `${shape.name} <- ${JSON.stringify(sql)}`);
    });
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

const BUDGET_LINE = /array field over the judging budget/g;

test("array budget, elements: 2,000 elements are all judged (a bad one at position 2,000 is denied), position 2,001 is reported as not judged with ONE stderr line", () => {
  assert.equal(engine.ARRAY_MAX, 2000, "policy.mjs must export ARRAY_MAX = 2000 (a pin: update the README and these boundaries together)");
  const CAP = engine.ARRAY_MAX;
  const list = (n, badAt) => Array.from({ length: n }, (_, i) => (i === badAt ? "DROP TABLE leads" : "SELECT 1"));
  const last = run(SQL_TX.name, SQL_TX.input(list(CAP + 500, CAP - 1)));
  denied(last, "destructive-sql", "the bad statement at position 2,000 (index 1999)");
  assert.match(last.err, /neon-sql-transaction\.sql_statements\[1999\] on tool /);
  const over = run(SQL_TX.name, SQL_TX.input(list(CAP + 500, CAP)));
  allowed(over, "position 2,001 (index 2000) is beyond the budget and is not judged");
  assert.equal(over.err.match(BUDGET_LINE)?.length, 1, "exactly one stderr line");
  assert.equal(engine.adaptToolCall(SQL_TX.name, { sql_statements: list(CAP + 500, -1) }, NORMAL, policy).length, CAP);
  const exact = run(SQL_TX.name, SQL_TX.input(list(CAP, -1)));
  allowed(exact, "exactly ARRAY_MAX small statements");
  assert.doesNotMatch(exact.err, BUDGET_LINE, "no stderr line when everything was judged");
  denied(run(SQL_TX.name, SQL_TX.input(list(5000, 1500))), "destructive-sql", "a bad statement in the middle of a 5,000-statement transaction");
});

test("array budget, characters: ARRAY_CHAR_BUDGET characters in total are judged; the first element that would push past it is reported as not judged", () => {
  assert.equal(engine.ARRAY_CHAR_BUDGET, 1_000_000, "policy.mjs must export ARRAY_CHAR_BUDGET = 1,000,000 (a pin: update the README and these boundaries together)");
  const full = `SELECT ${"a".repeat(engine.FIELD_CAP - 7)}`; // exactly FIELD_CAP characters, benign
  assert.equal(full.length, engine.FIELD_CAP);
  const fits = engine.ARRAY_CHAR_BUDGET / engine.FIELD_CAP; // 50 full elements use the whole budget
  const build = (badAt) => Array.from({ length: fits + 10 }, (_, i) => (i === badAt ? "DROP TABLE leads" : full));
  denied(run(SQL_TX.name, SQL_TX.input(build(fits - 1))), "destructive-sql", "the bad statement is the 50th element: 49 full elements plus 16 characters fit the budget");
  const over = run(SQL_TX.name, SQL_TX.input(build(fits)));
  allowed(over, "the 51st element would push past 1,000,000 characters and is not judged (if this now denies the budget moved: update the README and this pin)");
  assert.equal(over.err.match(BUDGET_LINE)?.length, 1, "exactly one stderr line");
  const calls = engine.adaptToolCall(SQL_TX.name, { sql_statements: build(-1) }, NORMAL, policy);
  assert.equal(calls.length, fits, "exactly the elements that fit are judged");
  assert.ok(calls.reduce((n, c) => n + c.command.length - "psql ".length, 0) <= engine.ARRAY_CHAR_BUDGET, "the judged characters never exceed the budget");
  allowed(run(SQL_TX.name, SQL_TX.input(Array.from({ length: fits }, () => full))), "exactly the budget, all judged, no bad statement");
});

test("array field: a string given for an array field is judged as a string; an element over SQL_FIELD_CAP is judged as head and tail slices, never joined", () => {
  denied(run(SQL_TX.name, { sql_statements: "DROP TABLE leads" }), "destructive-sql", "a bare string in the array field");
  assert.equal(typeof engine.adaptToolCall, "function", "policy.mjs must export adaptToolCall()");
  assert.equal(engine.SQL_FIELD_CAP, 1_000_000, "policy.mjs must export SQL_FIELD_CAP = 1,000,000");
  const half = engine.SQL_FIELD_CAP / 2;
  const straddle = `${"x".repeat(half - 4)}DROP${"f".repeat(30000)}TABLE leads${"z".repeat(half - 11)}`; // DROP ends the head, TABLE starts the tail
  const calls = engine.adaptToolCall(SQL_TX.name, { sql_statements: ["SELECT 1", straddle] }, NORMAL, policy);
  assert.deepEqual(calls.map((c) => c.via), ["neon-sql-transaction.sql_statements[0]", "neon-sql-transaction.sql_statements[1]#head", "neon-sql-transaction.sql_statements[1]#tail"]);
  allowed(run(SQL_TX.name, SQL_TX.input([straddle])), "a statement that straddles the unjudged middle of an element over the cap is not judged (documented slip window)");
  const tail = run(SQL_TX.name, SQL_TX.input([`${"f".repeat(1_100_000)} DROP TABLE leads`]));
  denied(tail, "destructive-sql", "statement fully inside the tail slice of an element");
  assert.match(tail.err, /neon-sql-transaction\.sql_statements\[0\]#tail on tool /);
  // a huge statement AFTER a small one is judged as head and tail slices of what is left of the budget, not skipped
  const after = run(SQL_TX.name, SQL_TX.input(["SELECT 1", `${"f".repeat(1_100_000)} DROP TABLE leads`]));
  denied(after, "destructive-sql", "a huge bad statement after a small one");
  assert.match(after.err, /neon-sql-transaction\.sql_statements\[1\]#tail on tool /);
});

test("SQL: a 25,000-character benign field and the worst whole-array shapes stay far inside the hook timeout (a hook timeout fails OPEN)", (t) => {
  const field = `SELECT 1 ${"UNION SELECT 2 ".repeat(1667)}`;
  assert.ok(field.length > 25000);
  const one = run(SQL_RUN.name, SQL_RUN.input(field));
  allowed(one, "25,000 benign characters");
  // Worst cases of the budget, with the text that costs the rules most (a keyword at every few characters, the WHERE only at the end, so nothing matches):
  // (a) the element budget: 2,000 elements that together spend the whole character budget; (b) the character budget: elements of exactly FIELD_CAP characters.
  const heavy = (n) => `${"DELETE FROM a ".repeat(n)}WHERE x`;
  const small = heavy(35);
  assert.ok(small.length * engine.ARRAY_MAX <= engine.ARRAY_CHAR_BUDGET + engine.ARRAY_MAX * 8, "the element-budget shape is about ARRAY_CHAR_BUDGET characters in all");
  const byCount = run(SQL_TX.name, SQL_TX.input(Array.from({ length: engine.ARRAY_MAX + 500 }, () => small)));
  allowed(byCount, "2,000 judged elements that match nothing");
  // the WHERE must stay within the rule's reach of every occurrence or the first one is simply denied (the WHERE scan is bounded at 5,000 characters)
  const block = `${"DELETE FROM a ".repeat(340)}WHERE x `;
  const big = block.repeat(4).padEnd(engine.FIELD_CAP, " "); // exactly FIELD_CAP characters: 50 of them are exactly the character budget
  assert.equal(big.length, engine.FIELD_CAP);
  const bySize = run(SQL_TX.name, SQL_TX.input(Array.from({ length: 200 }, () => big)));
  allowed(bySize, "elements of FIELD_CAP characters, stopped by the character budget");
  const whole = block.repeat(Math.floor(engine.SQL_FIELD_CAP / block.length)); // one field of almost 1,000,000 characters, judged whole
  const byField = run(SQL_RUN.name, SQL_RUN.input(whole));
  allowed(byField, "one field of almost SQL_FIELD_CAP characters");
  t.diagnostic(`hook wall time including node start: 25k field ${one.ms} ms, 2,000 x ${small.length} chars ${byCount.ms} ms, 200 x ${big.length} chars ${bySize.ms} ms, one ${whole.length}-char field ${byField.ms} ms`);
  // Two kinds of bound. The benign field has a 25x margin (measured ~100 ms, bound 3 s). The adversarial shapes are the worst text the rules
  // can be fed (a keyword every 14 characters), so their bound is the hook's own 10 s timeout less margin: that is the real failure, a timeout
  // fails OPEN. The measured times are reported above, not asserted: asserting a tighter number would flake on a loaded runner.
  assert.equal(one.signal, null);
  assert.ok(one.ms < 3000, `a 25,000-character benign field took ${one.ms} ms`);
  for (const r of [byCount, bySize, byField]) {
    assert.equal(r.signal, null, "the hook must not run into its own timeout");
    assert.ok(r.ms < 9000, `took ${r.ms} ms; the hook timeout is 10 s and a timeout fails OPEN`);
  }
});

// --- the HYPHEN AXIS and the AMBIGUITY AXIS (2026-10-15 re-review) ---------------------------------------------------------------
// The first worst-shape canaries built their blocks from hyphen-free text, so they could not see that the WHERE scan consumed a hyphen two
// ways (a branch for "not after whitespace" and a branch for "not a flag word", both true on a UUID hyphen): a failed search cost 2^k and a
// 6-UUID IN list ran into the hook's timeout, which fails OPEN. These shapes are the realistic text that carries hyphens (UUID lists, ISO
// dates, dashed comments and literals), judged through the SQL rows AND the shell door by the real hook with the 9 s kill line.
const HYPHEN_UUID = (i) => `${(0x10000000 + i).toString(16)}-1111-4222-8333-${(0x100000000000 + i).toString(16)}`;
const HYPHEN_UUIDS = (n) => Array.from({ length: n }, (_, i) => `'${HYPHEN_UUID(i)}'`).join(", ");
const HYPHEN_DATES = (n) => Array.from({ length: n }, (_, i) => `'2026-10-${String((i % 28) + 1).padStart(2, "0")}T10:00:00'`).join(", ");
const HYPHEN_SHAPES = [
  ...[3, 6, 10, 30].flatMap((n) => [
    [`UPDATE ... WHERE id IN (${n} uuids)`, `UPDATE leads SET status = 'archived' WHERE id IN (${HYPHEN_UUIDS(n)})`, false],
    [`DELETE ... WHERE id IN (${n} uuids)`, `DELETE FROM leads WHERE id IN (${HYPHEN_UUIDS(n)})`, false],
  ]),
  ["UPDATE, 6 uuids, no WHERE", `UPDATE leads SET note = ${HYPHEN_UUIDS(6)}`, true],
  ["DELETE, 6 uuids in a comment, no WHERE", `DELETE FROM leads /* ${HYPHEN_UUIDS(6)} */`, true],
  ["UPDATE, 30 ISO dates, WHERE", `UPDATE leads SET seen = ${HYPHEN_DATES(30)} WHERE id = 1`, false],
  ["UPDATE, 30 ISO dates, no WHERE", `UPDATE leads SET seen = ${HYPHEN_DATES(30)}`, true],
  ["DELETE, 30-dash comment, no WHERE", `DELETE FROM leads /* ${"-".repeat(30)} */`, true],
  ["DELETE, 300-dash comment, no WHERE", `DELETE FROM leads /* ${"-".repeat(300)} */`, true],
  ["DELETE, 300-dash comment, WHERE", `DELETE FROM leads /* ${"-".repeat(300)} */ WHERE id = 1`, false],
  ["UPDATE, a-a-...-a literal of 40 hyphens, WHERE", `UPDATE t SET a = '${Array(41).fill("a").join("-")}' WHERE id = 1`, false],
  ["UPDATE, a-a-...-a literal of 40 hyphens, no WHERE", `UPDATE t SET a = '${Array(41).fill("a").join("-")}'`, true],
  ["ALTER TABLE, 30 uuids in a comment, no DROP", `ALTER TABLE t ADD COLUMN x text DEFAULT '${HYPHEN_UUID(1)}' /* ${HYPHEN_UUIDS(30)} */`, false],
  ["ALTER TABLE, 300 dashes then DROP", `ALTER TABLE t /* ${"-".repeat(300)} */ DROP COLUMN c`, true],
];

test("HYPHEN AXIS: UUID lists, ISO dates, dashed comments and literals are judged correctly and inside the hook timeout, through the SQL rows and the shell door", (t) => {
  assert.equal(HYPHEN_SHAPES.length, 19, "the hyphen axis is the proof surface: do not thin it");
  const kill = 9000; // the hook's own timeout is 10 s and a timeout fails OPEN
  const failures = [];
  const times = [];
  for (const [label, sql, wantDeny] of HYPHEN_SHAPES) {
    for (const [door, name, input] of [
      ["sql", SQL_RUN.name, { sql, project_id: "p-1" }],
      ["shell", "Bash", { command: `psql "$DATABASE_URL" -c "${sql.replaceAll('"', '\\"')}"` }],
    ]) {
      const r = run(name, input, NORMAL, HOOK, kill);
      times.push(r.ms);
      const verdict = r.signal ? `killed (${r.signal}) at ${r.ms} ms: the hook timeout fails OPEN` : r.code === 2 && /BLOCKED by repo policy: destructive-sql(?![\w-])/.test(r.err) ? "deny" : r.code === 0 ? "allow" : `exit ${r.code}`;
      if (verdict !== (wantDeny ? "deny" : "allow")) failures.push(`${door} ${label} (${sql.length} chars): ${verdict}`);
      if (failures.length >= 4) break; // a red run costs one kill line per failure
    }
    if (failures.length >= 4) break;
  }
  t.diagnostic(`hyphen axis through the real hook: ${times.length} calls, slowest ${Math.max(...times)} ms, median ${[...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]} ms (node start included)`);
  assert.deepEqual(failures, [], "a hyphen is consumed exactly one way: these shapes must neither be killed nor judged wrongly");
});

// The generator behind the axis: a long run of every character class the pattern mentions, at the scan position of each arm, in a child
// process per arm (a regression hangs the child, not the test run, and names the arm). Nothing here has a WHERE, so a scan that can be
// matched two ways costs 2^k and the child is killed; a linear scan finishes every shape in milliseconds.
const FUZZ_UNITS = ["-", "--", "---- ", "a-", "a-a-", " -", " --", " -x", "- ", "\\", "\\\\", "\\n", "\\\\n", "`n", "`", "``", '"', '""', '\\"', '\\\\"', "'", "[", "]", "[a]", ".", ". ",
  "a.", "a.b.", '"a".', '\\"a\\".', "`a`.", "[a].", '"a" ', "AS ", " AS a ", " ", "\t", "\n", "&", "&&", "|", "||", "|||", "*", "$", "$$", "a b ", "0123abcd-1111-4222-8333-abcdef012345,",
  "2026-10-15T10:00:00,", "x_y-z ", "(a-b)", "/* - */", "-- -\n"];
const FUZZ_ARMS = { // [command prefix, the verdict every unit must get (undefined: not asserted, it depends on the unit)]
  delete: ['psql -c "DELETE FROM t ', true], update_set: ['psql -c "UPDATE t SET a = ', true], update_alias: ['psql -c "UPDATE t ', false], alter: ['psql -c "ALTER TABLE t ', false],
  update_ident: ['psql -c "UPDATE ', undefined], truncate: ['psql -c "TRUNCATE ', undefined], drop: ['psql -c "DROP ', undefined], prefix: ["", undefined],
};
const FUZZ_CHILD = `const { readFileSync, writeSync } = require("node:fs");
const { prefix, source, flags, units } = JSON.parse(readFileSync(0, "utf8"));
const re = new RegExp(source, flags);
for (const unit of units) {
  const text = prefix + unit.repeat(Math.max(2, Math.ceil(3000 / unit.length)));
  const t0 = process.hrtime.bigint();
  const hit = re.test(text);
  writeSync(1, JSON.stringify({ unit, ms: Number(process.hrtime.bigint() - t0) / 1e6, hit }) + "\\n");
}`;
function fuzzArm(prefix, source, flags, units, killMs) {
  const r = spawnSync(process.execPath, ["-e", FUZZ_CHILD], { input: JSON.stringify({ prefix, source, flags, units }), encoding: "utf8", timeout: killMs, maxBuffer: 1 << 24 });
  const rows = (r.stdout ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { rows, killed: Boolean(r.signal), stuckOn: r.signal ? units[rows.length] : undefined };
}

test("AMBIGUITY AXIS: no run of any character class makes destructive-sql's scans cost more than milliseconds at any arm; the old two-branch hyphen scan is killed by the same generator (positive control)", (t) => {
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  const slow = [];
  let measured = 0;
  for (const [arm, [prefix, verdict]] of Object.entries(FUZZ_ARMS)) {
    const res = fuzzArm(prefix, rule.pattern, rule.flags, FUZZ_UNITS, 30000);
    assert.equal(res.killed, false, `arm ${arm}: the match did not finish on the unit ${JSON.stringify(res.stuckOn)} (exponential backtracking: some part of a scan is matched two ways)`);
    assert.equal(res.rows.length, FUZZ_UNITS.length, `arm ${arm}: the child measured ${res.rows.length} of ${FUZZ_UNITS.length} units`);
    for (const row of res.rows) {
      measured++;
      if (row.ms > 1500) slow.push(`${arm} ${JSON.stringify(row.unit)}: ${row.ms.toFixed(0)} ms`);
      if (verdict !== undefined) assert.equal(row.hit, verdict, `arm ${arm}, unit ${JSON.stringify(row.unit)}: the verdict changed (a pattern that is fast and wrong is not the goal)`);
    }
  }
  assert.deepEqual(slow, [], "every shape must cost milliseconds, not seconds");
  // positive control: put the OLD scan group back (two branches that both match a hyphen) and the generator must not get through the first unit
  const OLD_SCAN = String.raw`(?:[^;&|-]|&(?!&)|\|\||-(?:(?<!\s-)|(?!-?(?:c|e|f|q|query|command|execute|file)\b)))`;
  const NEW_SCAN = String.raw`(?:(?!\s-(?:-?(?:query|command|execute|file)|-?[cefq]|[A-Za-z0-9]+[cefq])\b)(?:[^;&|]|&(?!&)|\|\|))`;
  assert.equal(rule.pattern.split(NEW_SCAN).length - 1, 3, "the shipped pattern must carry the single-branch scan in its three arms");
  const broken = rule.pattern.split(NEW_SCAN).join(OLD_SCAN);
  const control = fuzzArm(FUZZ_ARMS.delete[0], broken, rule.flags, ["-"], 4000);
  assert.equal(control.killed, true, "positive control: with the old two-branch scan the generator must be killed on the unit '-', or it cannot see this defect");
  t.diagnostic(`ambiguity axis: ${measured} shapes (${FUZZ_UNITS.length} units x ${Object.keys(FUZZ_ARMS).length} arms), none killed, none over 1,500 ms; the old scan was killed on the first unit`);
});

// The tempered scan must draw the SAME boundaries as the two-branch scan it replaced (shell `&&`, a spaced `|`, `;`, a following -c/-e/-f/-q/
// --command/--execute/--file; multi-line, `||` and a lone `&` pass through). Differential on 6,000 seeded random statements with few hyphens
// (the old form is only fast there): the verdicts must agree, and a scan that forgets one boundary must disagree somewhere (BREAKS).
test("destructive-sql's tempered WHERE scan draws the same boundaries as the two-branch scan it replaced (differential, seeded, with a BREAKS arm)", () => {
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  const OLD_SCAN = String.raw`(?:[^;&|-]|&(?!&)|\|\||-(?:(?<!\s-)|(?!-?(?:c|e|f|q|query|command|execute|file)\b)))`;
  const NEW_SCAN = String.raw`(?:(?!\s-(?:-?(?:query|command|execute|file)|-?[cefq]|[A-Za-z0-9]+[cefq])\b)(?:[^;&|]|&(?!&)|\|\|))`;
  const oldRe = new RegExp(rule.pattern.split(NEW_SCAN).join(OLD_SCAN), rule.flags);
  const heads = ['psql -c "DELETE FROM leads', 'psql -c "UPDATE leads SET a = 1', 'psql "$U" -c "UPDATE t SET b = 2', "mysql -e 'DELETE FROM t", 'psql -c "ALTER TABLE t ADD x int', 'psql -c "ALTER TABLE t',
    "psql <<'EOF'\nDELETE FROM t", "psql -c $'UPDATE x SET y = z"];
  const tokens = [" ", "\n", " WHERE id = 1", " where", " -c ", " -c", " --command ", " -e ", " -f x", " -q ", " -query", " --file=a", "-", "--", "a-b", "x-y-z", " -x", " - ", ";", " ; ", "&&",
    " && ", "&", "AT&T", "|", " | ", "||", " || ", '"', '\\"', "'", ")", "(", " DROP COLUMN c", " ADD COLUMN d int", " SET q = 1", " psql ", " -- c\n", "/* - */", "\\n", "`n"];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const texts = Array.from({ length: 6000 }, () => {
    let text = heads[Math.floor(rnd() * heads.length)];
    for (let j = 1 + Math.floor(rnd() * 5); j > 0; j--) text += tokens[Math.floor(rnd() * tokens.length)];
    return text;
  });
  const newRe = new RegExp(rule.pattern, rule.flags);
  const disagreements = (re) => texts.filter((text) => re.test(text) !== oldRe.test(text));
  assert.equal(rule.pattern.split(NEW_SCAN).length - 1, 3, "the shipped pattern must carry the single-branch scan in its three arms");
  assert.deepEqual(disagreements(newRe).slice(0, 5), [], "the tempered scan changed a verdict the two-branch scan gave");
  const denies = texts.filter((text) => newRe.test(text)).length;
  assert.ok(denies > 1000 && denies < texts.length - 1000, `the corpus must hold both verdicts in volume (got ${denies} denies of ${texts.length})`);
  // BREAKS: forget the `&&` boundary, the lone-`|` boundary, or one flag word, and the corpus must notice
  for (const [what, scan] of [
    ["the && boundary", NEW_SCAN.replace("&(?!&)", "&")],
    ["the lone | boundary", NEW_SCAN.replace(String.raw`|\|\|)`, String.raw`|\||\|\|)`)],
    ["the --command flag word", NEW_SCAN.replace("|command|", "|")],
  ]) {
    assert.notEqual(scan, NEW_SCAN, `${what}: the mutation changed nothing`);
    const mutated = new RegExp(rule.pattern.split(NEW_SCAN).join(scan), rule.flags);
    assert.ok(disagreements(mutated).length > 0, `BREAKS: a scan that forgets ${what} must disagree with the old scan somewhere in the corpus, or the differential cannot see a boundary move`);
  }
});

// --- the CLASS SWEEP and the QUADRATIC AXIS (2026-10-15 re-review, the design fix for the whole class) -----------------------------------
// One missed axis is how the hyphen regression got through: the worst-shape canaries were built from hyphen-free text. This sweep does not pick
// axes by hand. For EVERY character class the pattern mentions, repeated 30, 300 and 3000 times, behind a prefix that puts each arm on its failure
// path and on its success path, through BOTH doors (the shell door as `psql -c "..."` and the SQL row run_sql) and the REAL hook, it asserts
// (a) the hook returns, (b) in under 2 s, (c) with the expected verdict. The prefix decides the verdict, never the class, except for TRUNCATE
// right before a bare run (a word character after it IS the table name).
const SWEEP_CLASSES = {
  hyphen: "-", bracket: "[", "single quote": "'", "double quote": '"', backslash: "\\", backtick: "`", space: " ", digit: "7", "hex letter": "a", dollar: "$", ampersand: "&", pipe: "|", dot: ".",
  semicolon: ";",
};
const SWEEP_SIZES = [30, 300, 3000];
const SWEEP_PREFIXES = [
  ["bare DELETE", "DELETE FROM leads ", () => "deny"],
  ["bare UPDATE", "UPDATE leads SET a = 1 ", () => "deny"],
  ["bare TRUNCATE after a table name", "TRUNCATE leads ", () => "deny"],
  ["TRUNCATE straight into the run", "TRUNCATE ", (cls) => (cls === "digit" || cls === "hex letter" ? "deny" : "allow")],
  ["ALTER TABLE with no DROP anywhere", "ALTER TABLE leads ", () => "allow"],
  ["WHERE-guarded DELETE", "DELETE FROM leads WHERE id = 1 ", () => "allow"],
  ["WHERE-guarded UPDATE", "UPDATE leads SET a = 1 WHERE id = 1 ", () => "allow"],
  ["UPDATE straight into the run", "UPDATE ", () => "allow"],
  ["DROP straight into the run", "DROP ", () => "allow"],
  ["no arm at all", "SELECT 1 ", () => "allow"],
];

/** The real hook as an async child (so a pool can run several at once). Kills it at `killMs`. */
function runAsync(tool_name, tool_input, killMs) {
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, killMs);
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.resume();
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, killed, err, ms: Date.now() - t0 });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ tool_name, tool_input, cwd: NORMAL }));
  });
}
const verdictOf = (r) => (r.killed ? `killed at ${r.ms} ms (the hook timeout fails OPEN)` : r.code === 2 && /BLOCKED by repo policy: destructive-sql(?![\w-])/.test(r.err) ? "deny" : r.code === 0 ? "allow" : `exit ${r.code}`);

test("CLASS SWEEP: every character class x 30, 300, 3000 x every arm's failure and success path, through the shell door and the SQL row, in the REAL hook: it returns, in under 2 s, with the expected verdict", async (t) => {
  const tasks = [];
  for (const [cls, ch] of Object.entries(SWEEP_CLASSES)) {
    for (const size of SWEEP_SIZES) {
      for (const [label, prefix, expected] of SWEEP_PREFIXES) {
        const text = prefix + ch.repeat(size);
        const want = expected(cls);
        tasks.push({ door: "shell", name: "Bash", input: { command: `psql -c "${text}"` }, want, what: `${cls} x ${size} after ${label}` });
        tasks.push({ door: "sql", name: SQL_RUN.name, input: { sql: text, project_id: "p-1" }, want, what: `${cls} x ${size} after ${label}` });
      }
    }
  }
  assert.equal(tasks.length, 14 * 3 * 10 * 2, "the sweep is 14 classes x 3 sizes x 10 prefixes x 2 doors");
  const failures = [];
  const slow = [];
  const times = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length && failures.length < 12) {
      const task = tasks[next++];
      let r = await runAsync(task.name, task.input, 9000);
      if (!r.killed && r.ms > 2000) r = await runAsync(task.name, task.input, 9000); // one retry: a loaded machine, not a defect, is fast the second time
      times.push(r.ms);
      const verdict = verdictOf(r);
      if (verdict !== task.want) failures.push(`${task.door} ${task.what}: ${verdict}, expected ${task.want}`);
      else if (r.ms > 2000) slow.push(`${task.door} ${task.what}: ${r.ms} ms`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const sorted = [...times].sort((a, b) => a - b);
  t.diagnostic(`class sweep through the real hook: ${times.length} calls, median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted[sorted.length - 1]} ms (node start included, 6 at a time)`);
  assert.deepEqual(failures, [], "a character class made the hook hang, answer wrongly or run past the kill line");
  assert.deepEqual(slow, [], "every call must return in under 2 s (checked twice before it is reported)");
});

// The sweep above is far too small to see a QUADRATIC arm (66 ms at 20,000 characters, 10 s at 400,000). So each arm is also fed its own keyword
// repeated to 240,000 characters, in a child process per unit with a kill line. A unit that has to scan to the end of the text from every start
// is quadratic: it takes seconds here, a linear arm takes milliseconds to a few hundred.
const QUADRATIC_UNITS = ["UPDATE [", "UPDATE a.[", "UPDATE a [", "UPDATE ONLY [", 'UPDATE "', "UPDATE \\\"", "UPDATE a SET b = ", "UPDATE a SET b = [", "DELETE FROM a ", "DELETE FROM [", "ALTER TABLE a ", "ALTER TABLE [",
  "TRUNCATE [", 'TRUNCATE "', "TRUNCATE ", "DROP ", "DROP [", "psql "];
const QUADRATIC_CHILD = `const { readFileSync, writeSync } = require("node:fs");
const { source, flags, unit, chars } = JSON.parse(readFileSync(0, "utf8"));
const re = new RegExp(source, flags);
const text = "psql " + unit.repeat(Math.ceil(chars / unit.length));
const t0 = process.hrtime.bigint();
const hit = re.test(text);
writeSync(1, JSON.stringify({ ms: Number(process.hrtime.bigint() - t0) / 1e6, hit, length: text.length }));`;
function quadraticUnit(source, flags, unit, chars, killMs) {
  const r = spawnSync(process.execPath, ["-e", QUADRATIC_CHILD], { input: JSON.stringify({ source, flags, unit, chars }), encoding: "utf8", timeout: killMs, maxBuffer: 1 << 20 });
  return r.signal ? { killed: true } : { killed: false, ...JSON.parse(r.stdout) };
}

test("QUADRATIC AXIS: every arm's own keyword repeated to 240,000 characters finishes in a few seconds, none scans to the end of the text from every start; the old unbounded bracket class does not (positive control)", (t) => {
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  const slow = [];
  const timesMs = [];
  let shippedBracketMs = Infinity;
  for (const unit of QUADRATIC_UNITS) {
    const r = quadraticUnit(rule.pattern, rule.flags, unit, 240_000, 30000);
    if (r.killed || r.ms > 4000) slow.push(`${JSON.stringify(unit)}: ${r.killed ? "killed at 30 s" : `${r.ms.toFixed(0)} ms`}`);
    else timesMs.push([r.ms, unit]);
    if (unit === "UPDATE [" && !r.killed) shippedBracketMs = r.ms;
  }
  timesMs.sort((a, b) => b[0] - a[0]);
  t.diagnostic(`quadratic axis: ${QUADRATIC_UNITS.length} units x 240,000 chars, slowest ${timesMs[0]?.[1] === undefined ? "n/a" : `${JSON.stringify(timesMs[0][1])} ${timesMs[0][0].toFixed(0)} ms`}`);
  assert.deepEqual(slow, [], "a unit that costs seconds at 240,000 characters is quadratic in the text length");
  // positive control: the unbounded bracket class of the first version, on the unit that exposed it, must be killed or at least 10x slower than the
  // shipped pattern on the SAME text. A ratio, not a clock: this control once asserted "over 3 s" (8 to 21 s on a loaded machine) and failed at 2.3 s
  // on an idle one, while the shipped pattern took 0.05 s on the same text.
  const unbounded = rule.pattern.split(String.raw`\[[^\]\[]+\]`).join(String.raw`\[[^\]]+\]`);
  assert.notEqual(unbounded, rule.pattern, "the shipped bracket class changed shape: update this control");
  const control = quadraticUnit(unbounded, rule.flags, "UPDATE [", 240_000, 20000);
  assert.ok(Number.isFinite(shippedBracketMs), "the shipped pattern must finish the \"UPDATE [\" unit, or there is nothing to compare the control with");
  assert.ok(control.killed || control.ms >= 10 * Math.max(shippedBracketMs, 20), `positive control: the unbounded bracket class took ${control.ms} ms against ${shippedBracketMs} ms for the shipped pattern on 240,000 characters of "UPDATE [": under 10x, so this axis cannot see a quadratic arm`);
});

test("re-review boundaries: each new denyExample is denied BECAUSE of its fix (BREAKS: the pattern without that piece lets it through); the documented limits are pinned", () => {
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  const denies = (pattern, text) => new RegExp(pattern, rule.flags).test(text);
  const fresh = (needle, count) => rule.denyExamples.slice(rule.denyExamples.findIndex((e) => e.includes(needle)), rule.denyExamples.findIndex((e) => e.includes(needle)) + count);
  const cluster = fresh("-tAc", 3); // psql -tAc, mysql -Ne, psql -qc
  const nested = fresh("ssh host \"psql", 3); // three backslashes, seven backslashes, a PowerShell backtick run
  const alter = fresh("ALTER TABLE leads\\nDROP phone", 4); // backslash-n, backslash-t, backtick-n, MySQL DROP FOREIGN KEY
  for (const group of [cluster, nested, alter]) assert.equal(group.length, 3 + (group === alter ? 1 : 0), "the example group moved: update this canary");
  const armOf = (name, next) => rule.pattern.match(new RegExp(`\\|${name}[\\s\\S]*?(?=\\|${next}\\()`))?.[0];
  const alterArm = armOf("ALTER", "DELETE");
  assert.ok(alterArm?.includes("TABLE"), "could not isolate the ALTER arm of the pattern");
  const withoutPiece = {
    "the short-flag cluster stop": rule.pattern.split("|[A-Za-z0-9]+[cefq]").join(""),
    "the identifier quote run beyond 3": rule.pattern.split("){1,12}").join("){1,3}"),
    "the ALTER arm": rule.pattern.replace(alterArm, ""),
  };
  for (const [what, pattern] of Object.entries(withoutPiece)) assert.notEqual(pattern, rule.pattern, `${what}: the mutation changed nothing`);
  for (const [what, group] of [["the short-flag cluster stop", cluster], ["the identifier quote run beyond 3", nested], ["the ALTER arm", alter]]) {
    for (const example of group) {
      assert.ok(denies(rule.pattern, example), `control: ${JSON.stringify(example)} is denied by the shipped pattern`);
      assert.ok(!denies(withoutPiece[what], example), `BREAKS: without ${what}, ${JSON.stringify(example)} must pass, or the example proves nothing about that piece`);
    }
  }
  // documented limits, pinned: a later WHERE after a NEWLINE, `||` or a single `&` still rescues a bare write on the shell door (README "Where a missing WHERE is decided")
  for (const command of [
    `psql -c "DELETE FROM leads"\npsql "$U" <<'EOF'\nSELECT count(*) FROM leads WHERE id > 0;\nEOF`,
    `psql -c "DELETE FROM leads" || echo "rows where id > 0"`,
    `psql -c "DELETE FROM leads" & echo where`,
  ]) allowed(run("Bash", { command }), `documented limit (if this now denies, update the README): ${JSON.stringify(command)}`);
  // and the cost of the cluster stop on the shell door: a spaced minus before a word that ends in c, e, f or q reads as a flag (the SQL rows are not affected)
  denied(run("Bash", { command: `psql -c "UPDATE t SET balance = balance -fee WHERE id = 1"` }), "destructive-sql", "shell door: ` -fee` reads as a flag cluster (documented false positive)");
  allowed(run(SQL_RUN.name, SQL_RUN.input("UPDATE t SET balance = balance -fee WHERE id = 1")), "the SQL row has no shell flags");
  // the other spellings that still pass (README "What the SQL rule still misses"), each a pin that fails the day it is fixed
  for (const command of [
    String.raw`printf 'SELECT 1;\x0aDELETE FROM leads' | psql "$U"`, String.raw`printf 'SELECT 1;\012DELETE FROM leads' | psql "$U"`, String.raw`printf 'DELETE\x20FROM leads' | psql "$U"`,
    `psql -c 'UPDATE"Task"SET status=1'`, `psql -c 'UPDATE "a""b" SET x = 1'`, `mysql -e "UPDATE t1, t2 SET t1.a = 1"`,
  ]) allowed(run("Bash", { command }), `documented limit (if this now denies, update the README): ${command}`);
});

test("destructive-sql is anchored: the unanchored form is at least 20x slower on the same 60,000 benign characters (a ratio, never a clock)", () => {
  // The array reader multiplies judgments (ARRAY_MAX elements of FIELD_CAP characters each), which is only affordable
  // because the rule is anchored: unanchored, the engine retries the whole lookahead from every start position.
  // Measured 2026-10-15: 200 elements of 20,000 characters ran into the 30 s test timeout on the unanchored form, and
  // 60,000 characters took about 3 ms anchored against about 2,700 ms unanchored (~900x). The assertion is that ratio
  // with a 20x floor and a 1 ms floor on the divisor, not a millisecond number: a fast or a loaded runner moves both
  // sides together, so it cannot go red for a non-defect.
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  assert.ok(rule?.pattern.startsWith("^"), "the shipped pattern must be anchored (structural check)");
  const text = `${"SELECT x FROM t ".repeat(3750)}psql`;
  const time = (source) => {
    const re = new RegExp(source, rule.flags);
    const t0 = process.hrtime.bigint();
    const hit = re.test(text);
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, hit };
  };
  const unanchored = time(rule.pattern.replace(/^\^/, ""));
  const shipped = time(rule.pattern);
  assert.equal(unanchored.hit, false, "benign text must not match");
  assert.equal(shipped.hit, false, "benign text must not match");
  assert.ok(unanchored.ms > 50, `positive control: the unanchored form took only ${unanchored.ms} ms, too fast for a ratio to mean anything`);
  const ratio = unanchored.ms / Math.max(shipped.ms, 1);
  assert.ok(ratio >= 20, `the shipped pattern is only ${ratio.toFixed(1)}x faster than its unanchored form on 60,000 benign characters`);
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

// The deny probes of the DELETE / UPDATE / ALTER TABLE ... DROP / DROP-kind arms of destructive-sql are its policy.json denyExamples
// (the repo convention: every verified bypass string is a denyExample beside its rule), so policy.test.mjs and the adapter parity
// tests already run them. This block adds what those do not: PowerShell, every adapter row with a rule-id check, and a guard that
// each class is really among the examples (a loop over a list that lost its probes is a silent green).
const DESTRUCTIVE_PROBES = policy.rules.find((r) => r.id === "destructive-sql").denyExamples;

test("destructive-sql deny probes: each class is among the denyExamples, and each is denied BY THIS RULE as native Bash and PowerShell and through every command adapter (in process)", () => {
  const classes = [/DELETE\s+(?:\w+\s+)*FROM/i, /UPDATE\s+\S+(?:\s+\S+)?\s+SET/i, /ALTER\s+TABLE[\s\S]*DROP/i, ...DROP_KINDS.map((k) => new RegExp(`DROP\\s+${k.split(" ")[0]}`, "i"))];
  for (const re of classes) assert.ok(DESTRUCTIVE_PROBES.some((p) => re.test(p)), `no destructive-sql denyExample for the class ${re}`);
  assert.ok(DESTRUCTIVE_PROBES.length >= 40, `the denyExamples are the proof surface for the extended arms, got ${DESTRUCTIVE_PROBES.length}`);
  const rowsAsBash = fieldAdapters().filter((a) => a.as === "Bash");
  assert.ok(rowsAsBash.length >= 8, "4 runner rows and 4 SQL rows (a loop over nothing is a silent green)");
  for (const command of DESTRUCTIVE_PROBES) {
    for (const toolName of ["Bash", "PowerShell"]) {
      const res = engine.evaluate({ toolName, command, cwd: NORMAL, filePath: "" }, policy);
      assert.equal(res.rule?.id, "destructive-sql", `${toolName}: ${JSON.stringify(command)} was denied by '${res.rule?.id}', not destructive-sql`);
    }
    for (const a of rowsAsBash) {
      if (a.rawText && SHELL_BOUNDARY_EXAMPLE.test(command)) continue; // a SQL row has no shell boundary (the SQL door canary pins that)
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

test("shell-quoted and shell-chained forms through the real hook (G1): quoted identifiers, a WHERE in a later argument, written-out escapes; the legitimate look-alikes pass", () => {
  const BS = "\\", BT = "`";
  const denies = (command, tool = "Bash") => denied(run(tool, { command }), "destructive-sql", `${tool}: ${command}`);
  // P1-a: TRUNCATE with a quoted first identifier, every spelling
  denies(`psql -c 'TRUNCATE "Task" CASCADE'`);
  denies(`psql -c "TRUNCATE ${BS}"Task${BS}" CASCADE"`);
  denies(`psql -c "TRUNCATE ${BT}"Task${BT}" CASCADE"`, "PowerShell");
  denies(`mysql -e 'TRUNCATE ${BT}leads${BT}'`);
  denies(`Invoke-Sqlcmd -Query "TRUNCATE [dbo].[leads]"`, "PowerShell");
  // P1-b: UPDATE of a quoted table when the shell escapes the quotes of a double-quoted -c string
  denies(`psql "$DATABASE_URL" -c "UPDATE ${BS}"Task${BS}" SET status = 'x'"`);
  denies(`psql "$DATABASE_URL" -c "UPDATE public.${BS}"Task${BS}" SET status = 'x'"`);
  denies(`psql -c "UPDATE ${BT}"Task${BT}" SET status = 'x'"`, "PowerShell");
  denies(`psql -c "UPDATE ""Task"" SET status = 'x'"`, "PowerShell");
  denies(`mysql -e "UPDATE ${BS}${BT}leads${BS}${BT} SET status = 'x'"`);
  // P1-c: a WHERE in a LATER argument or chained command must not rescue a bare write
  denies(`psql "$U" -c "DELETE FROM leads" && psql "$U" -c "SELECT count(*) FROM leads WHERE id > 0"`);
  denies(`psql "$U" -c "UPDATE leads SET status = 'x'" -c "SELECT count(*) FROM leads WHERE id > 0"`);
  denies(`psql "$U" -c "DELETE FROM leads" | psql "$U" -c "SELECT 1 WHERE true"`);
  // P2-d: written-out whitespace between keywords
  denies(`printf 'BEGIN;${BS}nDROP TABLE leads;${BS}nCOMMIT;' | psql "$U"`);
  denies(`echo -e "SELECT 1;${BS}nTRUNCATE TABLE leads;" | psql`);
  denies(`"BEGIN;${BT}nUPDATE leads SET a = 1;${BT}nCOMMIT;" | psql`, "PowerShell");
  denies(`psql -c $'DELETE${BS}nFROM leads'`);
  denies(`psql -c "DROP ${BS}\nTABLE leads"`);
  // the look-alikes that must keep passing: string concat and an ampersand before the WHERE, a multi-line statement, a literal \n before the WHERE
  for (const ok of [`psql -c "UPDATE t SET a = b || c WHERE id = 1"`, `psql -c "UPDATE t SET name = 'AT&T' WHERE id = 1"`, `psql -c "DELETE FROM leads\nWHERE id = 3"`,
    `printf 'DELETE FROM leads${BS}nWHERE id = 3;' | psql`, `psql -c "UPDATE ${BS}"Task${BS}" SET status = 'x' WHERE id = 1"`, `psql "$U" -c "UPDATE leads SET a = 1 WHERE id = 1" -c "SELECT 1"`]) {
    allowed(run("Bash", { command: ok }), ok);
  }
});

test("DO-block dollar quoting: the examples keep both $$ and deny because of the text inside the dollar-quoted body (a benign body passes)", () => {
  const rule = policy.rules.find((r) => r.id === "destructive-sql");
  const doBlocks = rule.denyExamples.filter((e) => /\bDO\s+\$/.test(e));
  assert.equal(doBlocks.length, 2, "the DROP and the DELETE DO-block examples");
  for (const example of doBlocks) {
    assert.equal(example.split("$$").length - 1, 2, `${example}: lost a dollar sign of its $$ delimiters`);
    assert.equal(engine.evaluate({ toolName: "Bash", command: example, cwd: NORMAL, filePath: "" }, policy).rule?.id, "destructive-sql");
    const benign = example.replace(/EXECUTE '[^']*'/, () => "PERFORM 1");
    assert.notEqual(benign, example, "the control must change the body");
    assert.equal(engine.evaluate({ toolName: "Bash", command: benign, cwd: NORMAL, filePath: "" }, policy).denied, false, `${benign}: with a benign body the same dollar-quoted block must pass`);
  }
});

// --- 11 - the SQL rows read SQL, not a shell command (adversarial review of 8f6522e8f, group G2) ----------------------------------
// P2-e: the shell neutraliser erased the quoted span after -m/-t/-b, which in SQL can hold statements. P2-f: every shell rule judged SQL
// text, so an INSERT of the words "git push origin main" was a false deny. P2-g: with only destructive-sql running, a field is judged whole.

const P2E_PAYLOADS = [
  `SELECT ' -m "'; DELETE FROM leads; SELECT ' " '`, // the span after -m would be erased, DELETE with it
  `-- psql -t "\nDELETE FROM leads;\nSELECT "id" FROM leads;`, // the same through a SQL comment and a newline
  "rg DELETE FROM leads", // starts like a read-only search, which the shell path skips: still SQL here
];
const P2F_PAYLOADS = [
  [`SELECT * FROM audits WHERE note LIKE '%--no-verify%'`, "no-verify"],
  [`INSERT INTO notes (body) VALUES ('never run git push origin main')`, "push-to-main"],
  [`INSERT INTO notes (body) VALUES ('npm install')`, "install-in-junctioned-worktree"],
  [`INSERT INTO notes (body) VALUES ('git stash pop')`, "stash-pop"],
  [`INSERT INTO notes (body) VALUES ('git reset --hard')`, "destructive-restore"],
];
const sqlRowsOf = (p) => p.mcpAdapters.filter((a) => SQL_ROW_IDS.includes(a.id));
// declared but not a strict boolean: a string, a number, a list, an object, null (absent and a strict false are well formed)
const MALFORMED_RAWTEXT = ["true", 1, [true], {}, null];

test("rawText (P2-e): a quoted span after -m or -t cannot hide a statement, and SQL that starts like a search is still SQL; the shell door keeps its neutraliser", () => {
  for (const shape of SQL_SHAPES) {
    for (const sql of P2E_PAYLOADS) assert.equal(judge(shape.name, sqlInput(shape, sql), NORMAL).rule?.id, "destructive-sql", `${shape.name} should DENY ${JSON.stringify(sql)}`);
  }
  for (const sql of P2E_PAYLOADS) denied(run(SQL_RUN.name, SQL_RUN.input(sql)), "destructive-sql", `real hook, run_sql ${JSON.stringify(sql)}`);
  allowed(run("Bash", { command: 'git commit -m "docs: psql DELETE FROM leads is denied"' }), "a commit message that mentions SQL is data on the shell path");
  allowed(run("Bash", { command: "rg 'DELETE FROM' apps/" }), "a read-only search is still skipped on the shell path");
});

test("onlyRules (P2-f): SQL text that mentions a shell command passes, destructive SQL still denies, and the shell door is unchanged", () => {
  for (const shape of SQL_SHAPES) {
    for (const [sql] of P2F_PAYLOADS) assert.equal(judge(shape.name, sqlInput(shape, sql), WORKTREE).denied, false, `${shape.name} should ALLOW ${JSON.stringify(sql)}`);
  }
  for (const [sql] of P2F_PAYLOADS) allowed(run(SQL_RUN.name, SQL_RUN.input(sql), WORKTREE), `real hook, run_sql from a harness worktree: ${sql}`);
  // control: the same text typed through the shell door is still denied, by its own rule
  for (const [sql, rule] of P2F_PAYLOADS) denied(run(TERMINAL, { command: sql }, WORKTREE), rule, `Terminal MCP: ${sql}`);
  denied(typedInto(`${DC_PLUGIN}interact_with_process`, "git push origin main", NORMAL), "push-to-main", "typed text keeps every shell rule");
  for (const sql of ["DROP TABLE leads", "DELETE FROM leads", "UPDATE leads SET a = 1", 'TRUNCATE "Task" CASCADE']) denied(run(SQL_RUN.name, SQL_RUN.input(sql), WORKTREE), "destructive-sql", sql);
});

test("rawText and onlyRules are validated toward DENIAL: a malformed rawText is judged both ways, a malformed onlyRules is ignored (every rule applies); removing them reopens P2-e and P2-f (BREAKS)", () => {
  const e = (hook) => run(SQL_RUN.name, SQL_RUN.input(P2E_PAYLOADS[0]), NORMAL, hook);
  const f = (hook) => run(SQL_RUN.name, SQL_RUN.input(P2F_PAYLOADS[3][0]), WORKTREE, hook);
  withTree(null, (hook) => {
    denied(e(hook), "destructive-sql", "control: the real table reads raw SQL");
    allowed(f(hook), "control: the real table judges destructive-sql alone");
  });
  withTree((p) => sqlRowsOf(p).forEach((a) => { delete a.rawText; }), (hook) => allowed(e(hook), "BREAKS: without rawText the neutraliser erases the DELETE"));
  withTree((p) => sqlRowsOf(p).forEach((a) => { delete a.onlyRules; }), (hook) => denied(f(hook), "stash-pop", "BREAKS: without onlyRules every shell rule judges SQL text again"));
  // rawText fails toward DENIAL like onlyRules does (re-review, corrected in round 4): a declared-but-malformed value is judged BOTH ways, as a
  // shell command (neutraliser, every rule of the row) and as raw SQL (no neutraliser, `&`, `|` and `-` replaced), and denied if EITHER denies. Ignoring
  // it would switch the neutraliser ON (fewer denials); reading it as true alone would erase the flags of a shell row (also fewer denials).
  for (const bad of MALFORMED_RAWTEXT) {
    withTree((p) => sqlRowsOf(p).forEach((a) => { a.rawText = bad; }), (hook) => {
      const r = e(hook);
      denied(r, "destructive-sql", `rawText ${JSON.stringify(bad)} is malformed and judged both ways: the raw reading sees the DELETE the shell reading erased`);
      assert.match(r.err, /rawText malformed, judged both as a shell command and as raw SQL/);
    });
  }
  withTree((p) => sqlRowsOf(p).forEach((a) => { a.rawText = false; }), (hook) => allowed(e(hook), "an explicit false is well formed: the shell neutraliser applies and erases the span (the documented default)"));
  for (const bad of [["no-such-rule"], [], "destructive-sql", [7], ["destructive-sql", "typo-rule"]]) {
    withTree((p) => sqlRowsOf(p).forEach((a) => { a.onlyRules = bad; }), (hook) => {
      const r = f(hook);
      denied(r, "stash-pop", `onlyRules ${JSON.stringify(bad)} is ignored, so every rule applies`);
      assert.match(r.err, /onlyRules ignored, every rule applies/);
    });
  }
});

// Round 4 (re-review of a75e511a7): a malformed rawText was READ AS TRUE, and a rawText row replaces `&`, `|` and `-` before judging, so on a SHELL runner
// row a typo erased `--force`, `--no-verify` and `-A` and every flag-based rule went quiet (four commands allowed with one stderr line). Now a
// malformed value judges the text BOTH ways and denies if either denies, so it can only add denials.
const SHELL_FLAG_CASES = [
  ["git push --force origin feat", "force-push"],
  ["git push -f origin feat", "force-push"],
  ["git commit --no-verify -m x", "no-verify"],
  ["git add -A", "add-all"],
];
const SQL_STATEMENT_CASES = ["DROP TABLE leads", "DELETE FROM leads", "UPDATE leads SET a = 1"];

test("a malformed rawText judges BOTH ways: the flag rules of a shell runner row and the statements of the SQL rows are still denied; strict true, strict false and absent are unchanged", () => {
  const rowOf = (p, id) => p.mcpAdapters.find((a) => a.id === id);
  // controls: the healthy shell row denies the four, and the healthy SQL rows deny the three statements
  withTree(null, (hook) => {
    for (const [command, rule] of SHELL_FLAG_CASES) denied(run(TERMINAL, { command }, NORMAL, hook), rule, `control, healthy terminal-run: ${command}`);
    for (const sql of SQL_STATEMENT_CASES) denied(run(SQL_RUN.name, SQL_RUN.input(sql), NORMAL, hook), "destructive-sql", `control, healthy neon-sql: ${sql}`);
  });
  // the hazard, shown so the canary is about something: a STRICT true on a shell row replaces the flags, so those four commands pass (a shipped row
  // must never do that: the policy-level canary below forbids rawText true without onlyRules ["destructive-sql"])
  withTree((p) => { rowOf(p, "terminal-run").rawText = true; }, (hook) => {
    for (const [command] of SHELL_FLAG_CASES) allowed(run(TERMINAL, { command }, NORMAL, hook), `a strict true on a shell row erases its flags: ${command}`);
  });
  for (const bad of MALFORMED_RAWTEXT) {
    withTree((p) => { rowOf(p, "terminal-run").rawText = bad; sqlRowsOf(p).forEach((a) => { a.rawText = bad; }); }, (hook) => {
      for (const [command, rule] of SHELL_FLAG_CASES) {
        const r = run(TERMINAL, { command }, NORMAL, hook);
        denied(r, rule, `terminal-run rawText ${JSON.stringify(bad)}: ${command}`);
        assert.match(r.err, /rawText malformed, judged both as a shell command and as raw SQL/);
      }
      for (const sql of SQL_STATEMENT_CASES) denied(run(SQL_RUN.name, SQL_RUN.input(sql), NORMAL, hook), "destructive-sql", `neon-sql rawText ${JSON.stringify(bad)}: ${sql}`);
    });
  }
  // the claim itself, over the whole corpus (not four commands): a malformed rawText denies everything the healthy row denies, by the same rule. On a
  // shell row that is every denyExample of every Bash rule; on a SQL row it is every destructive-sql denyExample, the shell-boundary ones included
  // (the shell reading denies those, so the malformed row denies MORE than the healthy raw one, never fewer).
  for (const bad of ["true", null]) {
    const shell = structuredClone(policy);
    rowOf(shell, "terminal-run").rawText = bad;
    const sql = structuredClone(policy);
    rowOf(sql, "neon-sql").rawText = bad;
    let checked = 0;
    for (const rule of bashRules) {
      for (const sample of rule.denyExamples) {
        const res = judge(TERMINAL, { command: sample }, cwdFor(rule), shell);
        assert.equal(res.rule?.id, rule.id, `terminal-run rawText ${JSON.stringify(bad)}: ${JSON.stringify(sample)} must still be denied by '${rule.id}', got '${res.rule?.id}'`);
        checked++;
      }
    }
    assert.ok(checked >= 200, `only ${checked} deny judgments ran on the malformed shell row: the loop is not reaching the rules`);
    for (const sample of policy.rules.find((r) => r.id === "destructive-sql").denyExamples) {
      const res = judge(SQL_RUN.name, { sql: sample }, NORMAL, sql);
      assert.equal(res.rule?.id, "destructive-sql", `neon-sql rawText ${JSON.stringify(bad)}: ${JSON.stringify(sample)} must still be denied`);
    }
  }
  // the judgments themselves: one per reading for a malformed Bash row, exactly one for a strict true, a strict false and an absent value, one for a Write row
  const reading = (mutate, tool, input) => {
    const p = structuredClone(policy);
    mutate(p);
    const lines = [];
    const calls = engine.adaptToolCall(tool, input, NORMAL, p, (l) => lines.push(l));
    return { modes: calls.map((c) => c.rawText), commands: calls.map((c) => c.command), lines };
  };
  const cmd = { command: "git add -A" };
  assert.deepEqual(reading(() => {}, TERMINAL, cmd).modes, [false], "absent: the shell reading only");
  assert.deepEqual(reading((p) => { rowOf(p, "terminal-run").rawText = false; }, TERMINAL, cmd).modes, [false], "strict false: the shell reading only");
  assert.deepEqual(reading((p) => { rowOf(p, "terminal-run").rawText = true; }, TERMINAL, cmd).modes, [true], "strict true: the raw reading only");
  const malformed = reading((p) => { rowOf(p, "terminal-run").rawText = "true"; }, TERMINAL, cmd);
  assert.deepEqual(malformed.modes, [false, true], "malformed: the shell reading and the raw reading, in that order");
  assert.equal(malformed.lines.length, 1, "and exactly one report line");
  const hinted = reading((p) => { rowOf(p, "neon-sql").rawText = null; }, SQL_RUN.name, { sql: "rg DELETE FROM leads" });
  assert.deepEqual(hinted.commands, ["rg DELETE FROM leads", "psql rg DELETE FROM leads"], "a SQL row: the shell reading keeps its read-only-search skip (no hint), the raw reading always gets the client hint");
  const write = reading((p) => { rowOf(p, "file-write").rawText = "true"; }, `${DC_PLUGIN}write_file`, { path: "docs/x.md", content: "c" });
  assert.deepEqual(write.modes, [false], "a Write row has no text to read: one judgment");
  assert.equal(write.lines.length, 1, "and the typo is still reported");
});

// A STRICT rawText true is only sound for destructive-sql: the replacement of `&`, `|` and `-` erases the flags every other shell rule matches
// (a row that set rawText true with other rules would silently lose --force, --no-verify, -A ...). So a shipped row with rawText true must be
// judged by destructive-sql alone, and a mutation of the table must be reported.
function rawTextRowProblems(pol) {
  return (pol.mcpAdapters ?? []).filter((a) => a.rawText === true).flatMap((a) =>
    Array.isArray(a.onlyRules) && a.onlyRules.length === 1 && a.onlyRules[0] === "destructive-sql"
      ? []
      : [`${a.id}: rawText is true but onlyRules is ${JSON.stringify(a.onlyRules)}, not exactly ["destructive-sql"]`]);
}

test("policy: every adapter row with rawText true is judged by destructive-sql alone (BREAKS: a row that is not, or loses its onlyRules, is reported)", () => {
  assert.deepEqual(rawTextRowProblems(policy), []);
  const strict = adapters().filter((a) => a.rawText === true).map((a) => a.id);
  assert.deepEqual(strict.sort(), [...SQL_ROW_IDS].sort(), "positive control: the check sees the four SQL rows (a loop over nothing is a silent green)");
  const mutations = {
    "a shell runner row gains rawText true": (p) => { p.mcpAdapters.find((a) => a.id === "terminal-run").rawText = true; },
    "a SQL row loses its onlyRules": (p) => { delete p.mcpAdapters.find((a) => a.id === "neon-sql").onlyRules; },
    "a SQL row gains a second rule": (p) => { p.mcpAdapters.find((a) => a.id === "prisma-sql").onlyRules = ["destructive-sql", "stash-pop"]; },
    "a SQL row is judged by another rule": (p) => { p.mcpAdapters.find((a) => a.id === "neon-sql-transaction").onlyRules = ["stash-pop"]; },
  };
  for (const [what, mutate] of Object.entries(mutations)) {
    const p = structuredClone(policy);
    mutate(p);
    assert.ok(rawTextRowProblems(p).length > 0, `BREAKS: ${what} must be reported, or the invariant is not checked`);
  }
});

test("SQL door (re-review): `|`, `&&`, `?|` and a leading minus are SQL operators, not chains: only `;` ends a statement on the SQL rows; the shell door keeps its boundaries", () => {
  const verdict = (shape, sql) => judge(shape.name, sqlInput(shape, sql), NORMAL).rule?.id;
  const guarded = [
    "UPDATE t SET a = b || c WHERE id = 1",
    "UPDATE users SET perms = perms | 4 WHERE id = 1",
    "UPDATE t SET r = r && int4range(1,2) WHERE id = 1",
    "UPDATE t SET ok = (doc ?| array['a']) WHERE id = 1",
    "UPDATE t SET e = -e WHERE id = 1",
    "UPDATE t SET balance = balance -fee WHERE id = 1",
    "UPDATE t SET c = c -c WHERE id = 1",
    "DELETE FROM t WHERE flags & 4 = 4",
    "DELETE FROM leads /* a | b && c -c */ WHERE id = 1",
  ];
  for (const shape of SQL_SHAPES) {
    for (const sql of guarded) assert.equal(verdict(shape, sql), undefined, `${shape.name} should ALLOW ${JSON.stringify(sql)} (an operator before the WHERE is not a statement boundary)`);
    // a statement ends at `;`, so a later WHERE does not rescue a bare write, with or without operators around it
    for (const sql of ["DELETE FROM leads; SELECT 1 WHERE true", "UPDATE t SET a = 1; SELECT * FROM t WHERE x", "UPDATE users SET perms = perms | 4", "DELETE FROM leads -- a | b\n"]) {
      assert.equal(verdict(shape, sql), "destructive-sql", `${shape.name} should DENY ${JSON.stringify(sql)}`);
    }
  }
  for (const sql of guarded.slice(0, 5)) allowed(run(SQL_RUN.name, SQL_RUN.input(sql)), `real hook, run_sql ${sql}`);
  // the shell door is unchanged: the same text typed into psql is still cut at the shell operators (documented false positive), and a chain still cannot rescue a bare write
  denied(run("Bash", { command: `psql -c "UPDATE users SET perms = perms | 4 WHERE id = 1"` }), "destructive-sql", "shell door: a lone | ends the scan (documented false positive)");
  denied(run("Bash", { command: `psql -c "DELETE FROM leads" && psql -c "SELECT 1 WHERE true"` }), "destructive-sql", "shell door: && ends the statement");
  allowed(run("Bash", { command: `psql -c "UPDATE t SET a = b || c WHERE id = 1"` }), "shell door: || is concatenation, not a boundary");
});

test("onlyRules (re-review): the whole-field cap goes to exactly [\"destructive-sql\"] only, and every id must be a rule that can judge the row's tool", (t) => {
  const big = `SELECT '${"x".repeat(30_000)}'`;
  const lines = [];
  const adapt = (mutate, name = SQL_RUN.name, input = SQL_RUN.input(big)) => {
    const p = structuredClone(policy);
    mutate(p);
    lines.length = 0;
    const calls = engine.adaptToolCall(name, input, NORMAL, p, (l) => lines.push(l));
    return { vias: calls.map((c) => c.via), onlyRules: calls[0]?.onlyRules, lines: [...lines] };
  };
  const real = adapt(() => {});
  assert.deepEqual(real.vias, ["neon-sql.sql"], "control: the shipped rows judge a 30,000-character SQL field whole");
  // a valid onlyRules that is not exactly destructive-sql is honoured but keeps FIELD_CAP (the bounded-and-anchored argument is specific to that rule)
  for (const list of [["stash-pop"], ["destructive-sql", "stash-pop"], ["stash-pop", "destructive-sql"]]) {
    const r = adapt((p) => sqlRowsOf(p).forEach((a) => { a.onlyRules = list; }));
    assert.deepEqual(r.vias, ["neon-sql.sql#head", "neon-sql.sql#tail"], `onlyRules ${JSON.stringify(list)} must not lift the field cap`);
    assert.deepEqual(r.onlyRules, list, `onlyRules ${JSON.stringify(list)} is still honoured`);
    assert.deepEqual(r.lines, [], "and it is valid: nothing is reported");
  }
  // an id that cannot judge a Bash row (secret-file-write is Write-only; night-shift-no-judge-edits is Write-only too) is rejected and reported, so a typo cannot make a row judge nothing
  for (const list of [["secret-file-write"], ["destructive-sql", "secret-file-write"], ["night-shift-no-judge-edits"]]) {
    const r = adapt((p) => sqlRowsOf(p).forEach((a) => { a.onlyRules = list; }));
    assert.equal(r.onlyRules, undefined, `onlyRules ${JSON.stringify(list)} names a rule that cannot judge a Bash row: ignored, every rule applies`);
    assert.ok(r.lines.some((l) => /onlyRules ignored, every rule applies/.test(l) && /can judge/.test(l)), `reported: ${r.lines.join(" | ")}`);
    assert.deepEqual(r.vias, ["neon-sql.sql#head", "neon-sql.sql#tail"], "ignored means the full-rule cap too");
  }
  // and the other way round: a Bash-only rule on a Write row
  const file = adapt((p) => { p.mcpAdapters.find((a) => a.id === "file-write").onlyRules = ["destructive-sql"]; }, `${DC_PLUGIN}write_file`, { path: "docs/x.md", content: "c" });
  assert.equal(file.onlyRules, undefined, "destructive-sql cannot judge a Write row: ignored");
  assert.ok(file.lines.some((l) => /can judge/.test(l)), `reported: ${file.lines.join(" | ")}`);
  // through the real hook: the ignored list means every rule applies, so SQL that mentions a shell command is denied again (visible, loud, fail toward denial)
  withTree((p) => sqlRowsOf(p).forEach((a) => { a.onlyRules = ["secret-file-write"]; }), (hook) => {
    const r = run(SQL_RUN.name, SQL_RUN.input(P2F_PAYLOADS[3][0]), WORKTREE, hook);
    denied(r, "stash-pop", "a typo'd onlyRules must not make the row judge nothing");
    assert.match(r.err, /onlyRules ignored, every rule applies/);
  });
  t.diagnostic("onlyRules: exact-list cap, Bash/Write capability checked, both directions");
});

test("P2-g: a SQL field is judged WHOLE up to SQL_FIELD_CAP characters (a statement in the middle of 900,000 is denied) and sliced only beyond it; other rows keep FIELD_CAP", () => {
  assert.equal(engine.SQL_FIELD_CAP, 1_000_000, "policy.mjs must export SQL_FIELD_CAP");
  const mid = `${"x".repeat(450_000)} DROP TABLE leads; ${"x".repeat(450_000)}`;
  const whole = engine.adaptToolCall(SQL_RUN.name, SQL_RUN.input(mid), NORMAL, policy);
  assert.deepEqual(whole.map((c) => c.via), ["neon-sql.sql"], "one whole judgment, no #head or #tail");
  denied(run(SQL_RUN.name, SQL_RUN.input(mid)), "destructive-sql", "a statement in the middle of a 900,000-character field");
  const huge = `${"x".repeat(600_000)} DROP TABLE leads; ${"x".repeat(600_000)}`;
  assert.deepEqual(engine.adaptToolCall(SQL_RUN.name, SQL_RUN.input(huge), NORMAL, policy).map((c) => c.via), ["neon-sql.sql#head", "neon-sql.sql#tail"]);
  allowed(run(SQL_RUN.name, SQL_RUN.input(huge)), "beyond SQL_FIELD_CAP the middle is not judged (documented slip window; a pin)");
  const terminal = engine.adaptToolCall(TERMINAL, { command: `${"x".repeat(30_000)} psql` }, NORMAL, policy);
  assert.deepEqual(terminal.map((c) => c.via), ["terminal-run.command#head", "terminal-run.command#tail"], "a row that runs every rule keeps FIELD_CAP");
});

test("G2 accepted limits, pinned (each fails the day it is fixed: update the README and this pin): chained searches, SQL comments and explain deny; MERGE ... DELETE, files and unlisted clients pass", () => {
  // chained read-only search that names a DB client and DELETE FROM: the chain defeats the read-only skip (workaround: two unchained searches)
  denied(run("Bash", { command: 'rg -n "DELETE FROM" apps/ | rg mysql' }), "destructive-sql", "a chained search naming a client");
  allowed(run("Bash", { command: 'rg -n "DELETE FROM" apps/' }), "the unchained search");
  allowed(run("Bash", { command: "rg mysql apps/" }), "the unchained client search");
  const verdict = (sql) => judge(SQL_RUN.name, SQL_RUN.input(sql), NORMAL).rule?.id;
  for (const sql of ["SELECT 1 -- drop table later", "-- delete from old rows\nSELECT 1", "SELECT 1 /* update leads set a = 1 */"]) assert.equal(verdict(sql), "destructive-sql", `words in a SQL comment deny: ${JSON.stringify(sql)}`);
  const explain = SQL_SHAPES.find((s) => leaf(s.name) === "explain_sql_statement");
  denied(run(explain.name, { sql: "DROP TABLE x", analyze: false }), "destructive-sql", "explain_sql_statement with analyze:false is judged too");
  assert.equal(verdict("MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE"), undefined, "MERGE ... WHEN MATCHED THEN DELETE is not parsed");
  for (const command of ["psql -f cleanup.sql", 'sqlcmd -Q "DELETE FROM leads"', 'sqlite3 app.db "DELETE FROM leads"']) allowed(run("Bash", { command }), `a file or an unlisted client word: ${command}`);
  // a commit message heredoc that talks about the SQL arms (the neutraliser only knows -m/-b/-t/--message/--title/--body with a quoted argument)
  denied(run("Bash", { command: "git commit -F - <<'EOF'\nnote: psql DELETE FROM leads is denied now\nEOF" }), "destructive-sql", "prose in a commit message heredoc");
});

test("destructive-sql documented limits, pinned (each fails the day it is fixed: update the README 'SQL limits' and this pin)", () => {
  const denies = (sql) => judge(SQL_RUN.name, SQL_RUN.input(sql), NORMAL).denied;
  // Not goals, they pass: any WHERE in the statement counts, a keyword split by a comment is not seen, MySQL multi-table forms are not parsed
  for (const sql of [
    "DELETE FROM leads WHERE true", "DELETE FROM leads WHERE 1 = 1", "DELETE FROM leads -- WHERE id = 1", "UPDATE leads SET note = 'where'", "DELETE/**/FROM leads",
    "WITH d AS (DELETE FROM leads RETURNING id) SELECT * FROM u WHERE u.id IN (SELECT id FROM d)",
    "DELETE t1 FROM t1 JOIN t2 ON t1.id = t2.id", "UPDATE a JOIN b ON a.id = b.a_id SET a.x = 1",
    "UPDATE t SET a = (SELECT b FROM u WHERE u.id = t.id)", "DROP DOMAIN d", "DROP PUBLICATION p", "DROP ROUTINE r", "DROP FOREIGN TABLE ft",
  ]) assert.equal(denies(sql), false, `not a goal, so it passes: ${JSON.stringify(sql)}`);
  // Accepted false positives, they deny: the safe direction, one line to ask the operator
  for (const sql of [
    "ALTER TABLE leads ALTER COLUMN note DROP NOT NULL", "UPDATE leads SET a = 1 ORDER BY id LIMIT 5", "UPDATE t SET a = 'x;y' WHERE id = 1",
    "INSERT INTO notes (body) VALUES ('please delete from the schedule')",
  ]) assert.equal(denies(sql), true, `accepted false positive, so it denies: ${JSON.stringify(sql)}`);
});

// Codex #3053 (P1): T-SQL makes FROM optional after DELETE and puts TOP (n) [PERCENT] before the table, so `DELETE dbo.leads` and
// `UPDATE TOP (100) PERCENT dbo.leads SET status = 1` have no arm. Decision (the manager's): NOT widened. A DELETE arm with an optional FROM also
// matches the DDL clause `ON DELETE CASCADE` (every foreign-key migration would be denied), nothing in this stack runs SQL Server (TiDB, Neon,
// Postgres), and another arm costs a full sweep and probe cycle. So they are pinned as known limits (allowed today, through the real hook with an
// Invoke-Sqlcmd client word), plus the allow-direction guard an optional-FROM fix would break. Each pin goes red under a mutation that makes the pattern
// catch it, so the pins are not vacuous; the two mutations are independent (the UPDATE pin does not move with the DELETE one).
const TSQL_CASES = [
  { tool: "PowerShell", command: 'Invoke-Sqlcmd -Query "DELETE FROM dbo.leads"', want: "deny", kind: "control" },
  { tool: "PowerShell", command: 'Invoke-Sqlcmd -Query "UPDATE dbo.leads SET status = 1"', want: "deny", kind: "control" },
  { tool: "PowerShell", command: 'Invoke-Sqlcmd -Query "DELETE dbo.leads WHERE id = 1"', want: "allow", kind: "control" },
  { tool: "PowerShell", command: 'Invoke-Sqlcmd -Query "DELETE dbo.leads"', want: "allow", kind: "delete-pin" },
  { tool: "Bash", command: `pwsh -Command "Invoke-Sqlcmd -Query 'DELETE dbo.leads'"`, want: "allow", kind: "delete-pin" },
  { tool: "PowerShell", command: 'Invoke-Sqlcmd -Query "UPDATE TOP (100) PERCENT dbo.leads SET status = 1"', want: "allow", kind: "update-pin" },
  { tool: "Bash", command: `psql -c "CREATE TABLE child (id int, parent_id int REFERENCES parent(id) ON DELETE CASCADE)"`, want: "allow", kind: "cascade-guard" },
  { tool: "Bash", command: `psql -c "ALTER TABLE child ADD CONSTRAINT fk FOREIGN KEY (parent_id) REFERENCES parent (id) ON DELETE CASCADE ON UPDATE CASCADE"`, want: "allow", kind: "cascade-guard" },
];
/** The cases whose verdict is not the expected one when the REAL hook at `hook` judges them. */
function tsqlMisses(hook) {
  return TSQL_CASES.filter(({ tool, command, want }) => {
    const r = run(tool, { command }, NORMAL, hook);
    const got = r.code === 0 ? "allow" : r.code === 2 && /BLOCKED by repo policy: destructive-sql(?![\w-])/.test(r.err) ? "deny" : `exit ${r.code}`;
    return got !== want;
  });
}

test("T-SQL: `DELETE dbo.leads` and `UPDATE TOP (n) PERCENT ...` are known limits, pinned (each fails the day it is fixed); `ON DELETE CASCADE` still passes (BREAKS: an optional FROM or a TOP arm goes red)", () => {
  assert.deepEqual(tsqlMisses(HOOK).map((c) => c.command), [], "the shipped pattern: controls, pinned limits and the cascade guard all hold");
  const kinds = (cases) => [...new Set(cases.map((c) => c.kind))].sort();
  const mutated = (from, to) => (p) => {
    const rule = p.rules.find((r) => r.id === "destructive-sql");
    assert.equal(rule.pattern.split(from).length, 2, `the mutation anchor ${from} must occur exactly once in the pattern`);
    rule.pattern = rule.pattern.split(from).join(to);
  };
  // M1: the fix the manager declined, an optional FROM. The DELETE pin and BOTH cascade guards must go red (the guards are the false positive it would add); the UPDATE pin must not move
  const optionalFrom = withTree(mutated(String.raw`FROM\b(?!`, String.raw`(?:FROM\b)?(?!`), tsqlMisses);
  assert.deepEqual(kinds(optionalFrom), ["cascade-guard", "delete-pin"], `an optional FROM must flip the DELETE pin and the cascade guard, got ${JSON.stringify(optionalFrom.map((c) => c.command))}`);
  // M2: a TOP (n) [PERCENT] modifier on UPDATE. Only the UPDATE pin goes red
  const topModifier = withTree(mutated(String.raw`(?:(?:ONLY|LOW_PRIORITY|IGNORE)`, String.raw`(?:(?:ONLY|LOW_PRIORITY|IGNORE|TOP\s*\(\s*\d+\s*\)(?:\s+PERCENT)?)`), tsqlMisses);
  assert.deepEqual(kinds(topModifier), ["update-pin"], `a TOP modifier must flip only the UPDATE pin, got ${JSON.stringify(topModifier.map((c) => c.command))}`);
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
  }, (src) => src.replace("if (Array.isArray(v)) return arraySlices(v, report, cap);", "if (false) return [];"));
});
