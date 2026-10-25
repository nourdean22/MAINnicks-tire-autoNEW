# Relay: the turn contract and the relay check (steps 8 and 16, and every turn)

Nour sees only what the manager tells him. A session's wrong claim becomes the manager's false statement the moment it
is passed on (Nour, 2026-10-22: "even if another session messes up or doesn't know history, that's your job to
doublecheck and not relay me false information"). Everything below is about that layer: what reaches Nour, and what
must be true before it does.

## The turn contract (every manager turn)

| # | Rule | Enforced by |
|---|---|---|
| 1 | A SessionStart `[health] ... FIX FIRST:` line is the first task: run the fix, or end the reply with `Health: not fixed, because <reason>` | `scripts/agent-os/health-first.mjs` (Stop, once per line) |
| 2 | Invoke the skills first; the reply's `Skills:` line names ONLY skills with a Skill call in this turn; anything from earlier goes behind `used earlier:` | `scripts/agent-os/skills-check.mjs` (Stop, once per prompt) |
| 3 | A CI state is the tally read THIS turn (`gh pr checks <n>`); "green", "passing", "mergeable" with no read this turn is sent back | `skills-check.mjs`, CI claim arm |
| 4 | "Live" needs a production read THIS turn (nickstire `/api/health` `.deploy.commit`, statenour heartbeat, Railway deployment list); merge is not deploy | `skills-check.mjs`, live claim arm |
| 5 | "Checked", "verified", "confirmed" carry the receipt in the same sentence (command and its summary line) | written rule only: no check can tell a receipt from a paraphrase |
| 6 | Before relaying any session or lane claim, run the relay check below | written rule; rows 3 and 4 catch the CI and live forms |
| 7 | An intent line of 8 words or fewer before each tool call; answer first, ranked options, a confidence percent on judgment calls | `answer-first`, memory `feedback-manager-voice-rules` |
| 8 | Ask Nour only about the four protected classes in `.agents/core/USER.md` (spending money, customer-facing sends, production database writes, credentials) and the rest of `AGENTS.md` > Protected operations, which stay never on agent initiative. A step inside an order he gave is decided, done, then reported: dispatch, a fast-forward or pull, a gate re-run, a docs PR, a merge on green of a change he asked for in words (policy, guard and skill edits included), and line-ending or stash cleanup (`node scripts/agent-os/eol-restore.mjs <path>` then `git merge --ff-only origin/main`; your own tagged entry: `node scripts/agent-os/stash-drop-tagged.mjs <tag>`). The wrap-up question box asks only about one of the four. Nour, 2026-10-25: "Why do you have to come to me for one little step?" | written rule only (SKILL.md turn row 5, steps 3, 14, 15) |

Pre-clear (step 3) names the action, the file and the condition, for example "merge a Dockerfile heap fix if the bdnick
build dies of OOM". A Railway variable approval (`infra-approve.mjs`) lasts 30 minutes, so it cannot be pre-cleared.

A hook that sends a turn back once is a seatbelt, not a driver: rows 1-4 catch the forms that were seen on 2026-10-22,
and every sentence still has to be true on its own.

## The relay check (before a claim from a session or lane reaches Nour)

Ask of every sentence you are about to pass on: who measured this, and did I check it?

1. **Classify the claim.**
   - Shop, money, customers, staff: anything about invoices, estimates, declines, revenue, bookings, payments.
   - Absolutes: never, zero, none, all, every, "no X exists".
   - State: merged, deployed, live, green, fixed, passing.
   - Plans and opinions: "next I will", "I recommend".
2. **Check it against the shop's own meanings first** (`.agents/core/USER.md` > Shop data meanings; memory
   `shop-data-meanings`). Witness: "0 declines ever captured" was TRUE only for counter-recorded declines and FALSE for
   declines (an estimate with no invoice is the decline). State which one the session measured.
3. **Then against memory** (the index and the topic file for the area) and **the source** (the code, a SELECT-only read
   through `prod-db-guard`, `gh`, `/api/health`). One cheap read beats a paragraph of hedging.
4. **Forward the receipt, do not paraphrase it.** LangGraph's supervisor added a `forward_message` tool because a
   supervisor that paraphrases a worker misrepresents it (benchmark row B3). Quote the session's receipt line with its
   source ("the shop-ears session: `/api/health` reports f36b747a3 at 05:22Z"), then add what YOU checked.
5. **Label what you could not check.** "The scout reports X (its claim, not checked by me: needs a SELECT on Y)". A claim
   without a label reads as the manager's fact.
6. **Correct upstream.** When a session got a shop or history fact wrong, tell it in one message (NO REPLY NEEDED, the
   fact and its source) and fix the brief template or memory gap that let it happen, in the same turn.

## Witnesses (2026-10-21/22, manager transcript 0900c49a)

| Claim relayed | What was true | Which check would have caught it |
|---|---|---|
| "0 declines ever captured" (upgrade scout) | 0 RECORDED at the counter; unmatched estimates are the declines | step 2 above (shop meanings) |
| "All 4 remaining PRs are green and mergeable" | read in an earlier turn, not this one | turn contract row 3 (now a hook) |
| "The Telegram cleanup is live" (and two more, 05:23-05:27Z) | the sessions' own receipts; the manager ran no read | turn contract row 4 (now a hook), or quote the receipt with attribution |
| `Skills:` lines naming uninvoked skills, 22 of 128 lines (155 turns, 2026-10-21T20Z to 2026-10-22T14Z) | the names came from earlier turns | turn contract row 2 (now a hook) |
