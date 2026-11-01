/**
 * Policy canaries — Agent OS v1 (2026-08-04).
 *
 * Run by `pnpm agent:verify` (auto-discovered) and in CI. Node's built-in runner, no deps.
 *
 * The point of these is NOT "the regex compiles". It is:
 *   1. every rule actually DENIES the thing it claims to deny,
 *   2. every rule actually PERMITS the legitimate lookalike (false positives make agents
 *      route around the gate, which is worse than no gate),
 *   3. no rule can be added without both kinds of example — so a future rule cannot ship untested,
 *   4. known BYPASS shapes an agent would plausibly reach for are still caught.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluate, formatDenial, loadPolicy } from "./policy.mjs";

const policy = loadPolicy();

// Which tool a rule's examples should be evaluated against.
const toolFor = (rule) => (Array.isArray(rule.tools) ? rule.tools[0] : "Bash");
// Rules scoped to worktrees need a cwd that satisfies onlyWhenCwdMatches. A rule
// whose scope is narrower than "any worktree" (the night-shift rules, 2026-09-15)
// names the cwd its examples must be judged under via `cwdExample`.
const cwdFor = (rule) =>
  rule.cwdExample ??
  (rule.onlyWhenCwdMatches
    ? "C:/Users/nourd/NOURCITY/.claude/worktrees/repo-agent-os-architecture-6528d4"
    : "C:/Users/nourd/NOURCITY");

function check(rule, sample) {
  const isPath = Boolean(rule.pathPattern);
  return evaluate(
    {
      toolName: toolFor(rule),
      command: isPath ? "" : sample,
      filePath: isPath ? sample : "",
      cwd: cwdFor(rule),
    },
    policy,
  );
}

test("policy file is well formed", () => {
  assert.equal(policy.version, 2); // v2 = 2026-08-04 matching-layer rebuild (red-team response)
  assert.ok(policy.rules.length >= 8, `expected a meaningful rule set, got ${policy.rules.length}`);
  const ids = policy.rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "rule ids must be unique");
});

test("every rule is testable and documented — no untested rule can ship", () => {
  for (const rule of policy.rules) {
    assert.ok(rule.id, "rule missing id");
    assert.ok(rule.why?.length > 20, `${rule.id}: 'why' must explain the rule, not restate it`);
    assert.ok(rule.fix?.length > 10, `${rule.id}: 'fix' must tell the agent what to do instead`);
    assert.ok(rule.pattern || rule.pathPattern, `${rule.id}: needs pattern or pathPattern`);
    assert.ok(rule.denyExamples?.length >= 1, `${rule.id}: needs >=1 denyExamples`);
    assert.ok(rule.allowExamples?.length >= 1, `${rule.id}: needs >=1 allowExamples`);
  }
});

test("every denyExample is actually blocked, by its own rule", () => {
  for (const rule of policy.rules) {
    for (const sample of rule.denyExamples) {
      const res = check(rule, sample);
      assert.ok(res.denied, `${rule.id}: should have DENIED ${JSON.stringify(sample)}`);
      assert.equal(
        res.rule.id,
        rule.id,
        `${JSON.stringify(sample)} was denied by '${res.rule.id}', not '${rule.id}' — overlapping rules make the reason misleading`,
      );
    }
  }
});

test("every allowExample passes — false positives are a real cost", () => {
  for (const rule of policy.rules) {
    for (const sample of rule.allowExamples) {
      const res = check(rule, sample);
      assert.ok(
        !res.denied,
        `${rule.id}: should have ALLOWED ${JSON.stringify(sample)} but '${res.rule?.id}' blocked it`,
      );
    }
  }
});

test("bypass shapes an agent would plausibly try are still caught", () => {
  const cwd = "C:/Users/nourd/NOURCITY";
  const denied = (command, toolName = "Bash", extra = {}) =>
    evaluate({ toolName, command, cwd, filePath: "", ...extra }, policy).denied;

  // Whitespace and flag-order variants
  assert.ok(denied("git   push    origin    main"), "extra whitespace must not evade push-to-main");
  assert.ok(denied("git push --quiet origin main"), "an interposed flag must not evade push-to-main");
  assert.ok(denied("git push origin HEAD:main"), "refspec form must not evade push-to-main");

  // Git global options between `git` and the verb (red-team 2026-08-04: defeated EVERY git rule)
  assert.ok(denied("git -C /c/x push origin main"), "-C prefix must not evade push-to-main");
  assert.ok(denied("git --git-dir=.git push origin main"), "--git-dir prefix must not evade");
  assert.ok(denied("git -c core.editor=true reset --hard HEAD~1"), "-c prefix must not evade reset --hard");
  assert.ok(denied("git --no-pager -C . stash pop"), "stacked global options must not evade stash rule");

  // Implicit destinations resolve to the current branch — possibly main
  assert.ok(denied("git push"), "bare git push must be denied (implicit destination)");
  assert.ok(denied("git push origin HEAD"), "HEAD refspec must be denied (implicit destination)");

  // Quoted arguments are still live shell arguments
  assert.ok(denied('git push "origin" "main"'), "quoting the refspec must not evade");

  // sh -c wrapping: the -c ARGUMENT is execution, and must never be stripped as a message
  assert.ok(denied('sh -c "git push origin main"'), "sh -c wrapping must not evade");

  // Chained / wrapped commands — the deny must survive a compound line
  assert.ok(denied("cd /c/repo && git push origin main"), "chained && must not evade");
  assert.ok(denied("git fetch origin ; git push origin main"), "chained ; must not evade");
  assert.ok(denied("pnpm test && git add -A && git commit -m x"), "add -A mid-chain must not evade");

  // A read-only prefix must NOT disarm a chained mutation
  assert.ok(denied("rg TODO && git push origin main"), "read-only prefix + chain must not evade");

  // PowerShell is a separate tool name and must be covered too
  assert.ok(denied("git push origin main", "PowerShell"), "PowerShell tool must be covered");

  // Case variants on SQL
  assert.ok(denied("psql -c 'drop table leads'"), "lowercase SQL must not evade");

  // Path rule normalization: win32 separators must match the same as posix
  assert.ok(
    evaluate({ toolName: "Write", command: "", filePath: "apps\\statenour\\.env.local", cwd }, policy)
      .denied,
    "backslash paths must be normalized before matching",
  );
  // NotebookEdit uses notebook_path — the engine sees it as filePath (pretool maps it)
  assert.ok(
    evaluate({ toolName: "NotebookEdit", command: "", filePath: "apps/x/.env.local", cwd }, policy)
      .denied,
    "NotebookEdit env writes must be denied via the mapped path",
  );
});

test("mention is not execution — quoting a forbidden string as data passes", () => {
  const cwd = "C:/Users/nourd/NOURCITY";
  const allowed = (command) =>
    !evaluate({ toolName: "Bash", command, cwd, filePath: "" }, policy).denied;

  // Commit/PR messages that DISCUSS forbidden commands
  assert.ok(allowed('git commit -m "docs: forbid git push origin main"'), "commit message mentioning a push");
  assert.ok(allowed("git commit -m 'chore: use merge --ff-only, not git reset --hard'"), "message mentioning reset --hard");
  assert.ok(allowed('gh pr create --title "ban --no-verify" --body "adds a rule denying git add -A"'), "PR body mentioning rules");

  // Single unchained read-only commands searching for policy strings
  assert.ok(allowed('rg -n -- "--no-verify" scripts/'), "rg for a flag string");
  assert.ok(allowed('grep -rn "git push origin main" docs/'), "grep for a push string");
  assert.ok(allowed('git log --grep "reset --hard" --oneline'), "git log --grep");

  // PowerShell here-string messages (the hook blocked its OWN commit before this was covered)
  assert.ok(
    allowed("git commit -m @'\nchore: policy note\n\nmentions prisma migrate reset and --accept-data-loss as prose\n'@"),
    "here-string commit message mentioning destructive flags",
  );
});

test("the worktree install rule is scoped to worktrees, not the primary checkout", () => {
  const inWorktree = evaluate(
    {
      toolName: "Bash",
      command: "pnpm install",
      cwd: "C:/Users/nourd/NOURCITY/.claude/worktrees/foo",
      filePath: "",
    },
    policy,
  );
  const inPrimary = evaluate(
    { toolName: "Bash", command: "pnpm install", cwd: "C:/Users/nourd/NOURCITY", filePath: "" },
    policy,
  );
  assert.ok(inWorktree.denied, "pnpm install inside a junctioned worktree must be blocked");
  assert.ok(!inPrimary.denied, "pnpm install in the primary checkout is legitimate");
});

test("a denial message names the rule, the reason, and the alternative", () => {
  const rule = policy.rules.find((r) => r.id === "push-to-main");
  const msg = formatDenial(rule);
  assert.match(msg, /BLOCKED by repo policy: push-to-main/);
  assert.match(msg, /Why:/);
  assert.match(msg, /Do:/);
  assert.match(msg, /gh pr create/, "must point at the sanctioned path, not just say no");
});

test("unrelated everyday commands are never blocked", () => {
  const cwd = "C:/Users/nourd/NOURCITY";
  for (const command of [
    "pnpm test",
    "pnpm agent:verify",
    "git status --porcelain",
    "git diff --cached --name-only",
    "git log origin/main..HEAD",
    "git checkout -b chore/thing",
    "gh pr create --head chore/thing --title x --body y",
    "gh pr merge 12 --squash --delete-branch",
    "node scripts/agent-os/verify.mjs",
    "pnpm exec vitest run foo.test.ts --pool=forks",
  ]) {
    const res = evaluate({ toolName: "Bash", command, cwd, filePath: "" }, policy);
    assert.ok(!res.denied, `everyday command wrongly blocked by '${res.rule?.id}': ${command}`);
  }
});

// Hook-skip spellings, end to end through the REAL hook binary (job 2026-11-01-double-check-missed, guard-red-team).
// FACT 2026-10-30 ~07:40Z: a commit with git's -c option pointing core.hooksPath at a null location passed the guard,
// whose only pattern was the literal long flag. Literals are built from parts so this file's own edits, quoted in a
// Bash command, are never judged as the commands they describe; the spawned hook gets no GIT_* variables.
test("hook-skip spellings: the real pretool.mjs denies every one (exit 2 + rule id) and allows every mention and look-alike", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const HOOK = fileURLToPath(new URL("./pretool.mjs", import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  const run = (tool, command) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: "C:/Users/nourd/NOURCITY" }), encoding: "utf8", env });
  const HP = "core." + "hooks" + "Path";
  const LH = "LEFT" + "HOOK";
  const NV = "--no-" + "verify";
  const CFG = "GIT_" + "CONFIG_";
  const deny = [
    ["no-verify", "Bash", "git commit -" + "n -m x"],
    ["no-verify", "Bash", "git commit -" + "nm x"],
    ["no-verify", "Bash", "git commit -a" + "nm x"],
    ["no-verify", "Bash", 'git commit -m "msg" -' + "n"],
    ["no-verify", "Bash", "git -C /c/x commit -" + "n -m x"],
    ["no-verify", "Bash", "cd /c/x && git commit -v" + "n -m x"],
    ["no-verify", "PowerShell", "git commit -" + "n -m 'x'"],
    ["no-verify", "Bash", "git am -" + "n patch.mbox"],
    ["no-verify", "Bash", "git am -3" + "n patch.mbox"],
    ["no-verify", "Bash", "git commit " + NV.slice(0, -2) + " -m x"],
    ["no-verify", "Bash", "git am " + NV.slice(0, 6) + " x.mbox"],
    ["no-verify", "Bash", "git commit " + NV + " -m x"],
    ["no-verify", "Bash", `git -c ${HP}=/dev/null commit -m x`],
    ["no-verify", "Bash", `git -c ${HP.toLowerCase()}=NUL commit -m x`],
    ["no-verify", "Bash", `git -c "${HP}=/dev/null" push origin chore/x`],
    ["no-verify", "Bash", `git --config-env=${HP}=EMPTY merge chore/x`],
    ["no-verify", "Bash", `git --config-env ${HP}=EMPTY rebase origin/main`],
    ["no-verify", "Bash", `git -C /c/x -c ${HP}=/tmp/none am x.mbox`],
    ["no-verify", "Bash", `git -c ${HP}=/dev/null cherry-pick abc123`],
    ["no-verify", "Bash", `sh -c "git -c ${HP}=/dev/null commit -m x"`],
    ["no-verify", "Bash", `${CFG}COUNT=1 ${CFG}KEY_0=${HP} ${CFG}VALUE_0=/dev/null git commit -m x`],
    ["no-verify", "PowerShell", `$env:${CFG}KEY_0 = '${HP}'; $env:${CFG}COUNT = 1; git commit -m x`],
    ["no-verify", "Bash", `export ${CFG}PARAMETERS="'user.name=x' '${HP}=/dev/null'" && git push origin chore/x`],
    ["no-verify", "Bash", `git config ${HP} /dev/null`],
    ["no-verify", "Bash", `git config --local ${HP} .nohooks`],
    ["no-verify", "Bash", `git config --worktree ${HP} x`],
    ["no-verify", "Bash", `git config --global ${HP} ~/empty`],
    ["no-verify", "Bash", `git config set ${HP} /dev/null`],
    ["no-verify", "Bash", `git config --file .git/config ${HP} x`],
    ["no-verify", "Bash", `git --git-dir /c/x/.git -c ${HP}=x commit -m y`],
    ["no-verify", "Bash", `git -C "/c/my repo" -c ${HP}=x commit -m y`],
    ["no-verify", "Bash", "git commit -m x \\\n  -" + "n"],
    ["no-verify", "Bash", "xargs git commit -" + "n -m x"],
    ["no-verify", "PowerShell", `$Env:${LH} = '0'; git commit -m x`],
    ["no-verify", "Bash", `${LH}=0 git commit -m x`],
    ["no-verify", "Bash", `${LH}_EXCLUDE=lint git push origin chore/x`],
    ["no-verify", "Bash", `${LH}_BIN=true git commit -m x`],
    ["no-verify", "Bash", `${LH}_CONFIG=/dev/null git commit -m x`],
    ["no-verify", "Bash", `env ${LH}=0 git commit -m x`],
    ["no-verify", "Bash", `export ${LH}=0; git push origin chore/x`],
    ["no-verify", "PowerShell", `$env:${LH} = '0'; git commit -m x`],
    ["no-verify", "PowerShell", `setx ${LH} 0`],
    ["no-verify", "PowerShell", `[Environment]::SetEnvironmentVariable('${LH}', '0', 'User')`],
  ];
  const allow = [
    ["Bash", "git push -" + "n origin chore/x"],
    ["Bash", "git merge -" + "n chore/x"],
    ["Bash", "git rebase -" + "n origin/main"],
    ["Bash", "git cherry-pick -" + "n abc123"],
    ["Bash", "git log -" + "n 5 --oneline"],
    ["Bash", 'git commit -m "x -' + 'n y"'],
    ["Bash", 'git commit -am "turn on -' + 'n"'],
    ["Bash", "git commit --no-verbose -m x"],
    ["Bash", "git commit -F msg.txt"],
    ["Bash", `git commit -m "docs: ban git -c ${HP} and ${LH}=0"`],
    ["Bash", `echo "git -c ${HP}=/dev/null commit"`],
    ["Bash", `echo ${LH}=0 git commit -m x`],
    ["Bash", 'echo "git commit -' + 'n"'],
    ["Bash", `rg -n "${HP}" scripts/`],
    ["Bash", `git config --get ${HP}`],
    ["Bash", `git config ${HP}`],
    ["Bash", `git config ${HP} 2>&1`],
    ["Bash", `git config --show-origin ${HP}`],
    ["Bash", `git config --unset ${HP}`],
    ["Bash", "git -c user.name=x commit -m y"],
    ["Bash", "git -c core.editor=vim commit -m x"],
    ["PowerShell", `$env:${LH}_VERBOSE = '1'; git commit -m x`],
    ["PowerShell", `[Environment]::SetEnvironmentVariable('${LH}', $null, 'User')`],
    ["Bash", "git commit -m x && git push -" + "n origin chore/x"],
    ["Bash", "git commit -F m.txt; git log -" + "n 3"],
    ["Bash", `git config ${HP} && git status`],
  ];
  // Every probe runs and every miss is listed, so a red names all of them, not only the first.
  const bad = [];
  for (const [id, tool, command] of deny) {
    const r = run(tool, command);
    const got = /BLOCKED by repo policy: (\S+)/.exec(r.stderr)?.[1] ?? "none";
    if (r.status !== 2 || got !== id) bad.push(`should DENY by ${id} (exit ${r.status}, rule ${got}): ${tool}: ${command}`);
  }
  for (const [tool, command] of allow) {
    const r = run(tool, command);
    if (r.status !== 0) bad.push(`should ALLOW (exit ${r.status}): ${tool}: ${command}`);
  }
  assert.ok(deny.length >= 43 && allow.length >= 26, "the probe set only grows");
  assert.deepEqual(bad, [], `${bad.length} of ${deny.length + allow.length} probes wrong`);
});
