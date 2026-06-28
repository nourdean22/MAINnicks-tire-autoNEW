# Next Best Actions — Ranked

Companion to [PROJECT-COMPLETION-LEDGER.md](./PROJECT-COMPLETION-LEDGER.md).
The ledger says what's true; this says what to do, in order. Scores 1-10
(higher = more). Updated 2026-06-23 after the #262–#300 sprint
(40+ PRs merged, 90-branch prune, 4 integration slices, social pipeline,
Obsidian bridge, Command Center, Remotion reel engine).

| Rank | Action | Domain | Impact | Danger | Effort | Owner needed | Why |
|---:|---|---|---:|---:|---:|---|---|
| 1 | **Post-deploy phone smoke** — hit bdnick.info + nickstire.org on your phone; verify Command Center renders, brain graph loads, chat works, status widgets don't crash (apiHandler fix #293 needs live confirmation) | verification | 8 | 1 | 0 (10 min) | **yes — your phone** | 40+ PRs deployed since last live check. 10 minutes of eyes converts "gates green" into "live verified." |
| 2 | **Set FIRECRAWL_API_KEY on Railway** — enables the `scrapeWebPage` tool for Nick's web-context reads | infra | 6 | 1 | 0 (2 min) | **yes — Railway env** | Tool degrades gracefully without it, but setting it unlocks real scraping. |
| 3 | **Work the Growth tab** — post the 17 GBP Q&A seeds (~15 min), then this week's 6-photo queue | local SEO | 8 | 1 | 2 (owner) | **yes — GBP login** | Highest-ROI manual work. Q&A + weekly photos are the strongest free local-rank signals. |
| 4 | **D&K: get new portal API docs/credentials** from the rep | supplier | 9 | 2 | 1 (owner) then 6 (repair PR) | **yes — external** | Unblocks live availability + order-time stock rechecks. Highest revenue-protection item. |
| 5 | **Approve refund/writeback design** → dedicated PR | money | 8 | 7 (gated) | 4 | **yes — approval** | Design doc shipped: `apps/nickstire/docs/refund-writeback-design.md`. Closes the last manual money loop. |
| 6 | **Customer confirmation sends** — approve provider + copy | customer UX | 7 | 6 (gated) | 3 | **yes — approval** | Customers hear nothing automatically after ordering. Cheap win once approved. |
| 7 | **Social pipeline enablement wave** — review the Remotion reel engine (#300), GBP publisher (#299), social assets pipeline (#298), and social studio memory (#289); flip enablement flags one at a time | content | 7 | 5 (gated) | 3+ | **yes — per wave** | Full pipeline now exists: render → publish → GBP queue → reel engine. Each kill-switch flip is its own approval. |
| 8 | **Entity cleanup** — work Admin → Growth → Entity/Brand (GBP → Yelp → FB first) | local SEO | 6 | 1 | 2 (owner) | **yes — logins** | Checklist in admin with canonical NAP + copy buttons. Nothing automatable; compounds quietly. |
| 9 | **Set missing Railway env keys** — `STATENOUR_SYNC_KEY`, `CRON_SECRET`, `GOOGLE_SERVICE_ACCOUNT_KEY` | infra | 5 | 1 | 1 | **yes — Railway** | Clears arsenal DEGRADED + enables the 5 wired crons + mega-cron. |
| 10 | **Verify Obsidian integration + Research Lab** — #284-#288 added 5 new features; confirm they load and function in prod | verification | 5 | 2 | 1 (10 min) | **yes — browser** | Obsidian cockpit + headless engine + Research Lab are all new surfaces. Quick browse confirms no regressions. |
| 11 | **Audit secondary low-CTR pages** | local SEO | 6 | 1 | 3 | no | Expand SEO optimizations beyond the initial 4 pages from PR #152. |

## Done since last update (2026-06-15)

**Massive sprint: 40+ PRs merged (#262–#300)**

- **Security hardening**: CSP per-request nonce (#262, #268-#269), security scan script (#274), nickstire security remediation (#263)
- **Schema/code purge**: 13 dead Prisma models + 1 enum dropped (#267), 22 legacy REST routes deleted, dead exports pruned
- **AI infrastructure**: De-Venice cleanup (#265), AI Provider Registry (#266), deep-reasoning tool access (#272), Firecrawl web-context tool (#273), Gemini model correction (#280), AI config optimization (#281)
- **New features**: Nour Command Center + brain graph (#282-#283), Statenour-Obsidian bridge/cockpit/engine (#284-#287), Research Lab (#288), power dynamics integration (#276)
- **Social/content pipeline**: Social studio memory layer (#289), reel pipeline curation (#279), static render pipeline (#298), GBP publisher + queue dashboard (#299), Remotion reel engine (#300)
- **Infrastructure**: Codebase memory MCP (#273), Cloudflare tunnel setup (#295-#296), Tailwind v4 migration (#292), ESLint flat-config fix (#294), governance hardening (#297), vitest coverage-v8
- **Fixes**: apiHandler envelope crash fix (#293), rate-limiter IPv6 normalization (#277-#278), system audit seams (#290)
- **Repo hygiene**: 90+ stale branches pruned → 8 remaining (main + ad-studio + 1 open PR + 5 dependabot). Branch sprawl resolved.
- Old ranks 8 (env-validate/governance) → **done** (#294, #297). Old rank 9 (repo hygiene) → **done** (90-branch prune).

## Next 3 code PRs
1. `/tires` search size-duplication fix (regression — input self-concatenates).
2. Refund/writeback execution PR — **only after rank 5 approval**.
3. Customer confirmation SMS module — **only after rank 6 approval**.

## Next 3 owner tasks
Ranks 1 (phone smoke), 2 (set FIRECRAWL_API_KEY), 3 (Growth tab work).

## Do-not-touch-until-approved
Refund execution · any customer send path · any live GBP/IG posting
(armed-state card must stay DISARMED until a deliberate enablement wave) ·
supplier ordering · migrations (0070 part-number proposal included).
