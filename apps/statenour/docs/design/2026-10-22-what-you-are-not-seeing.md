# What you're not seeing: design (2026-10-22)

Evidence: [`docs/research/2026-10-22-insight-engines-audit.md`](../research/2026-10-22-insight-engines-audit.md).
Asked for by Nour 2026-10-21: a more insightful Nick, a more organized brain, blind spots diagnosed.

## The problem in one line

The brain already finds real gaps every night (claims vs record, decisions never reviewed), but its
best output reaches nobody, and the places Nick does read are fed by empty or duplicate sources.

## Two approaches

| | A · Wire what exists (picked) | B · One new weekly engine |
|---|---|---|
| What | Route the live outputs (thinking-engine contradictions, overdue decision replays) into the two places Nour already uses: Nick's chat context and, behind a default-OFF flag, one weekly note. Filter stale duplicates out of recall. Retire dead sources. | A new weekly LLM pass over every source plus the shop day, writing one ranked "not seeing" note; retire the four nightly miners. |
| Cost | Small PRs, no new tables, no new cron | New cron, new prompt, new store, a migration of readers |
| Risk | Low; every step has a kill switch | Rebuilds what already produces, adds a second ranking of the same signal |
| Why not | | The audit shows the gap is wiring, not detection. Building a detector before the existing one is read repeats the pattern that produced 15 engines |

## Build order (one PR each, smallest first)

1. **Claim vs record in chat (this PR).** `findRelevantClaimGap` reads open rows from the
   `contradictions` table, matches them to the turn (cosine >= 0.47, calibrated on prod vectors), and
   adds one CLAIM VS RECORD block: answer first, then one line asking "is the record wrong or the
   plan?" At most one a day, never the same topic twice in a week, never on a private turn.
   Kill switch `NICK_CLAIM_GAP=0`.
2. ~~Recall hygiene for stale `blind_spot` rows.~~ **Dropped on evidence (2026-10-22):** recall does
   bump `last_seen` (60 insight/wisdom rows seen in 2 days), yet only 12 of the 216 stale blind-spot
   rows were ever recalled, the last on 2026-09-06. A filter at six recall call sites would buy
   nothing measurable. The soft archive stays optional cleanup for Nour (a prod write).
3. ~~Decisions past review in chat.~~ **Dropped:** Nour rejected the `decision_review_due` rule in
   prune wave 3 (RECONCILIATION 2026-10-19). A chat nudge for the same thing is the same nag.
   ~~A tool to close a claim-vs-record row~~ **deferred:** Nour answers on the NEXT turn, where the
   block (and its row id) is no longer in context; the 7-day topic cooldown already stops repeats
   and the 30-day auto-expiry closes rows. Revisit if the kill-criterion read shows repeats.
4. **Dead code.** Delete `insight-meta.ts` (orphaned) and the nudge sources that read categories
   with no writer (`hq_pin_candidate`, `decision_drift`); keep sources whose writers still exist.
5. **Weekly note, preview only.** "What you're not seeing this week": open gaps, overdue decisions,
   shop numbers that moved (cars counted, sales, estimate close rate over the existing bridge reads
   `cars_today`, `revenue_range`, `estimates_conversion`). Sending stays OFF until Nour says go; he
   stopped the old scheduled briefs on 2026-10-18.

## Kill criteria

- Claim vs record fires on more than 1 in 5 chat turns (`contextBlocks.claimGap`), or Nour waves it
  off 3 times in 2 weeks: raise `CLAIM_GAP_THRESHOLD` or set `NICK_CLAIM_GAP=0`.
- It fires on fewer than 1 in 50 turns over 2 weeks with open rows present: the bar is too high;
  read the `[claim-gap] score` log line and lower it.
- If Nour says a gap was wrong because the record was incomplete more often than not, the thinking
  engine is reading missing logs as missing behaviour; fix the engine's prompt before surfacing more.
