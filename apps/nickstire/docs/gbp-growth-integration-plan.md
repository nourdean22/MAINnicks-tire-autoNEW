# GBP Growth Center — Integration Plan (post-#47)

> **STATUS 2026-06-10: EXECUTED** by the growth-social wiring PR
> (`feature/nickstire-growth-social-wiring`) — as a dedicated admin
> "Growth" section (`GrowthSection.tsx`, 7 tabs) rather than an Ops Hub
> tab, because 7 sub-surfaces would have crowded the hub's 3 tabs. The
> review-reply copy surface below shipped in the same PR. This document
> remains as the design rationale.

This PR ships the libraries, the read-only `localGrowth` server router,
tests, and docs WITHOUT touching the admin shell — because `Admin.tsx`,
`shared/nav.tsx`, `shared/types.ts`, and `OpsHubSection.tsx` are all
modified by open PRs #47 and #49. Wiring the UI now would create merge
conflicts. The plan below is the small follow-up once #47 merges.

## After PR #47 merges — one small admin-wiring patch

**Option A (preferred): add to the Ops Hub.** PR #47 added
`OpsHubSection.tsx` with a tabbed read-only hub. Add one "Local Growth"
tab that renders:
- Q&A seeds (from `gbpQaSeeds.ts`) with per-pair copy buttons
- the current week's photo queue (`weeklyPhotoQueue(weekIndex)`)
- the entity-consistency tracker (`ENTITY_PLATFORMS`)
- the competitor watch list + `reviewVolumeGaps(nicksCount)`
- the rank-keyword report shell (`emptyRankReport()`)
- live cards from `trpc.localGrowth.automationArmedState` and
  `trpc.localGrowth.reviewsHealth` (booleans only)

**Option B: a standalone `opsHub`-sibling section** if the hub gets
crowded — add `"gbpGrowth"` to `AdminSection`, a nav entry, an alias, and
a `GbpGrowthCenter.tsx`. Higher surface area; only if Option A is tight.

## Review Replies surface (adjacent gap)
The `reviewReplies` tRPC router ALREADY exists (`list`/`updateDraft`/
`approve`/`skip`/`stats`) — the gap the sweep found is purely that no
admin UI consumes it, and the review-monitor cron's alert text points at
a non-existent page. The wiring patch: a read/copy card calling
`trpc.reviewReplies.list({ status: "draft" })` with a copy button per
draft and NO live-post action (approve stays operator-gated). Pairs
naturally with the Local Growth tab.

## Why split this way
Libraries + server router + docs are conflict-free and independently
useful (the router is callable now; the libs are import-ready). The admin
wiring is ~40 lines that should land after the shell stops moving.
