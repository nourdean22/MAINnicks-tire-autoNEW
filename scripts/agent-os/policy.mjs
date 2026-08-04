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
 *     character (; & | backtick newline $() disables the skip.
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
  const chained = /[;&|`\n]|\$\(/.test(command);
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
