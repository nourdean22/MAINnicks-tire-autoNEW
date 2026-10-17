/**
 * Policy engine — Agent OS v1 (2026-08-04, matching layer rebuilt after the
 * 2026-08-04 red-team proved 22 end-to-end bypasses + 7 false positives).
 *
 * Pure, dependency-free evaluation shared by the PreToolUse hook and the canaries.
 * The canaries import `evaluate()` directly — the DECISION lives here, testable.
 *
 * Three mechanisms fix what plain substring regexes got wrong:
 *
 *  1. __GIT__ macro — git accepts global options BETWEEN `git` and the verb
 *     (`git -C <path> push …`, `git -c k=v push …`), which defeated every
 *     git rule at once. Rules write `__GIT__push` and loadPolicy() expands the
 *     macro to a global-option-tolerant stem, once, in one place.
 *
 *  2. Mention ≠ execution — `git commit -m "docs: forbid git push origin main"`
 *     must not be blocked by push-to-main. preprocessCommand() replaces the
 *     QUOTED ARGUMENT of message/title/body-style flags with <ARG> before any
 *     command rule runs. Only those flags: a quoted string after `sh -c` is
 *     very much execution and is left untouched.
 *
 *  3. Read-only mention scan — a single unchained search/print command
 *     (`rg -n -- "--no-verify" scripts/`, `git log --grep "reset --hard"`)
 *     cannot execute anything; command rules are skipped for it. Any chaining
 *     character (; & | backtick newline $() disables the skip — and so does a
 *     `>` redirect, which turns a read into a write (2026-09-15).
 *
 * Rule shapes (config/agent-os/policy.json):
 *   pattern             — regex vs the (preprocessed) shell command string
 *   pathPattern         — regex vs tool_input.file_path / notebook_path (Write/Edit/NotebookEdit)
 *   onlyWhenCwdMatches  — extra guard: rule applies only when cwd matches
 */
import { lstatSync, opendirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const POLICY_PATH = resolve(ROOT, "config", "agent-os", "policy.json");

// Global-option-tolerant `git <verb>` stem. Covers the option forms an agent
// plausibly emits: -C <path>, -c k=v, --git-dir[=x], --work-tree[=x],
// --namespace[=x], --exec-path[=x], --no-pager, -p/-P, --no-optional-locks.
const GIT_STEM =
  String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|-[pP]\b|--(?:git-dir|work-tree|exec-path|namespace)(?:=\S+)?|--no-pager\b|--no-optional-locks\b|--literal-pathspecs\b))*\s+`;

export function loadPolicy(path = POLICY_PATH) {
  const policy = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(policy.rules)) throw new Error("policy.json: 'rules' must be an array");
  for (const rule of policy.rules) {
    if (rule.pattern) rule.pattern = rule.pattern.replaceAll("__GIT__", GIT_STEM);
  }
  return policy;
}

/**
 * Neutralize command text that is DATA, not execution.
 * @returns {string|null} the command to match, or null to skip command rules entirely.
 */
export function preprocessCommand(command) {
  // 2026-09-15 (Codex #2335 P1): an output redirect is a WRITE, so `>` ends
  // the read-only skip too. `cat evil.json > config/agent-os/policy.json`
  // started with `cat`, contained no chain character, and skipped every
  // command rule — a judge could be overwritten through the one path the
  // engine had declared harmless.
  const chained = /[;&|`\n>]|\$\(/.test(command);
  // A single, unchained read-only tool invocation is mention, not execution.
  if (
    !chained &&
    /^\s*(?:rg|grep|egrep|fgrep|findstr|Select-String|cat|head|tail|less|git\s+grep|git\s+log|git\s+show|git\s+diff)\b/.test(
      command,
    )
  ) {
    return null;
  }
  // Message/title/body arguments are always data to the CLI that receives them.
  // Covers normal quoting AND PowerShell here-strings (-m @'…'@ / -m @"…"@) — the
  // hook blocked its OWN commit message discussing `prisma migrate reset` before
  // the here-string form was added (2026-08-04).
  return command
    .replace(
      /(\s(?:-m|-b|-t|--message|--title|--body)(?:=|\s+))(@'[\s\S]*?'@|@"[\s\S]*?"@)/g,
      "$1<ARG>",
    )
    .replace(
      /(\s(?:-m|-b|-t|--message|--title|--body)(?:=|\s+))("(?:\\.|[^"\\])*"|'[^']*')/g,
      "$1<ARG>",
    );
}

