# Customer Conversation Audit — 2026-09-30

## Scope
Read-only production analysis of customer phone + SMS interactions from 2026-07-03 through 2026-09-30. Raw customer identifiers and full transcripts are intentionally excluded from this repository artifact.

## Corpus
- VAPI call rows: **3,048**
- Calls with parsed customer turns: **2,438**
- SMS rows: **5,472**
- Inbound SMS: **143**
- Outbound SMS: **5,329**
- SMS failed rows: **148**
- Median immediate automated reply latency where a reply followed first inbound: **4 s**

Categories below overlap and are keyword-derived, so they are directional—not a mutually exclusive demand model.

### Voice demand signals
- Human/person request: 882
- Tire: 612
- Hours/location: 347
- Price: 320
- General repair: 173
- Brakes: 168
- Visit/appointment intent: 149
- Used-tire explicit: 80
- Oil: 62

### Call end states
- Customer ended call: 1,474
- Assistant forwarded call: 1,377
- Customer ended before warm transfer: 99
- Silence timeout: 37

## Findings
1. **Used-tire-first is not supported by the customer-turn corpus.** Tires remain important, but an explicit used-tire request is a minority signal. Start neutral, then specialize fast.
2. **Human requests are a major lane.** First-ask transfer behavior should remain a hard rule.
3. **Long assistant turns create interruption friction.** Keep one idea and one question per turn; deliver multi-beat closes as separate beats.
4. **Operational facts must stay evidence-bound.** Remove claims such as a predictable mid-day line when no live capacity feed exists.
5. **Avoid diagnosis-shaped persuasion.** A squeak does not justify telling a caller it is probably only pads. Use urgency without pretending to know the cause.
6. **Avoid unsupported superiority claims.** Replace dealer/chain superiority language with concrete shop process: inspection, written quote, customer approval.
7. **SMS truncation was a historical production defect, not a current-main gap.** PR #2767 (2026-09-29) added provider finish-reason handling so truncated/unknown drafts are held instead of auto-sent. Last 2 days of the audit had zero detected fragment replies.
8. **SMS autonomy is live, but the NickGPT fine-tune is not serving.** Production has smart auto-reply + low-risk auto-send + nickgpt_drafter flags enabled, while the Ollama URL/model are absent. Current AI drafts therefore use the fallback provider.
9. **The SMS persona should represent the shop, not impersonate Nick.** Automated messages may sound local and human without falsely implying Nick personally typed them.
10. **Thread continuity matters more than generic friendliness.** When a customer supplies a tire size, vehicle symptom, quantity, or arrival time, answer that state directly instead of restarting the funnel.

## 30-day SMS drafter snapshot
- Fallback-provider drafts held for review: 77
- Fallback-provider drafts auto-sent: 11
- Mean generation latency: ~1.3–1.5 s
- Most complex/low-confidence inbound replies correctly route to operator review.

## Changes in this branch
- Neutral voice opening policy instead of USED-TIRE-first.
- One-idea / one-question phone-turn guidance; 18-word target while preserving the existing 25-word hard exemplar cap.
- Removed invented mid-day queue claim.
- Removed unsupported dealer/chain superiority phrase.
- Replaced squeak→pads implication with non-diagnostic urgency.
- SMS persona now identifies as Nick's Tire & Auto's texting assistant, not Nick personally.
- SMS persona pins thread continuity, one-question replies, direct handling of supplied tire sizes/quantities, and non-engagement with obvious spam/solicitation.
- SMS brake-price playbook now distinguishes squeak/grind/shake without claiming which part is worn; remote-diagnosis guard applies to that lane.
- NickGPT fine-tune runbook is aligned so a future Ollama model does not reintroduce the old Nick-impersonation persona.
- Regression tests pin all of the above.

## Not changed yet
- No live VAPI assistant push from this branch.
- No production rollout-mode or feature-flag changes.
- No raw transcript/customer data committed.
- No NickGPT fine-tune/retrain attempted.
- Broader urgency-library mechanic claims should receive a separate mechanic-truth audit before further edits.

## Forensic continuation checkpoint — 2026-10-01

This section records the deeper read after the first corpus pass. It separates live evidence from code-only findings and does not treat a mechanism as healthy merely because it exists.

### LIVE + VERIFIED / observed in production

1. **The weekly VAPI prompt-evolution loop failed on its latest observed scheduled run.**
   - Railway production logs show `prompt-evolution-weekly` failed with `timeout` on 2026-09-28 and then held its cron lock under `CRON_TIMEOUT_LOCK_HELD`.
   - The scheduler default is 4 minutes. This job does not declare a custom `timeoutMs`.
   - The job can perform baseline train + holdout ghost replays, candidate generation, candidate train scoring, and holdout scoring; individual optimizer calls allow up to 120 seconds. The latest run therefore cannot be classified healthy from wiring alone.
   - State: **BROKEN on latest observed run** until a subsequent successful production receipt proves recovery.

