# Next Best Actions — Ranked

Companion to [PROJECT-COMPLETION-LEDGER.md](./PROJECT-COMPLETION-LEDGER.md).
The ledger says what's true; this says what to do, in order. Scores 1–10
(higher = more). Updated 2026-06-10 (evening), incorporating the forensic
gap sweep.

| Rank | Action | Domain | Impact | Danger | Effort | Owner needed | Why |
|---:|---|---|---:|---:|---:|---|---|
| 0 | **🔴 ROTATE leaked production credentials** | security | 10 | 8 | 2 (owner) | **YES — urgent** | The forensic sweep found `docs/MIGRATION_AUDIT.md` committed a live Stripe secret key, the TiDB prod `DATABASE_URL`, and plaintext vendor passwords (`AUTO_LABOR_PASSWORD`, `GATEWAY_TIRE_PASSWORD`). PR (chore branch) redacts the file in HEAD, but **git history still holds them** — assume compromised. Rotate the Stripe key, DB password, and both vendor passwords; check whether `.env` was ever committed (`git log --all -- .env`); scrub history if so. |
| 1 | **Merge the open PR stack: #48 → #46 → #47 → safe-fix** | repo | 9 | 1 | 1 | review only | Everything below assumes these are live. Docs-first (#48 ledger+this), then cockpit (#46), then hub (#47), then the gap-sweep safe-fix PR. All gates green, all reviewed-ready. |
| 2 | **Fix /tires search size-duplication** (input self-concatenates → silent catalog fallback) | revenue | 8 | 2 | 2 | no — but it's PR #43's file (Antigravity) | Every affected search quotes estimate prices instead of real wholesale — margin accuracy + trust on the money page. Belongs in #43 or immediately after it merges. |
| 3 | **Approve refund/writeback design** → dedicated PR | money | 8 | 7 (gated) | 4 | **yes — approval** | Design doc in #47. Closes the last manual money loop; cockpit banners become one-click. High danger class, which is exactly why it ships only post-approval with idempotency + audit trail. |
| 4 | **Verify GBP/IG automation prod enablement** (which env flags are set on Railway) | external posting | 7 | 3 | 1 | **yes — env read** | Code exists and could post if enabled; nobody has verified what's live. Until then every roadmap item builds on sand. Also fixes igAutopost's "$60 used" only after #5. |
| 5 | **Decide the used-tire price channel policy** ($25 web vs $60 phone/SMS/IG/voice) | pricing truth | 7 | 2 | 1 | **yes — decision** | The single biggest remaining honesty split. One decision, then a small sweep PR aligns every channel. |
| 6 | **D&K: get new portal API docs/credentials** from the rep | supplier | 9 | 2 | 1 (owner) then 6 (repair PR) | **yes — external** | Unblocks live availability, order-time stock rechecks, and part-number persistence. Highest revenue-protection item that's pure owner legwork to start. |
| 7 | **Customer confirmation sends** — approve provider + copy | customer UX | 7 | 6 (gated) | 3 | **yes — approval** | Templates + previews shipped in #47; customers currently hear nothing automatically. Cheap win once approved (reuse existing SMS gateway). |
| 8 | **Sheets first-row watch** | ops | 4 | 1 | 0 | no | Tab + headers done; just confirm the next online order lands a row. If not, server logs name the fix. |
| 9 | **Entity cleanup checklist** — work GBP → Yelp → FB first | local SEO | 6 | 1 | 2 (owner) | **yes — logins** | Checklist shipped in #47. NAP consistency compounds; nothing automatable. |
| 10 | **Env-validate hardening** (warn when STRIPE_SECRET_KEY set without STRIPE_WEBHOOK_SECRET) + coverage include for money-path files | devops | 5 | 1 | 2 | no | The admin banner covers runtime; this catches it pre-deploy too. Coverage thresholds currently exclude every money-path file — false comfort. |
| 11 | **GBP draft queues** (review responses, Q&A seeds) per roadmap | local SEO | 5 | 1 | 3 | review | Roadmap doc in #47; build draft-only queues into the Ops Hub after #4 verification. |
| 12 | **STATENOUR journal insights preview** (local-only panel) | statenour | 5 | 2 | 4 | review | Audit-first, own session, statenour-verify gates. No sends, no diagnosis language. |
| 13 | Stale-doc + small-fix sweep PR (from forensic sweep findings) | hygiene | 4 | 1 | 2 | no | Keeps docs from lying; includes /emissions meta-length and legacy-reference cleanups as found. |

## Next 3 code PRs
1. Safe-fix sweep PR (rank 13 — in progress this session).
2. Env-validate + coverage hardening (rank 10).
3. Refund/writeback execution PR — **only after rank 3 approval**.

## Next 3 owner tasks
Ranks 4 (env flag verification), 5 (price decision), 6 (D&K credentials).

## Do-not-touch-until-approved
Refund execution · any customer send path · any new live GBP/IG posting
path · supplier ordering · migrations (0070 part-number proposal included).
