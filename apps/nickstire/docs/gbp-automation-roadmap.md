# GBP / Local SEO Automation — Roadmap (draft-queue-only)

Rule for everything here: **no live GBP posting, replying, or editing
from new code.** Drafts are generated for the owner to review and paste.
Existing automation (`gbpAutoPost.ts`, `gbpContentGenerator.ts`,
`reviewMonitor.ts`, `igAutopost.ts`) predates this rule — its production
enablement was NOT verified on 2026-06-10 and must be checked before any
new work assumes it.

## Verify first (30 min, owner or agent with prod env read)

1. Which of GBP auto-post / IG auto-post / review monitor are actually
   enabled in Railway env? List the flags.
2. ⚠ Known issue: `igAutopost.ts:683` still quotes "$60 used" while the
   site says "from $25 installed" — the price-channel decision is open.

## Build order (each item = drafts/checklists only)

1. **Review response drafts** — generate reply drafts for unanswered
   reviews (reviewMonitor already fetches reviews); owner pastes into GBP.
   Never auto-reply; never fabricate review content.
2. **Q&A seeds** — 10–15 real question/answer pairs from the FAQ corpus
   (pricing, walk-ins, used-tire safety, financing, women-friendly).
   Owner posts both question and answer from the business account.
3. **Post verification checklist** — manual checklist: do published GBP
   posts match the generator output; UTM tags present; photos attached.
4. **Weekly photo shot list** — rotating list (bay work, before/after,
   team, storefront, seasonal); owner shoots + uploads.
5. **Competitor monitor (design)** — track 5 named local competitors'
   review counts/ratings monthly. Manual or API-read-only later.
6. **Rank tracker (design)** — 10 money keywords ("tire shop euclid",
   "used tires cleveland"…) tracked weekly; start manual spreadsheet, no
   scraping from the app.
7. **Review keyword miner** — offline analysis of existing review text
   for copy-worthy phrases; feeds site copy + review responses.
8. **"Women Trust This Shop" pillar** — content queue (site section, GBP
   posts, review prompts) building on the existing WomensSafety page;
   every claim sourced from real reviews.

Each shipped queue should land in the Ops Hub → Reports list with a
status row in the ops registry.
