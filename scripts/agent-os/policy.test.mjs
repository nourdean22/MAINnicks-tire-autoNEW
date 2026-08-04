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
// Rules scoped to worktrees need a cwd that satisfies onlyWhenCwdMatches.
const cwdFor = (rule) =>
  rule.onlyWhenCwdMatches
    ? "C:/Users/nourd/NOURCITY/.claude/worktrees/repo-agent-os-architecture-6528d4"
    : "C:/Users/nourd/NOURCITY";

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