const SHELL_METACHARS = /[&|-]/g;

/**
 * @returns {{denied: boolean, rule?: object}} — the FIRST matching rule wins.
 */
export function evaluate({ toolName, command = "", filePath = "", cwd = "", skipRules, onlyRules, rawText }, policy) {
  // rawText comes only from a validated mcpAdapters row: the text is SQL, not a shell command, so the shell neutraliser
  // (it erases the quoted argument after -m/-b/-t/--message/--title/--body, which in SQL can hold statements) and the
  // read-only-search skip do not apply to it. Nor do the shell's own metacharacters: `&`, `|` and `-` end no statement
  // in SQL (`a || b`, `perms | 4`, `r && range`, `a ?| b`, `SET e = -e`), so they are replaced by a neutral character
  // that is non-word like them (every `\b` keeps its meaning) and only `;` ends a statement on these rows.
  const processed = rawText === true ? command.replace(SHELL_METACHARS, "\u0001") : command ? preprocessCommand(command) : command;

  for (const rule of policy.rules) {
    // skipRules and onlyRules come only from a validated mcpAdapters row (exceptRules, onlyRules), never from tool input
    if (Array.isArray(skipRules) && skipRules.includes(rule.id)) continue;
    if (Array.isArray(onlyRules) && !onlyRules.includes(rule.id)) continue;
    if (Array.isArray(rule.tools) && !rule.tools.includes(toolName)) continue;

    if (rule.onlyWhenCwdMatches) {
      // Normalize separators so one pattern covers win32 and posix.
      const normalized = String(cwd).replace(/\\/g, "/");
      if (!new RegExp(rule.onlyWhenCwdMatches.replace(/\\\\/g, "/"), "i").test(normalized)) continue;
    }

    if (rule.pattern && processed !== null) {
      if (new RegExp(rule.pattern, rule.flags ?? "").test(processed)) return { denied: true, rule };
    }
    if (rule.pathPattern && filePath) {
      const p = String(filePath).replace(/\\/g, "/");
      if (new RegExp(rule.pathPattern.replace(/\\\\/g, "/"), rule.flags ?? "").test(p)) {
        return { denied: true, rule };
      }
    }
  }
  return { denied: false };
}