2. **Marketing-SMS consent enforcement is intentionally shadow-only, and production traffic continues to hit the refusal condition.**
   - Production logs from 2026-09-28 through 2026-10-01 repeatedly show: `consent gate SHADOW — this marketing send would be refused once armed`, `messageClass=customer_marketing`, `why=no recorded opt-in`.
   - Repo authority check found an explicit 2026-08-09 operator decision in `NOUR-ACTION-REQUIRED.md` to keep this gate in shadow rather than silently block the existing marketing lanes. This is therefore not an accidental forgotten toggle.
   - Current FCC materials continue to treat advertising/telemarketing robotext consent as compliance-sensitive; the exact rule applicable to a Nick's send depends on the sending technology and facts. Do not silently arm OR remove the gate from this audit branch.
   - State: **LIVE + INTENTIONALLY SHADOWED / COUNSEL-REVIEWABLE**. Keep customer-service replies and transactional traffic analytically separate from marketing traffic, and do not use shadow-miss marketing traffic as clean evidence for autonomous promotion.

3. **Warm-transfer friction remains visible in live calls.**
   - In the 2026-10-01 production window sampled from 12:07Z through 15:32Z, 19 unique call-end events were observed:
     - 8 customer-ended-call
     - 6 assistant-forwarded-call
     - 4 customer-ended-call-before-warm-transfer
     - 1 silence-timed-out
   - This is a point-in-time operational sample, not a population estimate. It is enough to keep transfer abandonment as an active optimization lane.

4. **The call-state start signal is noisy by construction.**
   - The VAPI webhook handles both `status-update` and `call-start` in the same branch, logs both as `Vapi call started`, and appends a `greeted` state for either.
   - The 2026-10-01 live window showed repeated `Vapi call started` log entries for the same call IDs before one final end event.
   - State: **LIVE + VERIFIED telemetry duplication**. This does not by itself prove customer harm, but any metric that counts `greeted` state rows instead of unique calls is unsafe until deduped.

### BUILT / code findings that need production proof

5. **Transfer outcome persistence had a confirmed analytics failure and the risky statement still exists.**
   - Railway logs on 2026-09-27 show connected transfer artifacts failing to persist with the TiDB JSON update path.
   - Current `main` still writes `metadata.transferArtifact` via `JSON_SET(... CAST(... AS JSON))` in the same webhook area.
   - No recurrence was found in the sampled current-deployment logs, but no successful transfer-artifact persistence receipt was captured either.
   - State: **LIVE BUT UNVERIFIED after a historical failure**, not fixed-by-assumption.

6. **The optimizer already consumes verified revenue truth defensively, but it does not yet optimize on downstream business lift.**
   - `loadSeeds()` joins the existing revenue-reconciliation candidates and operator attribution decisions. A verified paid conversion (direct call→lead→paid-invoice, or an operator-confirmed decision carrying an invoice) is excluded from the failure pool so a mislabeled win cannot train the optimizer to "fix" a call that actually converted.
   - Weaker phone/time/service matches stay inferred/manual-review and are not promoted to verified truth; a manual-review near-miss may remain a seed with that uncertainty annotated.
   - The remaining gap is positive learning: the weekly loop still grades ghost-replayed conversational resolution / claim defects. It does not mine which strategies made verified paid wins work, nor require measured arrival, paid-invoice, repeat-visit, margin, or revenue lift before promoting a challenger proposal.
   - State: **BUILT + WIRED + REVENUE-GUARDED failure loop; MISSING positive win-mining / causal outcome promotion**.

7. **Pricing authority is internally contradictory and must be resolved before more autonomous tuning.**
   - A June operator decision documented a two-tier strategy: website/SEO can use the $25 installed loss-leader floor with qualifiers, while high-intent quoting channels use $60.
   - A July SMS-persona change explicitly treated the $60 SMS floor as drift and moved SMS to the BUSINESS-driven $25 floor/band.
   - Current `AGENTS.md` again says quoting channels use $60.
   - VAPI currently speaks $60; SMS code reads BUSINESS-driven pricing.
   - State: **CONFLICTING AUTHORITY**. No optimizer should infer the winner from corpus performance. Create one versioned channel-pricing policy and generate VAPI/SMS tests from it.

8. **Persuasion truth needs a doctrine, not phrase-by-phrase cleanup.**
   - #2839 removes several unsupported or diagnosis-shaped phrases, but the VAPI prompt still contains universal competitor language such as `any other shop charges to even look, we don't`.
   - State: **PARTIALLY FIXED**. Add a reusable claim rule: never assert universal competitor behavior, unverifiable superiority, or remote mechanical diagnosis; persuade with Nick's own verifiable process and offers.

### Next dependency-ordered work

1. Repair and receipt the weekly prompt-evolution runtime budget before treating self-improvement as operational.
2. Preserve the recorded marketing-consent shadow decision unless the operator deliberately changes it after current compliance review; separately classify customer-service/transactional vs marketing learning traffic.
3. Make transfer truth durable and prove one live attempted → connected / failed artifact round-trip.
4. Version and reconcile channel pricing authority.
5. Join prompt/response version → call → expected arrival/work order → paid invoice where evidence is direct; keep inferred joins out of autonomous promotion.
6. Make experiment promotion depend on business outcomes plus safety/claim invariants, not conversational score alone.
7. Continue the mechanic-truth + persuasion-truth audit across VAPI and SMS.

