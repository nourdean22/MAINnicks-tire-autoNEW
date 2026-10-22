# Baseline: shop-pc-remote-session

recorded: 2026-10-22

Question: what goes wrong when an agent is asked to put files on, or run commands on, a shop PC through Chrome Remote Desktop
(CRD) WITHOUT this skill? Recorded before `SKILL.md` was written.

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: a fresh headless run without the skill, read-only tools, asked in plain words to deploy the camera bridge on the front-desk PC while the shop is closed (planned for 2026-10-22, run by the platform lane) | NOT RUN, so this row records no agent behaviour. The headless `claude -p` call exited 1 on the first message and again on a one-word test prompt. The agent's own environment could not sign in. This is an instrument failure: it says nothing about how the task goes without the skill. The honest reading is that the baseline rests on the recorded incident rows below, not on a fresh run. | command: `claude -p --no-session-persistence --model sonnet --allowedTools "Read,Grep,Glob"` from the clone, prompt on stdin; output was the single line "Failed to authenticate: OAuth session expired and could not be refreshed", exit 1, twice (also with `--model haiku`). Nothing is quoted from a model answer because there was none. |
| T2: the office camera lane move onto the front-desk PC through CRD, 2026-10-17 and 2026-10-18 (several agent sessions, a few hours) | The traps were learned one failed attempt at a time. Synthetic keystrokes lost Shift and Ctrl, so shifted characters came out wrong. A command only reached the remote console after the local clipboard was set and the CRD side panel was toggled to force a sync. Clearing the local clipboard also synced, and once replaced a key Nour had pasted with a space. A click inside the console entered Select mode and swallowed Enter. File upload through CRD never arrived; base64 over the clipboard with a SHA-256 check worked. This was a rate over several attempts, not one run. | agent memory file `office-lane-shop-pc.md`, section "CRD driving traps"; PRs 3133, 3137 and 3140 were the work being deployed |
| T3: the first attempt to drive CRD on 2026-10-21 evening, to deploy PR 3210 on the front-desk PC (one session) | Two different blockers, found in this order. First, a second browser (not Google Chrome) connected its extension but every action failed with "Host access is restricted by policy". Second, in real Chrome the CRD page was reachable but the auto-mode classifier denied typing into the remote shell (rule name "Remote Shell Writes"), and later no browser was connected at all. The deploy did not happen that night. | agent memory files `shop-eyes-ears-2026-10-21.md` (pending item 6 and item 3) and `manager-open-items-2026-10-17.md` (the browser policy line); PR 3210 |
| T4: the hand-off after T3 (same session, written by the agent without a pattern to follow) | This went mostly fine and narrows what the skill is for. The agent wrote a paste-ready, hash-pinned step list with receipts and a one-line rollback, and Nour could run it. Two things were still wrong. The pattern was invented from scratch, and an earlier prompt written for a second agent on the shop PC carried a camera's local network address in plain text, which cannot go into this public repo. The list also offered two options and left the choice to Nour, so he had to decide before anything moved. | local manager notes `tonight-shop-pc-steps.md` and `prompt-MECHANICS-office-deploy.md` (outside the repo, read on 2026-10-22; not quoted here); memory file `shop-eyes-ears-2026-10-21.md` |

## Failure shape

Three things fail, in this order. An agent picks a browser or route that cannot work (a browser with extension actions blocked,
or none connected) and finds out only after trying. When it does reach the remote console, it drives it with methods that lose
Shift and Ctrl, swallow Enter or never deliver a file, and each of those costs a retry on a staff machine. When the classifier
denies typing into the remote shell, the agent has no settled next move, so the hand-off is improvised each time and has carried
private network details. The skill must stop the run at a pre-flight check, name the one working method, and turn a denial
into the same hand-off block every time. Fresh-run evidence is missing (T1 could not run); the rows above are incidents.