// -- Lane dispatches (2026-10-16, job session-workflow-upgrade H) ---------------------------------
// An Agent (or legacy Task) call carries structured fields, not a command. It is summarised into one judged line
// that the `lane-dispatch-brief` rule matches, so the rule keeps the engine's shape (pattern + deny/allow examples):
//   lane-dispatch type=<lane> model=<value|-> brief=<the brief file token|no> model-effort-line=<yes|no>
// A brief FILE is a whitespace-free token whose basename contains "brief" and ends .md (brief-3100.md,
// lane-brief-v2.md, C:\...\x-brief.md); the word "brief" in prose and a URL (https://.../brief.md) are not.
// Non-lane agents get a line no rule matches.
function briefFile(prompt) {
  for (const raw of prompt.split(/[\s"'`<>()[\]{},;]+/)) {
    const tok = raw.replace(/[.:!?]+$/, "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tok)) continue; // a URL, not a file
    if (/brief[\w.-]*\.md$/i.test(tok.split(/[\\/]/).pop() ?? "")) return tok;
  }
  return null;
}
export function agentDispatchCall(toolName, input, cwd) {
  if (toolName !== "Agent" && toolName !== "Task") return null;
  const type = String(input?.subagent_type ?? "").trim().replace(/\s+/g, "_");
  const prompt = String(input?.prompt ?? "");
  const model = String(input?.model ?? "").trim().replace(/\s+/g, "_");
  const command = /^lane-/i.test(type)
    ? `lane-dispatch type=${type} model=${model || "-"} brief=${briefFile(prompt) ?? "no"} model-effort-line=${/MODEL\s*\/\s*EFFORT/.test(prompt) ? "yes" : "no"}`
    : `agent type=${type || "-"}`;
  return { toolName: "Agent", command, filePath: "", cwd };
}

// -- MCP and native command-runner adapters (2026-10-15, job guard-mcp-coverage) -----------------
// Every rule carries a `tools` allowlist, so the same forbidden command delivered through a tool
// that runs commands or writes files but is not Bash/PowerShell/Write/Edit/NotebookEdit was never
// judged. `mcpAdapters` in policy.json maps such a tool call onto the logical tool the rules already
// understand, so EVERY rule applies and no rule text is duplicated:
//   { id, toolPattern, as: "Bash" | "Write", commandFields | pathFields, cwdField? }
// or, for the infra mutation tools (2026-10-15, job infra-deny-by-name), a Bash row with `nameAsText: true`: the judged text is the TOOL NAME.
// Only the NAMED fields are read. Content, old_string and every other string field are never
// scanned: that would block Gmail, Linear and any other tool that merely carries text. A named field may hold
// a string or a LIST of strings (each element judged on its own, see ARRAY_MAX).
const NATIVE_TOOLS = new Set(["Bash", "PowerShell", "Write", "Edit", "NotebookEdit"]);

// A forbidden command is short; a multi-megabyte field is a paste. A row that runs EVERY rule judges at most FIELD_CAP
// characters of a field: some rules backtrack (a scan to the end of the command from many starts) and a hook timeout
// fails OPEN silently. A longer field is judged as its head and its tail, EACH ON ITS OWN: joining them would build a
// token sequence the field never held. A row whose onlyRules is exactly ["destructive-sql"] runs that rule alone, and its
// every scan is anchored or bounded and matches each character one way (README "How destructive-sql reads SQL"; the hyphen
// and ambiguity axes in mcpCoverage.test.mjs pin it), so such a field is judged WHOLE up to SQL_FIELD_CAP
// (= ARRAY_CHAR_BUDGET) characters and sliced only beyond that. Any other onlyRules list keeps FIELD_CAP: the argument is
// specific to that one rule.
export const FIELD_CAP = 20000;
// move_file of a DIRECTORY: names below it are judged as paths written at the destination.
export const WALK_MAX_ENTRIES = 2000;
export const WALK_MAX_DEPTH = 6;
const PROBLEM_LINE = "[agent-os] pretool MCP adapter problem (that row is skipped):";
const WALK_CAP_LINE = "[agent-os] pretool move_file: directory too large to inspect fully, descendants beyond the cap not judged";

function stringField(input, name) {
  const v = typeof name === "string" ? input[name] : undefined;
  return typeof v === "string" ? v : "";
}

// A field that holds a LIST of statements (Neon run_sql_transaction.sql_statements) is judged element by element,
// each on its own: joining them would build a command the field never held. Elements are judged in order until
// ARRAY_MAX elements or ARRAY_CHAR_BUDGET characters in total (after per-element slicing) have been judged: each
// element is a judgment through the row's rules (the SQL rows run destructive-sql alone) and a hook timeout fails OPEN
// silently, so the budget bounds the time (measured numbers: README "How destructive-sql reads SQL", Cost) while still
// covering a real transaction. When the budget runs out ONE stderr line says the rest was not judged. Non-string elements
// (null, numbers, objects, nested lists) are ignored: the tool's own schema rejects them.
export const ARRAY_MAX = 2000;
export const ARRAY_CHAR_BUDGET = 1_000_000;
export const SQL_FIELD_CAP = ARRAY_CHAR_BUDGET;
const WHOLE_FIELD_RULES = ["destructive-sql"];
// A row that judges the TOOL NAME (nameAsText) and runs infra-mutation-tool alone judges the name whole up to SQL_FIELD_CAP: that rule is one
// anchored alternation of literals after a single `.+` (linear, each character consumed one way: pinned by the long-name sweep in
// mcpInfraDeny.test.mjs). A real tool name is far shorter; the cap only decides what happens to an absurd one (whole, never head and tail).
const WHOLE_NAME_RULES = ["infra-mutation-tool"];
const ARRAY_CAP_LINE = "[agent-os] pretool MCP adapter: array field over the judging budget, elements beyond it not judged";

/** One string as the slices to judge: itself within `cap`, else its head and its tail. `at` extends the provenance. */
function textSlices(text, at, cap) {
  if (text === "") return [];
  if (text.length <= cap) return [{ text, part: at }];
  const half = cap / 2;
  return [
    { text: text.slice(0, half), part: `${at}#head` },
    { text: text.slice(-half), part: `${at}#tail` },
  ];
}

function arraySlices(list, report, cap) {
  const out = [];
  let chars = 0;
  for (let i = 0; i < list.length; i++) {
    if (i >= ARRAY_MAX) return report(ARRAY_CAP_LINE), out;
    if (typeof list[i] !== "string") continue;
    // An element is judged within what is left of the budget: whole if it fits, else as head and tail slices of the
    // remainder (a huge statement after a small one is judged, not skipped), and then nothing is left. In order, never
    // a later small element after a skipped big one.
    const room = ARRAY_CHAR_BUDGET - chars;
    if (room < 2) return report(ARRAY_CAP_LINE), out;
    const limit = Math.min(cap, room);
    const slices = textSlices(list[i], `[${i}]`, limit);
    chars += slices.reduce((n, s) => n + s.text.length, 0);
    out.push(...slices);
    if (list[i].length > limit && limit === room) return report(ARRAY_CAP_LINE), out;
  }
  return out;
}

/** A field's text as the slices to judge: a string, or each string element of a list. */
function fieldSlices(input, name, report, cap) {
  const v = typeof name === "string" ? input[name] : undefined;
  if (Array.isArray(v)) return arraySlices(v, report, cap);
  return typeof v === "string" ? textSlices(v, "", cap) : [];
}

// Text typed into a running process may be bare SQL for a psql REPL that an earlier call started, and the SQL text
// tools (Neon run_sql, Prisma execute_sql_query ...) receive bare SQL too. destructive-sql needs a client word on
// the line. clientHint supplies that word, except for a single read-only search (rg, grep, cat ...), which stays a
// search: mention is not execution. A rawText row (the SQL text tools) always gets the hint: its text is SQL, and
// SQL that merely STARTS like a search command is still SQL.
function hinted(row, text, raw) {
  return row.clientHint && (raw || preprocessCommand(text) !== null) ? `${row.clientHint} ${text}` : text;
}

const EXEMPTION_LINE = "[agent-os] pretool MCP adapter problem (exemption ignored, every rule applies):";

// exceptRules lists the rule ids a row's calls are NOT judged by. Every id must exist in policy.json. A
// malformed list or an unknown id (a typo) is reported and the WHOLE exemption is ignored, so the rule
// applies: a mistake here can only add denials, never silently switch a rule off.
function exemption(row, policy, report) {
  if (row.exceptRules === undefined) return undefined;
  const list = row.exceptRules;
  const known = new Set((Array.isArray(policy.rules) ? policy.rules : []).map((r) => r.id));
  if (!Array.isArray(list) || list.length === 0 || list.some((id) => typeof id !== "string" || !known.has(id))) {
    report(`${EXEMPTION_LINE} adapter ${JSON.stringify(row.id)} exceptRules ${JSON.stringify(list)} must list ids of rules that exist in policy.json`);
    return undefined;
  }
  return list;
}

const ONLY_LINE = "[agent-os] pretool MCP adapter problem (onlyRules ignored, every rule applies):";
const RAW_LINE = "[agent-os] pretool MCP adapter problem (rawText malformed, judged both as a shell command and as raw SQL):";

// onlyRules is the reverse of exceptRules: the ONLY rule ids a row's calls are judged by, so a rule added later does not
// silently apply to text that is not a shell command (the SQL text tools: onlyRules ["destructive-sql"]). Same posture
// as exemption(): a malformed list, an unknown id, or an id of a rule that cannot judge this row's tool (secret-file-write
// is Write-only: on a Bash row it would judge nothing, so a typo could switch the row off) is reported and the field
// IGNORED, so every rule applies. A mistake here can only add denials.
function onlyList(row, policy, report) {
  if (row.onlyRules === undefined) return undefined;
  const list = row.onlyRules;
  const rules = new Map((Array.isArray(policy.rules) ? policy.rules : []).map((r) => [r.id, r]));
  const canJudge = (rule) => rule && (!Array.isArray(rule.tools) || rule.tools.includes(row.as)) && Boolean(row.as === "Write" ? rule.pathPattern : rule.pattern);
  if (!Array.isArray(list) || list.length === 0 || list.some((id) => typeof id !== "string" || !canJudge(rules.get(id)))) {
    report(`${ONLY_LINE} adapter ${JSON.stringify(row.id)} onlyRules ${JSON.stringify(list)} must list ids of rules that exist in policy.json and can judge a ${row.as} row`);
    return undefined;
  }
  return list;
}

// rawText says how a row's text is READ. Absent or false: as a shell command (the neutraliser, the read-only-search skip, every
// rule of the row). The strict boolean true on a Bash row: as raw SQL (no neutraliser, no search skip, `&`, `|` and `-` replaced),
// which is only sound for destructive-sql, so a policy-level canary requires every rawText:true row to have onlyRules exactly
// ["destructive-sql"]. A value that is declared but malformed (a string "true", 1, null) on a Bash row is reported and judged BOTH
// ways, as a shell command AND as raw SQL, and denied if EITHER denies: ignoring it would switch the neutraliser on (it erases a
// quoted span), reading it as true alone would erase the flags of a shell row (`--force`, `--no-verify`, `-A`), both FEWER
// denials, so a typo can only add denials, the same posture as onlyRules. On a Write row it has no meaning: reported, no effect.
// Returns the readings to judge, in order: one call per reading, each carrying its own rawText.
function rawTextModes(row, report) {
  if (row.rawText === undefined || (row.rawText === false && row.as === "Bash")) return [false];
  if (row.rawText === true && row.as === "Bash") return [true];
  report(`${RAW_LINE} adapter ${JSON.stringify(row.id)} rawText ${JSON.stringify(row.rawText)} must be the boolean true or false on a Bash row`);
  return row.as === "Bash" ? [false, true] : [false];
}

const NAME_LINE = "[agent-os] pretool MCP adapter problem (nameAsText malformed, the tool name is judged):";

// nameAsText says WHAT a Bash row judges. Absent or false: the named fields. The strict boolean true: the TOOL NAME itself (the infra tools carry
// no command text: the name is the operation). A declared but malformed value (a string "true", 1, null) on a Bash row is reported and the name is
// judged anyway, toward denial, like rawText and onlyRules: ignoring it would drop a row whose whole job is the name. On a Write row it has no
// meaning: reported, no effect. Returns whether the tool name is judged.
function judgesName(row, report) {
  if (row.nameAsText === undefined || row.nameAsText === false) return false;
  if (row.nameAsText === true && row.as === "Bash") return true;
  report(`${NAME_LINE} adapter ${JSON.stringify(row.id)} nameAsText ${JSON.stringify(row.nameAsText)} must be the boolean true or false on a Bash row`);
  return row.as === "Bash";
}

// The input fields a row reads. A row that judges the tool name may carry a field list as well (both are judged); a declared list that is not a
// non-empty list of names is reported and IGNORED, so the name is still judged: dropping the whole row over a bad optional list would switch off
// the one thing the row is for.
function fieldNamesOf(row, byName, report) {
  if (row.as === "Write") return row.pathFields;
  const list = row.commandFields;
  if (!byName) return list;
  if (list === undefined) return [];
  if (Array.isArray(list) && list.length > 0 && list.every((f) => typeof f === "string" && f)) return list;
  report(`${NAME_LINE} adapter ${JSON.stringify(row.id)} commandFields ${JSON.stringify(list)} must be a non-empty list of field names: ignored, the tool name is still judged`);
  return [];
}

/**
 * Names of the FILES below a directory, "/"-separated and relative to it (move_file of a directory
 * writes all of them to the new place, so the path rules must see them). Names only, read-only,
 * breadth-first, never follows a symlink or junction, bounded by WALK_MAX_ENTRIES and WALK_MAX_DEPTH.
 * ANY filesystem error returns nothing (fail open) and nothing throws.
 */
function directoryFiles(source, cwd, report) {
  try {
    const root = resolve(typeof cwd === "string" && cwd ? cwd : ".", source);
    if (!lstatSync(root).isDirectory()) return [];
    const files = [];
    const queue = [{ dir: root, rel: "", depth: 0 }];
    let seen = 0;
    let capped = false;
    walk: while (queue.length) {
      const { dir, rel, depth } = queue.shift();
      // opendir hands out one entry at a time, so a directory of a million entries costs 2,000 reads, not a million
      const handle = opendirSync(dir);
      try {
        for (let ent = handle.readSync(); ent !== null; ent = handle.readSync()) {
          if (seen >= WALK_MAX_ENTRIES) {
            capped = true;
            break walk;
          }
          seen++;
          const name = rel ? `${rel}/${ent.name}` : ent.name;
          const abs = join(dir, ent.name);
          if (ent.isDirectory() && !ent.isSymbolicLink() && !lstatSync(abs).isSymbolicLink()) {
            if (depth + 1 < WALK_MAX_DEPTH) queue.push({ dir: abs, rel: name, depth: depth + 1 });
            else capped = true;
          } else {
            files.push(name);
          }
        }
      } finally {
        handle.closeSync();
      }
    }
    if (capped) report(WALK_CAP_LINE);
    return files;
  } catch {
    return [];
  }
}

/** @returns {string} what is wrong with an adapter row, or "" when it is usable. */
function adapterProblem(a) {
  if (!a || typeof a !== "object") return "row is not an object";
  // new RegExp(undefined) matches EVERY tool name, so a row with no pattern must never reach it
  if (typeof a.toolPattern !== "string" || !a.toolPattern) return "toolPattern must be a non-empty string";
  if (a.as !== "Bash" && a.as !== "Write") return "'as' must be \"Bash\" or \"Write\"";
  const fields = a.as === "Write" ? a.pathFields : a.commandFields;
  // A row that judges the tool name needs no field list, and a bad one never costs the row (toward denial): see fieldNamesOf().
  const byName = a.as === "Bash" && a.nameAsText !== undefined && a.nameAsText !== false;
  if (!byName && (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => typeof f === "string" && f))) {
    return `${a.as === "Write" ? "pathFields" : "commandFields"} must be a non-empty list of field names`;
  }
  if (a.clientHint !== undefined && (a.as !== "Bash" || typeof a.clientHint !== "string" || !a.clientHint)) {
    return "clientHint must be a non-empty string on a Bash row";
  }
  if (a.skipWhenTrue !== undefined && (!Array.isArray(a.skipWhenTrue) || !a.skipWhenTrue.every((k) => typeof k === "string" && k))) {
    return "skipWhenTrue must be a list of field names";
  }
  if (a.expandDirectory !== undefined) {
    const e = a.expandDirectory;
    if (a.as !== "Write" || !e || typeof e.from !== "string" || !e.from || typeof e.to !== "string" || !e.to) {
      return "expandDirectory needs {from, to} field names on a Write row";
    }
  }
  return "";
}

/**
 * Map an MCP or native runner / file-writer tool call onto Bash or Write judgments for evaluate().
 * Never throws on odd input. A malformed row is reported through `report` (a complete stderr line)
 * and skipped, so one bad row costs only that row.
 * @returns {Array<{toolName:string, command:string, filePath:string, cwd:string, via:string}>|null}
 *   null = no adapter claims this tool: the caller judges it as itself (always so for native tools).
 */
export function adaptToolCall(toolName, toolInput, cwd, policy, report = () => {}) {
  if (NATIVE_TOOLS.has(toolName) || !Array.isArray(policy?.mcpAdapters)) return null;
  const input = toolInput !== null && typeof toolInput === "object" ? toolInput : {};
  const calls = [];
  let claimed = false;
  for (const a of policy.mcpAdapters) {
    const problem = adapterProblem(a);
    if (problem) {
      report(`${PROBLEM_LINE} adapter ${JSON.stringify(a?.id ?? "?")} skipped: ${problem}`);
      continue;
    }
    let hit;
    try {
      hit = new RegExp(a.toolPattern).test(String(toolName));
    } catch (err) {
      report(`${PROBLEM_LINE} adapter ${JSON.stringify(a.id)} skipped: toolPattern does not compile (${err?.message ?? err})`);
      continue;
    }
    if (!hit) continue;
    claimed = true;
    // A strict boolean true in one of these fields (dryRun) means the tool previews and writes nothing.
    // Truthy is not enough: "true", 1 and {} still judge.
    if ((a.skipWhenTrue ?? []).some((k) => input[k] === true)) continue;
    const asWrite = a.as === "Write";
    // The directory a command runs in: the session's, plus the tool's own cwd field when it names one. A
    // decoy value can add a judgment, never remove the session's. Rules the row is exempt from (exceptRules)
    // ride on every call it produces.
    const cwds = [cwd];
    const own = stringField(input, a.cwdField);
    if (own && own !== cwd) cwds.push(own);
    const skipRules = exemption(a, policy, report);
    const onlyRules = onlyList(a, policy, report);
    const rawModes = rawTextModes(a, report);
    // A row that runs destructive-sql alone may judge a field whole (SQL_FIELD_CAP); every other row keeps FIELD_CAP.
    const cap = onlyRules?.length === WHOLE_FIELD_RULES.length && onlyRules.every((id, i) => id === WHOLE_FIELD_RULES[i]) ? SQL_FIELD_CAP : FIELD_CAP;
    // A nameAsText row also judges the tool name itself (whole when only infra-mutation-tool runs, else head and tail like any field).
    const nameCap = onlyRules?.length === WHOLE_NAME_RULES.length && onlyRules.every((id, i) => id === WHOLE_NAME_RULES[i]) ? SQL_FIELD_CAP : FIELD_CAP;
    const byName = judgesName(a, report);
    // Slices are computed once, outside the cwd loop: a cap line is reported once per call, not once per cwd.
    const judged = [
      ...(byName ? textSlices(String(toolName), "", nameCap).map((s) => ({ f: "toolName", ...s })) : []),
      ...fieldNamesOf(a, byName, report).flatMap((f) => fieldSlices(input, f, report, cap).map((s) => ({ f, ...s }))),
    ];
    for (const c of cwds) {
      for (const { f, text, part } of judged) {
        for (const rawText of rawModes) {
          calls.push({
            toolName: asWrite ? "Write" : "Bash",
            command: asWrite ? "" : hinted(a, text, rawText),
            filePath: asWrite ? text : "",
            cwd: c,
            skipRules,
            onlyRules,
            rawText,
            via: `${a.id}.${f}${part}`,
          });
        }
      }
    }
    // Moving a directory writes every file below it to the destination.
    if (asWrite && a.expandDirectory) {
      const from = stringField(input, a.expandDirectory.from);
      const dest = stringField(input, a.expandDirectory.to).replace(/[\\/]+$/, "");
      if (from && dest) {
        for (const rel of directoryFiles(from, cwd, report)) {
          for (const c of cwds) {
            calls.push({ toolName: "Write", command: "", filePath: `${dest}/${rel}`, cwd: c, skipRules, onlyRules, via: `${a.id}.${a.expandDirectory.from}/*` });
          }
        }
      }
    }
  }
  return claimed ? calls : null;
}

export function formatDenial(rule) {
  return [
    `BLOCKED by repo policy: ${rule.id}`,
    "",
    `Why:  ${rule.why}`,
    `Do:   ${rule.fix}`,
    "",
    "This rule lives in config/agent-os/policy.json. There is no bypass flag —",
    "if it is genuinely wrong, change it in a PR where the diff is reviewable.",
  ].join("\n");
}
