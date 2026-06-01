# Admin Modernization — Continuation Handoff

> Branch `nickstire/admin-modernize` · worktree `C:\Users\nourd\NOURCITY\.worktrees\admin-modernize`. All work here is COMMITTED ON THE BRANCH — **not pushed, not applied to prod.**

## Where we are
- **Design DONE + documented:** `00-exploration-profile.md` (full ~80-table + admin-surface profile) + `02-plan.md` (validated systems→front plan). Target IA = **Hybrid "Stream + Command"** (Stream action-home + Cmd-K/entity-page nav + Modes-as-lenses + Nick later). Locked params: full rebuild · non-destructive migrations · clean neutral dashboard · IA redesign approved.
- **Phase 1.1 SHIPPED** (commit `706aec37`): promoted ghost `drip_enrollments` into `drizzle/schema.ts` (was raw-DDL-only in `dripProcessor.ts` → now type-safe + drizzle-kit-visible). Verified (typecheck green).

## ⚠ Worktree install gotcha (don't loop on it)
`pnpm -C <worktree> install` **exits 1** on statenour's postinstall (`'true' is not recognized` — Windows cmd quirk in the SIBLING app). BUT node_modules is fully populated and nickstire `pnpm run check` + the pre-commit hook WORK. Not a dep failure.

## ⚠ DECONFLICTION (verified via `git log HEAD..origin/main` on 2026-06-01)
A concurrent nickstire SMS session **already shipped to `origin/main`** most of what I'd planned for Phase 1's SMS slice. DO NOT redo these — it's duplicate work that conflicts on merge:
- `30759483` — **SMS honest send status** = my old "status-enum honesty / kill 84% failed-mislabel". DONE.
- `26341543` — **canonicalize SMS conversation keys to 10-digit** = my old "phone normalization (sms side)". DONE.
- `dd65a4a0` — **draft `0064` SMS phone-normalize+merge migration (pending sign-off)** = my old "SMS dedup + merge convs". OWNED by sibling.
- Earlier (already in my fork base): `3fd3f232` reporting double-count, `69e1f342` dupe-vectors, `1107d98d` queue-when-offline, `f11ac0bc` degraded-broadened.

**Conclusion: the SMS data layer is sibling-owned. Phase 1 data-integrity is converging without me.**

## Phase 1 remaining — REVISED (only the conflict-free, non-SMS parts are mine)
- ✅ **1.1 ghost drip_enrollments** — DONE (`706aec37`).
- ⚪ **1.2 non-SMS unique indexes**: `cronAlertsFired (alertKey,firedFor)`, `voiceFollowups (bookingId,touch)` — MINE, additive, conflict-free. Add Drizzle defs + guarded migration; **dedup-first at apply time** (UNIQUE fails on existing dups → migration must clean then constrain).
- ⏸ **1.3 canonical customer identity** (INT vs VARCHAR(36) vs BIGINT): build the additive canonical key **on top of the sibling's now-normalized 10-digit keys** — so REBASE onto origin/main first, let `0064` land, THEN design. Highest-risk; defer until their migration is signed off.
- ❌ DROPPED (sibling owns): status-enum honesty, sms phone-normalize, sms dedup/merge, opt-out merge.

## Pivot — the real, fully-mine, operator-visible work is Phase 2 → Phase 3
- **Phase 2** (API · conflict-free · sibling is in SMS-land, not `intelligence.ts`): VERIFY-FIRST audit the "~40 dead intelligence procedures" claim against CURRENT main (a sibling may have wired some) before deleting anything → prune confirmed-dead → reshape survivors into Stream card-emitters; expand `nextBestActions`; bundle Today's 11 queries into one batched resolver.
- **Phase 3** (UI/IA · flag-gated, parallel to live admin): build Stream + Command/Entities (promote `CommandSearch` + `CustomerDrawer`); retire sections/duplicates/god-files; neutral-dashboard styling + 44px mobile targets (operator is on a PHONE); then Nick augmentation.
- **Prod apply** (gated, last): additive migrations via inline-DDL in `handleRunMigrations` + authed admin-tRPC fetch AFTER deploy; verify row-count parity. Push via shared-main protocol (fetch → rebase → explicit-path stage → pre-push turbo build · never `--no-verify`/force).

## Working notes
- Operator runs the admin FROM A PHONE — mobile-first is non-negotiable.
- Goal active this session: "get it all done perfectly" (Stop hook).
- `nickstire-verify` skill = the local gate; brand-voice lint scans client/server source only (not `drizzle/` or `docs/`).
