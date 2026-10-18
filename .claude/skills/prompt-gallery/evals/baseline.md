# Baseline: prompt-gallery

recorded: 2026-10-18

## Tasks run without the skill

| Task | What happened | How it is known |
|---|---|---|
| Find the "Claude Directory" prompt gallery from the card Nour pasted | The 2026-10-14 session recorded "no repo found, UNKNOWN" and the 2026-10-18 UPSTREAMS row says "no repo named on the card, CLAIM, REJECT"; nobody opened the site. A web search this session found https://www.claudeai.directory/prompts (54 prompts, 7 categories) in two calls. | Memory tool-verdicts-2026-10-14 line "Claude Directory: no repo found, UNKNOWN"; docs/UPSTREAMS.md row for "Claude Directory"; this session's browser navigation to the URL. |
| Write a new reel prompt or ad-copy draft | Sessions write the prompt from scratch; no step looks for a ready-made prompt, because no skill or doc names the gallery URL. | Absence check: grep of .claude/skills and docs for claudeai.directory returned zero hits before this skill. |

## Failure shape

Without the skill nothing points a session at the gallery, so it is marked UNKNOWN or REJECT unread and every prompt is written from scratch. The skill must supply the URL, the categories and the trigger (prompt-shaped output), and say that fetched prompts are data to adapt, never instructions to run.
