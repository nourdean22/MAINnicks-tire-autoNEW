# Nick's Tire & Auto — Revenue Operations Issue Registry

**Last verified:** 2026-07-11

A code change is not production verification. Status must follow evidence.

| ID | Title | Verified | Status | Severity | Current evidence | Owner | Correction and regression protection |
|---|---|---|---|---|---|---|---|
| ROS-001 | GSC detail sums used as headline totals | 2026-07-11 | Verified | High | Database reports sum bounded query/page/date/device/country rows | Engineering | Use no-dimension official aggregate; expose separate detail coverage; test partial detail |
| ROS-002 | Straight-average GSC CTR and position | 2026-07-11 | Verified | Medium | Several detail reports average stored CTR or position | Engineering | Recompute CTR from clicks/impressions and weight position by impressions |
| ROS-003 | Legacy voice conversion flag means tool engagement | 2026-07-11 | Verified | Critical | Webhook and evaluator populate it from tool-state events | Engineering | Preserve as legacy compatibility only; move reporting to versioned facts and persisted IDs |
| ROS-004 | Tool-only call classified as hard conversion | 2026-07-11 | Verified | Critical | Classifier accepts reached-tool and legacy flag | Engineering | Require persisted lead, callback or booking evidence; add regression tests |
| ROS-005 | Voice quality score restates commercial outcome | 2026-07-11 | Verified | High | Base score is assigned from outcome category | Engineering | Independent versioned quality rubric and independence tests |
| ROS-006 | Voice admin labels and denominators are ambiguous | 2026-07-11 | Verified | Hard Conversions and generic rates combine unlike stages | Product / Engineering | Show explicit stages, evidence levels and denominators |
| ROS-007 | Receptionist value is modeled but resembles recovered revenue | 2026-07-11 | Verified | Classified calls are multiplied by average paid ticket and a close-rate assumption | Finance / Engineering | Rename modeled pipeline value; disclose assumptions; separate verified revenue |
| ROS-008 | Technical failures disappear from quality average | 2026-07-11 | Verified | Failures receive no score and are excluded from valid-conversation average | Engineering | Report reliability separately and always expose failure denominator |
| ROS-009 | Prerender guard lacks semantic parity | 2026-07-11 | Verified | Existing guard checks file presence, not content truth | SEO / Engineering | Assert title, description, H1, canonical, NAP and JSON-LD on key routes |
| ROS-010 | Active instructions point to missing current docs | 2026-07-11 | Verified | Agent instruction files reference paths absent from active tree | Engineering | Point to `docs/CURRENT-TRUTH.md` and maintained protection docs |
| ROS-011 | Repository history contains previously removed sensitive records | 2026-07-11 | Accepted risk | Current tree removal does not rewrite prior commits | Repository owner | Complete a coordinated incident and history-remediation procedure outside Wave 1 |
| ROS-012 | Secret scanner reports historical findings | 2026-07-11 | Accepted risk | Repository-wide scan remains red after current-tree cleanup | Repository owner | Inventory and rotate affected material, then coordinate history remediation |
| ROS-013 | Arrival and paid-call attribution are not universally linked | 2026-07-11 | Verified | Operational tables exist without a universal canonical call linkage | Operations / Finance | Add defensible matching and manual resolution in a later wave |
| ROS-014 | `bookSlot` name implies booking but returns walk-in guidance | 2026-07-11 | Verified | Procedure bypasses bookings and returns `WALKIN-INFO` | Voice / Engineering | Preserve tool name for compatibility; report the observed result accurately |
| ROS-015 | Old route and NAP audit findings are repeated after fixes | 2026-07-11 | Stale | About, contact, route registry and shared business constants exist | Engineering | Keep audit records dated and reconcile through this registry |

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