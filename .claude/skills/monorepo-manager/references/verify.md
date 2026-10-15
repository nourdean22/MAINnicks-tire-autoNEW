# Verify: labels, probes, names, sources, consumers (steps 6-9 and 12)

Each section below is one step of the procedure, with the 2026-10-15 defect that earned it. The point of all of them:
a lane's green is evidence about the lane's tests. These steps are the manager's own evidence about the thing.

## Evidence labels (steps 6 and 14)

Every fact in a RETURN block and in your report carries one label.

| Label | Means | Needs |
|---|---|---|
| FACT | you ran it or read it this session | the command and its summary line, or the quote |
| INFERRED | follows from facts | the facts it follows from |
| NOT CHECKED | nobody looked | why |

For an external fact (a vendor doc, a platform behavior) use FACT only for a quote you read yourself; two consistent
secondary sources or an observed behavior is STRONG INFERENCE; a summary, a memory note or another agent's word is a CLAIM.
Then name the highest rung reached on `NOUR-COMMAND.md`'s ladder (claim, artifact, execution receipt, external effect,
user or business outcome) and the first rung NOT reached. "Tested" is a rung; "live" is a higher one.

## Probe it yourself (step 7)

1. Find the real entry point: the process the consumer runs, with the command string exactly as configured (a hook in
   `.claude/settings.json`, a CLI, an endpoint). A function call proves the function.
2. Grep the guarded code for every numeric limit (a `slice(0, N)`, a `MAX`, a length, depth or time cap). For each, probe
   at cap-1, cap and cap+1, and with the bad item LAST in the list. Then the `guard-red-team` classes: global-option
   prefixes, implicit arguments, flag families, quoting and heredocs, chaining, mention versus execution.
3. Assert the exit code AND the rule id in the output. A nonzero exit alone is also what a config or parse error gives.
4. Send every bypass back to the lane as the exact input and the observed exit code; it becomes a permanent deny example.
5. Put "manager probes: N run, M bypasses" in the report. Zero bypasses from zero probes is not a result.

Witness: `c6165375f`. An `sql_statements` list of 201 to 5,000 small statements with the DROP last exited 0 through the
real hook, because `ARRAY_MAX` was 200. The lane's canaries were green; the manager's boundary probe found it. The fix
raised the budget to 2,000 elements or 1,000,000 characters and the lane added the boundary arms. Cost of the probe: minutes.

## Check the names (step 8)

A rule that lists names (native `permissions.ask` entries, tool names, env vars, rule ids, file paths, skill or workflow
names) fails silently when one name is mistyped: an ask rule that matches nothing prompts for nothing. The author cannot
see their own typo, so a separate read-only agent (`lane-research`) resolves every entry:

```
Read-only. For each name in <file or list>, resolve it against the live source and return a table:
name | resolves? (yes/no) | how you resolved it (command or tool, with the matching line) | closest real name if no.
Live sources: ToolSearch "select:<name>" for tool names; `ls` or Glob for paths; `gh` for PRs and runs; the schema or
`--help` for flags. Do not call any tool you are resolving. Say NOT CHECKED for anything you could not resolve.
```

Spot-check two rows yourself, one of them a "no". Witness: the 135 native ask rules in the guard job, each resolved with
`ToolSearch select:` before it entered a fixture (`6ba98aa6b`). The name list is a snapshot with no startup warning, so the
fixture test pins it and a glob form still needs the live proof in step 12.

## Read the primary source (step 9)

Decision-critical means the fact would change a design or a guard's behavior. Read the page yourself, quote at most 15
words, record the URL and date, and label it. Put the label in the PR body.

Witness: whether an explicit ask rule still prompts under `bypassPermissions`. An agent summary said NOT DOCUMENTED (CLAIM, from
the job brief). The Claude Code docs, read on 2026-10-15, settled it (FACT, `6ba98aa6b`), and that reading produced the best idea of the job: native
`permissions.ask` rules instead of more hook code (`6ba98aa6b`). The rule: search the page for the term before you accept
"not documented"; if the page cannot be read, the answer is UNKNOWN and the design says so.

## Consumer check (step 12)

An enforcement change is not done when its canaries pass; it is done when the thing it constrains is constrained
(`assert-the-consumer`). Registration is not reachability.

1. Start a FRESH Claude Code session with the integration worktree as its project directory. Hooks load when a session
   starts, and `.claude/settings.json` addresses its scripts through `${CLAUDE_PROJECT_DIR}`, so a session started in the
   worktree runs the branch's hooks. STRONG INFERENCE from the config, not yet a quote from the docs: the probe's own
   rule-id line is the confirmation, so never skip reading it.
2. Run the probes in `docs/agent-os/README.md` > "Live check after merge" that apply to the change. PASS needs the rule id
   (`BLOCKED by repo policy: <id>`) and the Judged-through line; a bare block banner is another layer, and a permission
   prompt proves the permission system, not this guard.
3. A consumer you cannot reach before merge (a claude.ai connector registration, a cloud session) gets the ledger status
   MERGED with the next action "live check owed", an owner and a date. Never write LIVE-VERIFIED without the receipt.

Witness: #3040 merged as `tested and re-probed, not yet proven live` (owed); the live proof, 3 of 3 probes refused, came the same
day after the merge.
