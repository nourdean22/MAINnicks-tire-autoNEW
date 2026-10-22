# Verify: labels, probes, names, sources, consumers (steps 7, 9-11 and 14)

Each section below is one step of the procedure, with the 2026-10-15 defect that earned it. The point of all of them:
a lane's green is evidence about the lane's tests. These steps are the manager's own evidence about the thing.

## Evidence labels (steps 7 and 16)

Every fact in a RETURN block and in your report carries one label.

| Label | Means | Needs |
|---|---|---|
| FACT | you ran it or read it this session | the command and its summary line, or the quote |
| INFERRED | follows from facts | the facts it follows from |
| NOT CHECKED | nobody looked | why |

For an external fact (a vendor doc, a platform behavior) use FACT only for a quote you read yourself; two consistent
secondary sources or an observed behavior is STRONG INFERENCE; a summary, a memory note or another agent's word is a CLAIM.

The two scales are one vocabulary used at two places (the first in RETURN blocks and the report, the second in step 11 and the PR body):

| RETURN and report (steps 7 and 16) | Step 11 and `NOUR-COMMAND.md` | Difference |
|---|---|---|
| FACT | FACT | none: you ran it or read it |
| INFERRED | STRONG INFERENCE | follows from named facts; a WEAK INFERENCE (plausible, material gaps) is written NOT CHECKED with the gap |
| NOT CHECKED | UNKNOWN | nobody looked; say why |
| (a lane's unverified assertion) | CLAIM | stated by an agent, a document or a person and not re-read by you: re-label it FACT only after you read the source |

A commit or ledger row on a branch nobody has pushed is a CLAIM for every reader but its author: cite it as such, with the SHA.
Then name the highest rung reached on `NOUR-COMMAND.md`'s ladder (claim, artifact, execution receipt, external effect,
user or business outcome) and the first rung NOT reached. "Tested" is a rung; "live" is a higher one.

## A DB tool needs a real-engine receipt (step 7)

A lane that tests a production-database tool against an in-memory fake can pass hundreds of tests and still ship SQL the real engine
rejects. Measured 2026-10-15 by the status manager session and relayed here (CLAIM, not re-measured): the merged shop-clock backfill
tool passed 250 tests, then its first live `probe` (a SELECT) failed on production TiDB with a syntax error, an unquoted alias `AS stored`
(STORED is a keyword). Nothing was written because it was a read. The fix is a gate, not more fake-DB tests:

1. Before the first real run of ANY prod-touching tool (`prod-db-guard` applies), the manager runs a throwaway SANDBOX CHECK that sends the
   tool's real SQL builders to the real engine using only session-local TEMPORARY tables. A guard in the script refuses any statement that
   names a real table; temp tables vanish at disconnect.
2. It carries a positive control: it must reproduce a known bad statement (here, the unquoted keyword alias) or it proves nothing.
3. It measures what a fake cannot: whether `SET col = col` stops an `ON UPDATE CURRENT_TIMESTAMP`, the affectedRows a compare-and-swap
   really returns, what `INSERT ... SELECT *` into a LIKE copy does.
4. Read-only is an ALLOWLIST of statements, not a deny list: TiDB rejects `SET SESSION TRANSACTION READ ONLY` and `CREATE TABLE AS SELECT`,
   so a "read-only mode" built on those does not exist there.
