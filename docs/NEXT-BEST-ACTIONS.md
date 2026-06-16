# Next Best Actions — Ranked

Companion to [PROJECT-COMPLETION-LEDGER.md](./PROJECT-COMPLETION-LEDGER.md).
The ledger says what's true; this says what to do, in order. Scores 1-10
(higher = more). Updated 2026-06-15 after PR merges and owner feedback.

| Rank | Action | Domain | Impact | Danger | Effort | Owner needed | Why |
|---:|---|---|---:|---:|---:|---|---|
| 1 | **Post-deploy phone smoke** — Admin → Tire Orders / Ops Hub / Growth / both studios; armed-state card should read DISARMED + dry-run ON; reviews-health card answers the old "Place ID reliability" unknown | verification | 7 | 1 | 0 (5 min) | **yes — your phone** | Eleven PRs deployed at once; 5 minutes of eyes converts "gates green" into "live verified" and closes two ledger UNKNOWNs for free. |
| 2 | **Work the Growth tab** — post the 17 GBP Q&A seeds (~15 min), then this week's 6-photo queue | local SEO | 8 | 1 | 2 (owner) | **yes — GBP login** | The highest-ROI manual work the new admin enables. Q&A + weekly photos are the strongest free local-rank signals; everything is copy-paste-ready with claim-safe copy. |
| 3 | **Approve refund/writeback design** → dedicated PR | money | 8 | 7 (gated) | 4 | **yes — approval** | Design doc shipped (#47): `apps/nickstire/docs/refund-writeback-design.md`. Closes the last manual money loop. Ships only post-approval with idempotency + audit trail. |
| 4 | **D&K: get new portal API docs/credentials** from the rep | supplier | 9 | 2 | 1 (owner) then 6 (repair PR) | **yes — external** | Unblocks live availability + order-time stock rechecks. Highest revenue-protection item that's pure owner legwork to start. |
| 5 | **Customer confirmation sends** — approve provider + copy | customer UX | 7 | 6 (gated) | 3 | **yes — approval** | Templates + previews live in Ops Hub; customers currently hear nothing automatically. Cheap win once approved (reuses the existing SMS gateway). |
| 6 | **Sheets first-row watch** | ops | 4 | 1 | 0 | no | Tab + 24 headers verified; just confirm the next online order lands a row. |
| 7 | **Entity cleanup** — work Admin → Growth → Entity/Brand top-to-bottom (GBP → Yelp → FB first) | local SEO | 6 | 1 | 2 (owner) | **yes — logins** | Checklist now lives in the admin with canonical NAP + copy buttons. Nothing automatable; compounds quietly. |
| 8 | **Env-validate hardening** (warn when STRIPE_SECRET_KEY set without STRIPE_WEBHOOK_SECRET) + coverage include for money-path files | devops | 5 | 1 | 2 | no | The admin banner covers runtime; this catches it pre-deploy too. Coverage thresholds still exclude every money-path file — false comfort. |
| 9 | **Repo hygiene: close stale PRs** — #43 (superseded by #44/#45 unless rebased), railway zombies #14-#16; review dependabot #38/#39 + CI bumps | repo | 3 | 1 | 0 | **yes — close calls** | Open-PR list should equal real work in flight. Five minutes. |
| 10 | **Audit and optimize secondary low-CTR pages** | local SEO | 6 | 1 | 3 | no | Initial 4 low-CTR pages rewritten in PR #152; expand optimizations to secondary pages. |
| 11 | **Studio enablement waves** (reel/carousel generation → publish → insights, each gated) | content | 6 | 5 (gated) | 5+ | **yes — per wave** | Both studios are deliberately draft-only. Each kill-switch flip is its own approval + PR; nothing flips silently. |

## Done since last update (2026-06-15)
- **PR #152 merged** (Honesty Enforcement canClaimDone verification, Task Inbox Triage Card UI & triage mutation, promoteNextAction journal seam, Google OAuth diagnostics & operational guide, and 4 low-CTR SEO page title/meta optimizations).
- Old rank 1 (merge stack) — **all 11 PRs merged**. Old rank 3 (size-duplication fix) — **fixed**. Old rank 4 (verify GBP/IG
enablement) — collapsed into rank 1's armed-state card read. Old rank 11
(GBP draft queues) — **built** (#50 + #53). Old rank 13 (safe-fix sweep) —
**merged** (#49). Review-replies operator loop — **#57 merged** (`722934c7`:
markPosted confirmation + rot signal); **#58 open** (claim-safety QA gate +
draft editing + worst-first ordering, stacked on #57 — also carries the
Antigravity `/tires` size-dup rider `09471b79`).

## Next 3 code PRs
1. Env-validate + coverage hardening (rank 8).
2. Refund/writeback execution PR — **only after rank 3 approval**.

## Next 3 owner tasks
Ranks 1 (phone smoke), 2 (Growth tab work), 3 (Approve refund/writeback design).

## Do-not-touch-until-approved
Refund execution · any customer send path · any live GBP/IG posting
(armed-state card must stay DISARMED until a deliberate enablement wave) ·
supplier ordering · migrations (0070 part-number proposal included).
