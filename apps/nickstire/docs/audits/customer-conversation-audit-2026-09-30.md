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
- Regression tests pin all of the above.

## Not changed yet
- No live VAPI assistant push from this branch.
- No production rollout-mode or feature-flag changes.
- No raw transcript/customer data committed.
- No NickGPT fine-tune/retrain attempted.
- Broader urgency-library mechanic claims should receive a separate mechanic-truth audit before further edits.