5. The receipt (the script, its output and the positive control's failure) goes in the lane's return and the PR body. No receipt, no
   operator-facing step, and the report names the rung as "tested against a fake".

## A granted one-line value change is reviewed like code (step 7)

When you grant a lane's cross-lane note (an href, a key, a label), grep every reader of the OLD value first, including
guards that compare against it. Witnessed 2026-10-16: `lib/floating-home/smart-now.ts:62` changed `/system/actions` to
`/system/actions?tab=approvals` unreviewed; the same file's `pathname.startsWith(target)` guard then never matched, so the More
sheet kept suggesting the page the operator was already on (W1b review P1-1). Same shape in W1a: `toLowerCase()` hidden behind a
removed `uppercase` class, and a mastery `icon` field whose readers only tsc found.

## Probe it yourself (step 9)

1. Find the real entry point: the process the consumer runs, with the command string exactly as configured (a hook in
   `.claude/settings.json`, a CLI, an endpoint). A function call proves the function.
2. Grep the guarded code for every numeric limit (a `slice(0, N)`, a `MAX`, a length, depth or time cap). For each, probe
   at cap-1, cap and cap+1, and with the bad item LAST in the list. Then the `guard-red-team` classes: global-option
   prefixes, implicit arguments, flag families, quoting and heredocs, chaining, mention versus execution.
3. Assert the exit code AND the rule id in the output. A nonzero exit alone is also what a config or parse error gives.
4. Send every bypass back to the lane as the exact input and the observed exit code; it becomes a permanent deny example.
5. Put "manager probes: N run, M bypasses" in the report. Zero bypasses from zero probes is not a result.

Witness (CLAIM: `c6165375f` is a commit on the guard session's branch, unpushed when this was written). An `sql_statements` list of 201 to 5,000 small statements with the DROP last exited 0 through the
real hook, because `ARRAY_MAX` was 200. The lane's canaries were green; the manager's boundary probe found it. The fix
raised the budget to 2,000 elements or 1,000,000 characters and the lane added the boundary arms. Cost of the probe: minutes.

Template (the shape of the status manager's probe scripts for that job; copy it to the scratchpad, never into the repo, and pass the
worktree root as the argument). It feeds synthetic stdin to the real hook, so nothing is executed:

```js
// probe-hook.mjs <worktree root>
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const WT = process.argv[2];
if (!WT) throw new Error("usage: node probe-hook.mjs <worktree root>");
const HOOK = join(WT, "scripts", "agent-os", "pretool.mjs");
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))); // a hook env has no GIT_DIR
function run(tool, input) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: input, cwd: WT }), env: ENV, encoding: "utf8", timeout: 60000 });
  const rule = (r.stderr.match(/BLOCKED by repo policy: ([\w-]+)/) ?? [])[1] ?? "";
  return r.status === 0 ? "allow" : r.status === 2 ? `deny:${rule}` : `exit${r.status}`; // the rule id, not just exit 2: config errors exit nonzero too
}
const CAP = 2000; // the cap you grepped out of the guarded code
const at = (i) => Array.from({ length: CAP + 1 }, (_, k) => (k === i ? "DROP TABLE leads" : "SELECT 1"));
const PROBES = [
  ["control: a plain bad input must deny", "Bash", { command: "<a command the guard certainly denies>" }, "deny:<its rule id>"],
  ["control: a plain good input must allow", "Bash", { command: "git status" }, "allow"],
  ["bad item at cap-1", "mcp__<server>__run_sql_transaction", { sql_statements: at(CAP - 1) }, "deny:destructive-sql"],
  ["bad item last", "mcp__<server>__run_sql_transaction", { sql_statements: at(CAP) }, "deny:destructive-sql"], // past the budget: it may differ, and the docs must say so
];
let bad = 0;
for (const [label, tool, input, want] of PROBES) {
  const got = run(tool, input);
  if (got !== want) bad++;
  console.log(`${got === want ? "ok  " : "FAIL"} ${label}: want ${want}, got ${got}`);
}
process.exit(bad ? 1 : 0);
```

A probe run whose two controls are not both `ok` proves nothing: the harness, not the guard, is what failed.

## Check the names (step 10)

A rule that lists names (native `permissions.ask` entries, tool names, env vars, rule ids, file paths, skill or workflow
names) fails silently when one name is mistyped: an ask rule that matches nothing prompts for nothing. The author cannot
see their own typo, so someone else resolves every entry, and the right someone depends on the kind of name:

- **Tool names: you do it, with `ToolSearch select:<name>`.** `lane-research` has no ToolSearch (its tools are Read, Grep, Glob, Bash,
  WebFetch, WebSearch, Skill), so handing it a tool-name list returns NOT CHECKED for every row.
- **Paths, PR numbers, flags, env vars, rule ids, skill names: a read-only `lane-research` agent**, with this brief:

```
Read-only. For each name in <file or list>, resolve it against the live source and return a table:
name | resolves? (yes/no) | how you resolved it (command or tool, with the matching line) | closest real name if no.
Live sources: `ls` or Glob for paths; `gh` for PRs and runs; the schema or `--help` for flags; Grep for env vars and rule ids.
Say NOT CHECKED for anything you could not resolve.
```

Spot-check two rows yourself, one of them a "no". Witness (CLAIM: `6ba98aa6b` is on the guard session's unpushed branch): the 135 native
ask rules in the guard job, each resolved with `ToolSearch select:` before it entered a fixture. The name list is a snapshot with no
startup warning, so the fixture test pins it and a glob form still needs the live proof in step 14.

## Read the primary source (step 11)

Decision-critical means the fact would change a design or a guard's behavior. Read the page yourself, quote at most 15
words, record the URL and date, and label it. Put the label in the PR body.

Witness: whether an explicit ask rule still prompts under `bypassPermissions`. An agent summary said NOT DOCUMENTED (CLAIM, from
the job brief). The Claude Code docs, read on 2026-10-15, said it does (FACT in the guard session, which quoted the page; a CLAIM for you: the commit body
`6ba98aa6b`, unpushed, records the reading), and that led to native `permissions.ask` rules instead of more hook code. The live check of
those rules then showed no prompt for Railway delete-service, Vercel pause_project or Prisma delete_prisma_postgres_database in a
`bypassPermissions` session (CLAIM: the guard session's live check, cause not yet separated). So a quote is evidence about the docs, not about
the thing: step 14 is what says it is constrained. The rule: search the page for the term before you accept "not documented"; if the page
cannot be read, the answer is UNKNOWN and the design says so.

## Consumer check (step 14)

An enforcement change is not done when its canaries pass; it is done when the thing it constrains is constrained
(`assert-the-consumer`). Registration is not reachability.

1. Find out which files the consumer loads BEFORE you test. A session the desktop app starts in a worktree loads hooks and
   permission rules from the PRIMARY checkout's `.claude/settings.json` (originCwd), not from the worktree. Measured 2026-10-15 by
   the manager session and relayed here (CLAIM, not re-measured): a live check run in a worktree cut from the guard branch tested the
   primary's older settings and looked like a failure of the new hooks and ask rules. The tell is the SessionStart hook output, which
   reports the primary's branch and HEAD. The later check, run in a fresh session once the primary had the merge, separated the two
   (the guard session's verdict line, CLAIM: "LIVE CHECK b6faf90d9: steps 1-4 PASS, 5-6 PASS, 7 FAIL"; step 7 is the ask-rule probe): the
   hooks and runner rows passed and the 135 ask rules still gave no prompt, so that was a real failure of the rules, not only a settings artifact. Project skills are different: a `claude -p` started in a worktree loaded the worktree's own
   `.claude/skills` (FACT, `forge.mjs prove`).
2. So a pre-merge live check of hooks or permission rules cannot be done from a worktree. Do it after the merge, once the primary
   has the change (`git -C <primary> merge --ff-only`), in a FRESH session (hooks load when a session starts), and read
   `git -C <primary> rev-parse HEAD` first so you know what that session really loaded. A consumer that is only a script you invoke
   (`merge-gate.mjs`, `ledger-check.mjs`, `forge.mjs`) can be exercised before merge from the worktree.
3. Run the probes in `docs/agent-os/README.md` > "Live check after merge". PASS needs the rule id (`BLOCKED by repo policy: <id>`) and
   the Judged-through line; a bare block banner is another layer, and a permission prompt proves the permission system, not this guard.
4. Before blaming the change for a failure, confirm which `settings.json` the session actually loaded: compare the behaviour you
   observed with the primary's file on disk.
5. A diagnostic logger writes inside the session's own cwd, and is proven with a control tool (one that MUST be logged) before a
   negative result is trusted.
6. A consumer you cannot reach (a claude.ai connector registration, a cloud session) gets the ledger status MERGED with the next
   action "live check owed", an owner and a date. Never write LIVE-VERIFIED without the receipt.

Witness: #3040 merged as `tested and re-probed, not yet proven live` (owed); the live proof, 3 of 3 probes refused, came the same
day after the merge.

## Running `verify.mjs` locally

`node scripts/agent-os/verify.mjs` gives its test children a sanitized environment, so a github-client canary can fail locally with
"no GitHub token available" while the file passes alone (relayed by the manager session; here two of four full runs failed on one such
test and the file passed alone, 6 pass, 0 fail). Run `GH_TOKEN="$(gh auth token)" node scripts/agent-os/verify.mjs`; CI supplies
`GH_TOKEN`. Do not chase that one as a regression of your diff, and do not skip the run.
