# Session ledger — nickstire

**Updated:** 2026-09-03 (growth/audit arc · Moe's continuity · self-review defect fixes · indexability gate · live Chrome verify)

**Objective:** Execute the 18-agent audit's findings + a forensic/growth audit grounded in the shop's REAL GSC data, fix every code-fixable defect, and ship a gate so the next drift can't hide.

## The findings that shaped the arc
- **Traffic is NOT the bottleneck.** Whole site = ~776 clicks / ~194k impr in ~5.5 mo (home = 61% of clicks). `/oil-change` (49.7k impr, pos 39) and `/brakes` (44.6k, pos 37) are **national wrong-intent "near me"** ("oil change near me" = pos 50); position is DEGRADING over time, not ramping. The prior session's "young-site + competition, needs authority + time" was **misdiagnosed**. The real levers are GBP/Local Pack, converting existing clicks, and reviews — largely operator, not code. GSC export lives at scratchpad `gsc-export/` (Filters/Pages/Queries/Chart csvs).
- **A case-sensitive grep missed a live falsehood.** The Moe's bridge page said "new ownership" (lowercase, fixed) AND "New ownership" (capitalized, MISSED) — the second was the hero intro's first line, contradicting the FAQ + the owner-confirmed truth. Caught only by loading the LIVE page in real Chrome. **Lesson: sweep copy-truth with `grep -i`, and verify user-facing changes in a real browser (the in-app browser blocks the fonts, so it's not a fair visual check).**
- **Owner-confirmed truth (2026-09-03):** SAME owner, shop since ~2018, simply renamed Moe's Tire & Auto → Nick's Tire & Auto. Not "new ownership." Never imply "run by Moe" (truth guard blocks it).
- **PR #2094's neighborhood enrich+index was defeated:** 10 of 12 `indexed:true` slugs are prerender:true but served STALE `noindex` snapshots to crawlers (index+content lived only in client React). `prerender:check`/`semantic-check` never compared snapshot robots vs source intent.

## Shipped (all merged to main, deploying via Railway)
1. **#2097 `9f95078fc`** — Moe's continuity (bridge "new ownership"→"same owner", About former-name line, "5-Star Reviews"→"Google Reviews") + 5 self-review defect fixes: FTC $25 pricing band on 6 indexed pages, reverted premature neighborhood indexing (12 → `indexed:false`, kept enriched content), Acima durable event on all 3 CTAs (was 1), NeighborhoodSchema canonical @id + dropped duplicate aggregateRating, ChatWidget live-region scoped to transcript, removed "before your next shift starts" promise.
2. **#2098 `cff6a8fa`** — indexability drift-catcher test (`client/src/__tests__/prerender-indexability-consistency.test.ts`): proves `indexed` flag + routes.ts + SITEMAP_ROUTES + snapshot robots agree for every NeighborhoodPage-served slug. Static, no deps, ships a canary. Scoped to group:"neighborhood" (city slugs like lakewood-auto-repair are owned by CityPage).
3. **#2099 `fc73b176`** — the remaining capitalized "New ownership" instances (hero intro + What-Changed list + 2 stale comments), Chrome-caught. Reworded a "trusted" line to pass lint:brand-voice.
- **Report artifact** (external deliverable): https://claude.ai/code/artifact/3cdeb4b7-58fd-45de-9198-018b7f1c807d

## Verification receipts
check 0 · truth guard 15/15 · relevant tests 98/98 + gate 5/5 · prerender check 0 missing + semantic OK · brand-voice no new violations · live smoke 11/11 money pages 200 · **/brakes renders clean** (refuted the external report's "chunk error" — stale Google cache).

## Open / next
- **Operator (the real growth levers, no code):** claim Bing Places; fix Apple Business Connect ("Moe's"). **Verify the "1,700+ / 4.9★" figures against live Google Maps before any copy uses them** — no agent session can read GBP, so they stay UNVERIFIED *here* no matter who owns the account. Full 48h/2wk/30d plan in the report artifact.
- **ACCOUNT OWNERSHIP — operator-confirmed 2026-09-07. Do NOT re-raise.** Nour owns BOTH
  `nourdean22@gmail.com` (his CEO email) and `moeseuclid@gmail.com` (the Euclid store's
  account, which holds GBP). There is no third-party access, no owner split, and no lockout
  risk. The prior version of the line above claimed GBP was "under moeseuclid@" as if that
  were an access barrier, and told the next session to add owners to fix a split. **Both were
  false and cost a session real advice-time.** `moeseuclid@` being the *store's* address is a
  naming artifact of the Moe's → Nick's rename, not a sign of outside control.
- **Review flywheel: operator declined 2026-09-07.** Previously listed here as a growth lever.
  Not wanted. Do not propose it again.
- **Follow-up code (flagged, not rushed):** Playwright live-production smoke suite + `dynamic_import_failure` telemetry (heavy dep + CI wiring — do deliberately); `NEIGHBORHOODS` duplicates several city slugs → shadowed dead NeighborhoodPage routes (the gate surfaced this).
- **Re-indexing the 12 neighborhoods properly** (only if data justifies — it currently doesn't): needs prerender regen on CI/Linux + a visible FAQ to match FAQPage schema + the SITEMAP_ROUTES neighborhood-group exclusion lifted. The new gate now makes that safe (fails if you re-flag without regenerating).

## Refuted (don't re-chase)
External audit's "/brakes broken" (stale cache; renders fine live) and "duplicate brake-cost blogs" (exist in neither routes.ts nor the real GSC export).
