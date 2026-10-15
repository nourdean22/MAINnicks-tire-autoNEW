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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
export function evaluate({ toolName, command = "", filePath = "", cwd = "" }, policy) {
  const processed = command ? preprocessCommand(command) : command;

  for (const rule of policy.rules) {
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
// run the hook into its 10 s timeout, and a timeout fails OPEN silently. Judge head and tail instead.
export const FIELD_CAP = 20000;

function fieldText(input, name) {
  const v = typeof name === "string" ? input[name] : undefined;
  if (typeof v !== "string" || v === "") return "";
  return v.length <= FIELD_CAP ? v : `${v.slice(0, FIELD_CAP / 2)}\n${v.slice(-FIELD_CAP / 2)}`;
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
  return "";
}

/**
 * Map an MCP or native runner / file-writer tool call onto Bash or Write judgments for evaluate().
 * Never throws on odd input; a malformed row is reported through onError and skipped, so one bad
 * row costs only that row.
 * @returns {Array<{toolName:string, command:string, filePath:string, cwd:string, via:string}>|null}
 *   null = no adapter claims this tool: the caller judges it as itself (always so for native tools).
 */
export function adaptToolCall(toolName, toolInput, cwd, policy, onError = () => {}) {
  if (NATIVE_TOOLS.has(toolName) || !Array.isArray(policy?.mcpAdapters)) return null;
  const input = toolInput !== null && typeof toolInput === "object" ? toolInput : {};
  const calls = [];
  let claimed = false;
  for (const a of policy.mcpAdapters) {
    const problem = adapterProblem(a);
    if (problem) {
      onError(`adapter ${JSON.stringify(a?.id ?? "?")} skipped: ${problem}`);
      continue;
    }
    let hit;
    try {
      hit = new RegExp(a.toolPattern).test(String(toolName));
    } catch (err) {
      onError(`adapter ${JSON.stringify(a.id)} skipped: toolPattern does not compile (${err?.message ?? err})`);
      continue;
    }
    if (!hit) continue;
    claimed = true;
    const asWrite = a.as === "Write";
    // The directory a command runs in: the session's, plus the tool's own when it names one. A decoy
    // tool cwd can add a judgment but never remove the session's.
    const cwds = [cwd];
    const own = fieldText(input, a.cwdField);
    if (own && own !== cwd) cwds.push(own);
    for (const c of cwds) {
      for (const f of asWrite ? a.pathFields : a.commandFields) {
        const text = fieldText(input, f);
        if (!text) continue;
        calls.push({
          toolName: asWrite ? "Write" : "Bash",
          command: asWrite ? "" : text,
          filePath: asWrite ? text : "",
          cwd: c,
          via: `${a.id}.${f}`,
        });
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
