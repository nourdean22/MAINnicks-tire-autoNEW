# Worked example: the Shop OS planning job, 2026-10-30

What good looks like, and where v3 fell short, from one real day. Job `2026-10-26-shop-os` (plan folder
`apps/nickstire/docs/plans/shop-os/`, PR 3322). Mode: Plan, under `/loop`. Docs-only sessions, no code before Nour's day 13-14
buy-or-build call. Source: the manager's takeover memory file `shop-os-planning-manager-2026-10-30.md` (machine-local). No shop
figures appear here: the repo is public.

## The timeline, and the v4 rule each moment shows

| Time (UTC) | What happened | v4 rule |
|---|---|---|
| 13:53 | Nour: build a CRM and shop brain, "OPEN NEW SESSIONS FOR EVERYTHING ... U OVERSEE EVERYTHING ... WATCH OUT FOR THE OTHER SESSIONS ACTIVE TOO". The manager read the plan and fact-checked a pasted outside prompt: "statenour owns customers" was wrong (nickstire on TiDB owns customers, invoices, estimates); "a 14B model on the shop PC" was ruled out by the PC's specs. | Job start: USER.md and the code settle who owns what before a brief repeats a wrong premise. Step 8 Relay applies to pasted prompts too. |
| 14:03 | `list_sessions` showed another manager running about 11 sessions; free RAM 615 MB. Rule set for the job: docs-only sessions, no suites, never touch the other manager's worktrees. | RAM gate: under 2,000 MB nothing starts, so v4 would have queued these four briefs instead of starting them at 615 MB. The cap counts other managers' sessions. |
| 14:15 to 14:38 | Four briefs written as files, four sessions started: doc 12 local AI (opus/high), doc 13 toolkit audit (sonnet/high), doc 14 stolen mechanisms (opus/high), doc 15 gaps (opus/high). | Start: model and effort per brief, named in the intro line. |
| 14:21 | Nour (10:21 EDT): every session on a loop. Docs 12 and 13 got the rule by message; later briefs carried it. | LOOP RULE in every brief; one message to sessions started before the rule. |
| 14:30 | Nour (10:30 EDT) ruled on four plan questions and deferred six decisions: "leave these for laster remind me". | Digest: the rulings went to every running session; the six went to the takeover file to be shown again at the day 13-14 call: the parked register. |
| 14:45 | Doc 12 done: PR 3382, read by the manager (verdict: API first, a night-shift batch node second, the mesh rejected). | Check: read the real diff, not the summary. |
| 14:55 | Digests of doc 12's verdict and doc 13's facts sent to docs 14 and 15. | Digest: a finished doc becomes 3 to 5 lines for the still-running sessions. |
| 15:03 | PR 3382 blocked by 6 Codex P2 threads; PR 3383 drew 19 Codex comments. The sessions were told to fix, resolve and push once. | Send-back once with the exact gap; STANDARD asks for a second reader before the PR opens, so fewer threads reach Codex. |
| about 15:0x | Two more briefs (docs 16 and 17) written but held: free RAM was 160 MB with 15 sessions on the machine. | Queue: brief written now, QUEUED with its trigger. |
| before 15:25 | The laptop crashed. Afterwards Nour: "pause whats less imprtant or finish the quicker shit first so we can off load ram". Order: finish docs 14 and 12 first, pause docs 16 and 17 right after start, leave doc 15 idle; running cap for the job set at 4. | Under 500 MB: start nothing, stop the least important idle session this job started (never another manager's). Close out finished sessions first, since an open finished session holds RAM. |
| after 15:25 | The first launch of this manager-skill-v4 job had never started; it was relaunched. Graphify was down after the crash and was restarted first. | Turn row 1: FIX FIRST before work. Sweep: a session with no events since its start is a failed launch, not a slow one. |

## What v3 would have missed, and v4 now says

1. No number told the manager when to stop starting sessions; it learned at 160 MB. v4: the RAM gate and the 10-session cap.
2. No brief line kept sessions moving between sweeps. v4: LOOP RULE.
3. Rulings and finished docs reached sessions only because the manager remembered. v4: digest and broadcast in the same tick.
4. Finished sessions stayed open and held RAM. v4: close-out order, with archive after the takeover memory.
5. Six deferred decisions had no home but the chat. v4: the parked register, shown again at the next decision gate.
6. Lane agents were not available in the harness, so every worker was a session. v4: the Workers table has a session column and
   the fallback line.
