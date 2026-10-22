# Benchmark: best-in-class orchestration, read 2026-10-22 (Nour's standing order: learn from the best)

Each row is one mechanism from a public, licensed source, what failure it fixes, whether this skill already had it, and the
verdict. Quotes are short and were read on the page by this job on 2026-10-22 (FACT for the docs; whether the mechanism
works HERE is the "Have it?" and "Verdict" columns). Research route: Perplexity in Chrome was tried first (memory
`feedback-research-via-perplexity-chrome`); the scripted Pro request was refused by the permission classifier and Chrome
then reported "Host access is restricted by policy" on perplexity.ai, so the primary pages below were read directly.

Sources:
[A] Anthropic, "How we built our multi-agent research system", https://www.anthropic.com/engineering/multi-agent-research-system
[B] langchain-ai/langgraph-supervisor-py README (MIT), https://github.com/langchain-ai/langgraph-supervisor-py
[C] Microsoft Research, Magentic-One article, https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/
[D] OpenAI Agents SDK, human in the loop, https://openai.github.io/openai-agents-python/human_in_the_loop/
[E] OpenHands SDK, stuck detector, https://docs.openhands.dev/sdk/guides/agent-stuck-detector
[F] Claude Code docs, agent teams, https://code.claude.com/docs/en/agent-teams
[G] Claude Code docs, hooks, https://code.claude.com/docs/en/hooks
[H] obra/superpowers skills (MIT; the local copies under `~/.claude/skills/`): subagent-driven-development,
    dispatching-parallel-agents, executing-plans, requesting-code-review, finishing-a-development-branch

| # | Mechanism (source, quote) | Fixes | Have it? | Verdict, and where |
|---|---|---|---|---|
| B1 | Detailed briefs [A]: each task needs "an objective, an output format" and "clear task boundaries" | vague delegation, duplicated work | yes: brief v3 has GOAL, RETURN, owned paths | keep; the brief check now also requires the SHOP DATA block (step 6) |
| B2 | Effort scaling [A]: "Simple fact-finding requires just 1 agent with 3-10 tool calls" | "spawning 50 subagents for simple queries" [A] | no: only machine caps | ADOPT: step 2 sizes the job (one area: no manager; most jobs 1-3 workers; 2 writers max) |
| B3 | Outputs to files [A]: subagents "pass lightweight references back to the coordinator" | the "game of telephone" | partly: large findings go in a file | keep, and extend to relays (B7) |
| B4 | End-state evaluation [A]: "evaluate whether it achieved the correct final state" | process-green, outcome-red | yes: evidence rung in the report | keep (step 16) |
| B5 | Token cost [A]: multi-agent runs use about 15 times the tokens of a chat (the page writes 15 with a times sign) | spend on work one session could do | partly: "skip the manager for one area" | keep, and B2 makes it a step |
| B6 | Supervisor forwards verbatim [B]: `forward_message` "avoids potential misrepresentation of the worker's response through paraphrasing" | the manager rewording a session's claim into a false fact | no | ADOPT: relay check item 4 ([relay.md](relay.md)): quote the receipt with attribution, then add your own check |
| B7 | Handoff passes the whole supervisor history [B] | context loss | n/a | REJECT: lanes get a brief file, not the chat; 450k-570k tokens per lane were measured with far less |
| B8 | Task ledger of "facts, guesses, and plan" [C] | guesses treated as facts | partly: FACT / INFERRED / NOT CHECKED labels | ADOPT in step 2: the spec's KNOWN line lists verified facts and guesses separately |
| B9 | Progress ledger with a stall count: if "Stall count > 2", re-plan [C] | a run that keeps waiting on a stuck worker | partly: "same failure twice, name the assumption" | ADOPT in step 7: two check-ins with no new commit or receipt from a session = one message; a third = replace or re-plan |
| B10 | "pause and seek human input before proceeding with such high-risk actions" [C] | unattended harm | yes: AGENTS.md protected operations | keep; B11 fixes its timing |
| B11 | Approvals ahead of time and durable pauses [D]: `needs_approval`, interruptions, a durable `RunState`, `always_approve` | a protected step found after the human left, stalling the run (2026-10-22, #3223) | no | ADOPT as step 3 (Pre-clear): name each protected action the job can hit and get Nour's go for that action before he leaves; anything not cleared parks while independent work continues. AGENTS.md still needs a go per specific action: a blanket "full auth" is not one, so no sticky blanket approval |
| B12 | Stuck detector [E]: same action-error "3+ times", alternating pairs "6+ cycles" | loops that burn usage | yes, tool level: `stuck-watch.mjs` | keep; B9 covers the session level |
| B13 | Completion hooks [F]: `TaskCompleted`, `TeammateIdle` exit 2 to keep a teammate working | early "done" | n/a: agent teams are experimental and off here | REJECT for now; the Stop hooks of this job are the same idea for the manager itself |
| B14 | "The lead can stop early too" [F] | the manager declaring a job done with work left | yes: run to empty, no early exits | keep (step 16 and the ledger) |
| B15 | Relayed approvals are untrusted [F]: the classifier "treats an approval claim relayed from another agent as untrusted" | permission laundering | yes: sessions-and-plans rule 7 | keep |
| B16 | Team size [F]: "Start with 3-5 teammates for most workflows" | coordination overhead | yes, stricter: 2 writers (measured OOM here) | keep the local cap |
| B17 | Stop input `last_assistant_message`; the transcript "isn't guaranteed to include the final message at Stop time" [G] | a Stop hook judging a stale reply | n/a | ADOPTED in `skills-check.mjs` and `health-first.mjs` |
| B18 | Four worker statuses and "Never ... force the same model to retry without changes" [H] | a re-dispatch that repeats the failure | partly: DONE / BLOCKED / PARTIAL | ADOPT in step 7: a BLOCKED or failed lane is re-dispatched only with a change (more context, a higher tier, a smaller task, or a ruling) |
| B19 | Rulings, not stalls [H]: `Ruling: <what> - <why> - <what it costs if wrong>` | a run parked on a question a human would answer "just pick" | partly: memory `feedback-decide-simple-calls` | ADOPT in step 17: every reversible decision made without Nour is one Ruling line in the PR body |
| B20 | Fix-loop cap with escalation [H]: rounds 4-5 use "a model at least one tier above" | review loops that never converge | partly | ADOPT in step 12: after 2 red review rounds on the same finding, a fresh lane one tier up |
| B21 | Pre-flight scan of task pairs that share a file or interface [H] | two writers on one contract | yes: step 4 ORDER rule | keep |
| B22 | The ledger is the recovery map after compaction [H] | redoing finished work | yes: ledger + `git log` + operator asks | keep (step 1) |
| B23 | Reviewer gets crafted context, never the session history [H] (`requesting-code-review`) | a reviewer anchored on the author's reasoning | yes: adversarial-review workflow briefs | keep; name `requesting-code-review` for the one-reviewer case (step 12) |
| B24 | One agent per independent domain, dispatched in one message [H] (`dispatching-parallel-agents`) | serial waits | yes: SUBAGENT POLICY rule 5 | keep |

Not adopted on purpose: an always-on supervisor process (nothing to host it; the desktop app's sessions are the
workers), a shared task-list file (the ledger plus the app's linked-sessions note already carry it), and LLM-as-judge
scoring of manager replies (no eval budget beyond Nour's Ollama plan, memory `receptionist-replay-lane-ollama-only`).
