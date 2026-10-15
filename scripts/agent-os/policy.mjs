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

/**
 * @returns {{denied: boolean, rule?: object}} — the FIRST matching rule wins.
 */
export function evaluate({ toolName, command = "", filePath = "", cwd = "", skipRules }, policy) {
  const processed = command ? preprocessCommand(command) : command;

  for (const rule of policy.rules) {
    // skipRules comes only from a validated mcpAdapters row (exceptRules), never from tool input
    if (Array.isArray(skipRules) && skipRules.includes(rule.id)) continue;
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

// -- MCP and native command-runner adapters (2026-10-15, job guard-mcp-coverage) -----------------
// Every rule carries a `tools` allowlist, so the same forbidden command delivered through a tool
// that runs commands or writes files but is not Bash/PowerShell/Write/Edit/NotebookEdit was never
// judged. `mcpAdapters` in policy.json maps such a tool call onto the logical tool the rules already
// understand, so EVERY rule applies and no rule text is duplicated:
//   { id, toolPattern, as: "Bash" | "Write", commandFields | pathFields, cwdField? }
// Only the NAMED fields are read. Content, old_string and every other string field are never
// scanned: that would block Gmail, Linear and any other tool that merely carries text.
const NATIVE_TOOLS = new Set(["Bash", "PowerShell", "Write", "Edit", "NotebookEdit"]);

// A forbidden command is short; a multi-megabyte field is a paste. The backtracking rules
// (destructive-sql rescans to the end of the text from every start) are quadratic on it, which would
// run the hook into its 10 s timeout, and a timeout fails OPEN silently. Judge the head and the tail
// instead, EACH ON ITS OWN: joining them would build a token sequence the field never held.
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

/** A field's text as the slices to judge: itself within the cap, else its head and its tail. */
function fieldSlices(input, name) {
  const v = stringField(input, name);
  if (v === "") return [];
  if (v.length <= FIELD_CAP) return [{ text: v, part: "" }];
  const half = FIELD_CAP / 2;
  return [
    { text: v.slice(0, half), part: "#head" },
    { text: v.slice(-half), part: "#tail" },
  ];
}

// Text typed into a running process may be bare SQL for a psql REPL that an earlier call started, and
// destructive-sql needs a client word on the line. clientHint supplies that word, except for a single
// read-only search (rg, grep, cat ...), which stays a search: mention is not execution.
function hinted(row, text) {
  return row.clientHint && preprocessCommand(text) !== null ? `${row.clientHint} ${text}` : text;
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
  if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => typeof f === "string" && f)) {
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
    for (const c of cwds) {
      for (const f of asWrite ? a.pathFields : a.commandFields) {
        for (const { text, part } of fieldSlices(input, f)) {
          calls.push({
            toolName: asWrite ? "Write" : "Bash",
            command: asWrite ? "" : hinted(a, text),
            filePath: asWrite ? text : "",
            cwd: c,
            skipRules,
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
            calls.push({ toolName: "Write", command: "", filePath: `${dest}/${rel}`, cwd: c, skipRules, via: `${a.id}.${a.expandDirectory.from}/*` });
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
