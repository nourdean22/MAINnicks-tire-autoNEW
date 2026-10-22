# Skeptic pass: monorepo-manager

reviewer: lane-research agent (opus, high), 2026-10-22, about 50 tool calls; read-only, probes in the OS temp dir. Brief: the
skill-forge skeptic brief adapted to the rewrite and its four checks. Every exact input it reported is now a test.

## Findings

- In a task-notification turn the Skills-line check counted Skill calls made before the notification, and one block covered the whole notification-driven night; now: turn truth is judged since the reply's start (the newest prompt or notification) with its own one-shot key; skillsCheck.test.mjs "a task-notification turn is judged on its own Skill calls". fixed
- Skills-line spellings passed with an uninvoked skill ("Skills used:", "Skill:", "none needed beyond X", "(plus X)", an earlier Skills line, a mid-line "Skills:", a different case); now: every Skills line is read, the list is split into clauses, names are lower-cased; one test per spelling. fixed
- Two honest lines were blocked ("X was not needed here", "no X because ..."); now: a clause holding a negation claims nothing. fixed
- CI and live claims passed unread ("No regressions, and all 4 PRs are green", "All checks pass", "Green across all four PRs", "It's live", "Deployed and serving"); now: clauses split on commas, more verbs and both word orders, "it's live" and "deployed" count. fixed
- `cat merge-gate.mjs`, a Read of HEARTBEAT.md and a Grep for the domain counted as reads of CI or production; now: only a tool that runs something (or a WebFetch of the domain, or a deployment or log MCP tool) is a read. fixed
- "Local checks passed: 41 tests" and "a green Book now button" were blocked as CI claims; now: local, preflight, pre-commit and pre-push are hedges; "a/an/the green" is attributive. fixed
- The brief-shop-data rule read only the first brief-shaped file, missed "Nick's" with a curly apostrophe, synonyms (repair orders, customers) and task files not named brief, and its 1,200-character window read past a hollow block; now: every named .md or .txt file is read (up to 5, the blank template skipped), the apostrophe and synonyms match, and the block ends at the next field or a blank line. fixed
- The rule wrongly denied "estimate" as a verb, a receptionist prompt that mentions bookings, and a shop word that was only in the brief's file name; now: it also needs a reading cue (count, how many, SELECT, TiDB, last month ...), and file names are removed before the noun test. fixed
- A brief that red-teams the rule itself is denied. rejected: it reads like a shop-data brief; pasting the one SHOP DATA block costs seconds.
- health-first passed on a Read or Grep of the fix script and on a bare "Health: ok"; now: only a run or an edit counts, and the Health line must say fixed or because. fixed
- health-first blocked honest fixes that name no script (WRONG SERVICE via Get-NetTCPConnection, hooks BLOCKED via an Edit adding the Bypass flag), because its fallback token was the fix's first three words; now: tokens are files, task names, cmdlets and the Bypass flag when the fix is to add it; a fix that names nothing is acted on by any run or edit. fixed
- Step 3 Pre-clear asked for a go on action classes, which AGENTS.md does not accept, told sessions to act on a relayed go, recorded it in a ledger row that only exists after merge, and could not cover a Railway variable; now: specific actions only, the manager performs a cleared action itself, the record goes to the takeover memory file and the PR body, and a Railway variable is named as never pre-clearable. fixed
- Step 6 wrote the dispatch time into a ledger row that is written once at merge; now: it goes in the job notes and reaches the row at step 17. fixed
- managerSkill.test.mjs passed a misspelled machine skill, a canary unrelated to its script, and a reference named only in prose; now: machine rows resolve where the machine has `~/.claude/skills`, the canary must name its script (which found replay row b pointing at policy.mjs while its canary drives pretool.mjs, now corrected), and only markdown links count. fixed
- The branch was 7 commits behind main (USER.md's shop data meanings, the vendored differential-review and supply-chain-risk-auditor); now: rebased; both skills are repo rows; a new canary feeds the real USER.md meanings to the rule. fixed
- `forge.mjs check` passed on trigger query 16 naming a domain; now: paraphrased. fixed
- Two different counts for the same replay (33 of 86, 22 of 117); now: one count everywhere, from the hook's own parser over the grown transcript: 22 of 128 lines in 155 turns. fixed
- The description fires on one-area "get it all done" asks and on "is it live yet", and overlaps nour-command; now: the Not for clause names both, and SKILL.md says which skill leads. fixed
- `forge.mjs check` accepts a hand-written invocation.json and a skeptic line whose disposition is only shaped right. rejected: a known, documented limit of skill-forge (its gates.md, "What the gates still cannot do"), not of this skill; `forge.mjs prove` and the reviewer are the controls.
- The `$` mutant of the brief-shop-data pattern survives. rejected: equivalent; subagent_type has its spaces replaced and `shop-data=` is always the last field, so no reachable line differs.
- The held-out split is 16 of 24 rows, not about 40%. rejected: the split is fixed by hash so the author cannot choose it; train still has 3 or more rows of each label, as the gate requires.
- Agents started inside a Workflow script are not judged by the brief rule. rejected: no hook reaches them; written down in replay-2026-10-22.md as a limit.
