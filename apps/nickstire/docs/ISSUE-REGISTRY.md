# Nick's Tire & Auto — Revenue Operations Issue Registry

**Last verified:** 2026-07-20

A code change is not production verification. Status must follow evidence.

| ID | Title | Verified | Status | Severity | Current evidence | Owner | Correction and regression protection |
|---|---|---|---|---|---|---|---|
| ROS-001 | GSC detail sums used as headline totals | 2026-07-11 | Verified | High | Database reports sum bounded query/page/date/device/country rows | Engineering | Use no-dimension official aggregate; expose separate detail coverage; test partial detail |
| ROS-002 | Straight-average GSC CTR and position | 2026-07-11 | Verified | Medium | Several detail reports average stored CTR or position | Engineering | Recompute CTR from clicks/impressions and weight position by impressions |
| ROS-003 | Legacy voice conversion flag means tool engagement | 2026-07-20 | Deployed | Critical | Re-measured in production 2026-07-20: 451 calls carry `convertedToLead = 1`, **0** have a `leadId`, `leads` holds 2 rows. Operator-facing labels corrected (#970/#971): `totalConverted` → `totalReachedTool`, badge copy "leads captured" → "calls engaged", customer-timeline badge "converted" → "engaged"; `controlCenter` already exposed it as `reachedTool24h`. Column itself retained for compatibility | Engineering | Labels now state what the column measures. Underlying rename/versioned-fact migration still open |
| ROS-004 | Tool-only call classified as hard conversion | 2026-07-11 | Verified | Critical | Classifier accepts reached-tool and legacy flag | Engineering | Require persisted lead, callback or booking evidence; add regression tests |
| ROS-005 | Voice quality score restates commercial outcome | 2026-07-11 | Verified | High | Base score is assigned from outcome category | Engineering | Independent versioned quality rubric and independence tests |
| ROS-006 | Voice admin labels and denominators are ambiguous | 2026-07-11 | Verified | Not recorded | Hard Conversions and generic rates combine unlike stages | Product / Engineering | Show explicit stages, evidence levels and denominators |
| ROS-007 | Receptionist value is modeled but resembles recovered revenue | 2026-07-11 | Verified | Not recorded | Classified calls are multiplied by average paid ticket and a close-rate assumption | Finance / Engineering | Rename modeled pipeline value; disclose assumptions; separate verified revenue |
| ROS-008 | Technical failures disappear from quality average | 2026-07-11 | Verified | Not recorded | Failures receive no score and are excluded from valid-conversation average | Engineering | Report reliability separately and always expose failure denominator |
| ROS-009 | Prerender guard lacks semantic parity | 2026-07-11 | Verified | Not recorded | Existing guard checks file presence, not content truth | SEO / Engineering | Assert title, description, H1, canonical, NAP and JSON-LD on key routes |
| ROS-010 | Active instructions point to missing current docs | 2026-07-11 | Verified | Not recorded | Agent instruction files reference paths absent from active tree | Engineering | Point to `docs/CURRENT-TRUTH.md` and maintained protection docs |
| ROS-011 | Repository history contains previously removed sensitive records | 2026-07-11 | Accepted risk | Not recorded | Current tree removal does not rewrite prior commits | Repository owner | Complete a coordinated incident and history-remediation procedure outside Wave 1 |
| ROS-012 | Secret scanner reports historical findings | 2026-07-11 | Accepted risk | Not recorded | Repository-wide scan remains red after current-tree cleanup | Repository owner | Inventory and rotate affected material, then coordinate history remediation |
| ROS-013 | Arrival and paid-call attribution are not universally linked | 2026-07-11 | Verified | Not recorded | Operational tables exist without a universal canonical call linkage | Operations / Finance | Add defensible matching and manual resolution in a later wave |
| ROS-014 | `bookSlot` name implies booking but returns walk-in guidance | 2026-07-11 | Verified | Not recorded | Procedure bypasses bookings and returns `WALKIN-INFO` | Voice / Engineering | Preserve tool name for compatibility; report the observed result accurately |
| ROS-015 | Old route and NAP audit findings are repeated after fixes | 2026-07-11 | Stale | Not recorded | About, contact, route registry and shared business constants exist | Engineering | Keep audit records dated and reconcile through this registry |
| ROS-016 | Forwarded-call SMS apologised for calls the shop answered | 2026-07-20 | Deployed | High | `vapi_forwarded_call_followup` fires on ended reason `assistant-forwarded-call` — VAPI's **successful** hand-off — with no duration floor. Two of three copy variants opened "Sorry we missed your call" | Voice / Engineering | Copy neutralised for both webhook and cron paths (#940); meaning-level test forbids any missed-call claim. Exposure was ~20% (weighted 80/10/10 A/B), not the ~67% first reported |
| ROS-017 | Forwarded-call SMS idempotency key was a silent no-op | 2026-07-20 | Deployed | Medium | Call site omitted `vapiCallId`, so the key fell through to `Date.now()+Math.random()` — unique by construction, so the check could never match. Real dedupe rested only on a 24h phone cooldown | Engineering | `vapiCallId` now passed (#940). This also restored the cron sibling's documented "never re-texted by the webhook path" property, which was false until then |
| ROS-018 | Voice agent stated fabricated wait times | 2026-07-20 | Deployed | High | Three sources: `getCurrentWaitTime` (24h booking count vs a hardcoded 6-bay heuristic), `capacityCheck` (**no data source** — flat `estimatedWaitMinutes: 30`, invented windows), and `vapi-bdi` feeding load into the **greeting**, so calls could open unprompted with "we're super slammed today with about an hour wait" | Voice / Operations | All three removed (#940). Wait questions hand off to a person per operator directive; contract tests forbid emitting any wait figure |
| ROS-019 | Rack-check promised a callback nothing tracked | 2026-07-20 | Deployed | High | `checkTireStock` wrote an urgency-5 lead, fired Telegram and told the caller the front desk would follow up. No field, table or mutation ever recorded completion | Voice / Operations | Tool now hands off to a person and persists nothing (#940); promise removed from tool, tool definition and system prompt. See CURRENT-TRUTH "Lead and booking creation" |
| ROS-020 | Restart destroyed queued SMS; 136 messages stranded | 2026-07-20 | Verified in production | Critical | Boot rehydration read the drizzle UPDATE result as `claim?.affectedRows`, but drizzle-orm/mysql2 types it as a **tuple** `[ResultSetHeader, FieldPacket[]]`. Claim always evaluated to 0 rows, so every restart moved up to 100 messages `queued → sending` and sent none — and `rehydrated` stayed 0 so even the log line never printed. 136 messages to 103 people accumulated 2026-06-02 → 2026-07-19 | Engineering | Fixed via shared `affectedRowCount` (#962/#965). Backlog released in two passes, **132 of 136 delivered**; remaining 4 resolved to `failed` (2 were internal digests, 2 were six-week-old "sorry we missed you" notes deliberately not sent) |
| ROS-021 | Outbound SMS non-sends left no trace | 2026-07-20 | Deployed | High | Five `sendSms` exits returned silently (invalid phone, daily cap, opted out, quiet-hours queue, gateway-offline queue) and the drain's two gates returned silently every 60s. A message that never reached a customer produced no log anywhere — the direct reason ROS-020 took a full session to diagnose | Engineering | Every non-send logs a reason; drain logs hold/resume **transitions** only, avoiding ~1440 lines/day of noise (#970) |
| ROS-022 | Outbound SMS carried a doubled shop name | 2026-07-20 | Deployed | Medium | `humanizeCopy` ran `replace(/\bNick's Tire\b/gi, "Nick's Tire & Auto")`, which also matches the prefix of an already-correct name, producing "Nick's Tire & Auto & Auto". The "and Auto" rule ran second and could never match — dead code. **374 sent messages carried it; 312 confirmed delivered, 2026-06-24 → 2026-07-20** | Engineering | Spelled-out variant normalised first; bare rule guarded by a negative lookahead. Idempotence pinned by test (#955) |
| ROS-023 | Feature-flag toggle could report success without persisting | 2026-07-20 | Deployed | Medium | `setFlag` ran an UPDATE then set the cache unconditionally. With no row the UPDATE matched zero rows and threw nothing, so the admin UI reported "toggled", the flag read as changed for `CACHE_TTL_MS`, then reverted silently — the failure mode of an off-switch | Engineering | Inserts the row when missing and warns (#955). Directly underpins the `vapi_forward_followup_paused` kill switch (#946) |

## Status definitions

- Reported: not reproduced.
- Verified: reproduced in current evidence.
- In progress: implementation underway.
- Fixed locally: edited, checks incomplete.
- Verified locally: relevant local checks passed.
- Deployed: production received the change.
- Verified in production: live behavior confirmed.
- Closed: correction and regression protection verified.
- Stale: no longer current.
- False positive: disproved.
- Accepted risk: consciously deferred with owner.
- Blocked: requires unavailable credentials or external action.

## Wave 1 closure rule

ROS-001 through ROS-010 and ROS-014 require code or documentation correction plus regression evidence. ROS-011 through ROS-013 may remain open only with a named owner, limitation and next action.