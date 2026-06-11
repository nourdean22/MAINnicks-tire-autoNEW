# Next Best Actions — Ranked

Companion to [PROJECT-COMPLETION-LEDGER.md](./PROJECT-COMPLETION-LEDGER.md).
The ledger says what's true; this says what to do, in order. Scores 1-10
(higher = more). Updated 2026-06-10 (late night) after the 11-PR ship —
main `a231e449`. The old rank-1 (merge the PR stack) is DONE: #46-#55
all merged; the queue below is what's actually left.

| Rank | Action | Domain | Impact | Danger | Effort | Owner needed | Why |
|---:|---|---|---:|---:|---:|---|---|
| 0 | **🔴 ROTATE leaked production credentials** | security | 10 | 8 | 2 (owner) | **YES — urgent** | Complete owner-controlled zero-downtime credential rotation using [CREDENTIAL_ROTATION.md](./operator/CREDENTIAL_ROTATION.md). Avoid committing actual values to the repository. |
| 1 | **Post-deploy phone smoke** — Admin → Tire Orders / Ops Hub / Growth / both studios; armed-state card should read DISARMED + dry-run ON; reviews-health card answers the old "Place ID reliability" unknown | verification | 7 | 1 | 0 (5 min) | **yes — your phone** | Eleven PRs deployed at once; 5 minutes of eyes converts "gates green" into "live verified" and closes two ledger UNKNOWNs for free. |
| 2 | **Work the Growth tab** — post the 17 GBP Q&A seeds (~15 min), then this week's 6-photo queue | local SEO | 8 | 1 | 2 (owner) | **yes — GBP login** | The highest-ROI manual work the new admin enables. Q&A + weekly photos are the strongest free local-rank signals; everything is copy-paste-ready with claim-safe copy. |
| 4 | **Approve refund/writeback design** → dedicated PR | money | 8 | 7 (gated) | 4 | **yes — approval** | Design doc shipped (#47): `apps/nickstire/docs/refund-writeback-design.md`. Closes the last manual money loop. Ships only post-approval with idempotency + audit trail. |
| 5 | **Decide the used-tire price channel policy** ($25 web vs $60 phone/SMS/IG/voice) | pricing truth | 7 | 2 | 1 | **yes — decision** | The single biggest remaining honesty split (igAutopost.ts:683 still says $60). One decision, then a small sweep PR aligns every channel. |
| 6 | **D&K: get new portal API docs/credentials** from the rep | supplier | 9 | 2 | 1 (owner) then 6 (repair PR) | **yes — external** | Unblocks live availability + order-time stock rechecks. Highest revenue-protection item that's pure owner legwork to start. |
| 7 | **Customer confirmation sends** — approve provider + copy | customer UX | 7 | 6 (gated) | 3 | **yes — approval** | Templates + previews live in Ops Hub; customers currently hear nothing automatically. Cheap win once approved (reuses the existing SMS gateway). |
| 8 | **Sheets first-row watch** | ops | 4 | 1 | 0 | no | Tab + 24 headers verified; just confirm the next online order lands a row. |
| 9 | **Entity cleanup** — work Admin → Growth → Entity/Brand top-to-bottom (GBP → Yelp → FB first) | local SEO | 6 | 1 | 2 (owner) | **yes — logins** | Checklist now lives in the admin with canonical NAP + copy buttons. Nothing automatable; compounds quietly. |
| 10 | **Env-validate hardening** (warn when STRIPE_SECRET_KEY set without STRIPE_WEBHOOK_SECRET) + coverage include for money-path files | devops | 5 | 1 | 2 | no | The admin banner covers runtime; this catches it pre-deploy too. Coverage thresholds still exclude every money-path file — false comfort. |
| 11 | **Repo hygiene: close stale PRs** — #43 (superseded by #44/#45 unless rebased), railway zombies #14-#16; review dependabot #38/#39 + CI bumps | repo | 3 | 1 | 0 | **yes — close calls** | Open-PR list should equal real work in flight. Five minutes. |
| 12 | **STATENOUR journal insights preview** (local-only panel) | statenour | 5 | 2 | 4 | review | Audit-first, own session, statenour-verify gates. No sends, no diagnosis language. |
| 13 | **Studio enablement waves** (reel/carousel generation → publish → insights, each gated) | content | 6 | 5 (gated) | 5+ | **yes — per wave** | Both studios are deliberately draft-only. Each kill-switch flip is its own approval + PR; nothing flips silently. |

## Done since last update (2026-06-10 late night)
Old rank 1 (merge stack) — **all 11 PRs merged**. Old rank 3 (size-duplication fix) — **fixed**. Old rank 4 (verify GBP/IG
enablement) — collapsed into rank 1's armed-state card read. Old rank 11
(GBP draft queues) — **built** (#50 + #53). Old rank 13 (safe-fix sweep) —
**merged** (#49). Review-replies operator loop — **#57 merged** (`722934c7`:
markPosted confirmation + rot signal); **#58 open** (claim-safety QA gate +
draft editing + worst-first ordering, stacked on #57 — also carries the
Antigravity `/tires` size-dup rider `09471b79`).

## Next 3 code PRs
1. Env-validate + coverage hardening (rank 10).
2. Refund/writeback execution PR — **only after rank 4 approval**.

## Next 3 owner tasks
Ranks 0 (rotate credentials), 1 (phone smoke), 2 (Growth tab work).

## Do-not-touch-until-approved
Refund execution · any customer send path · any live GBP/IG posting
(armed-state card must stay DISARMED until a deliberate enablement wave) ·
supplier ordering · migrations (0070 part-number proposal included).
