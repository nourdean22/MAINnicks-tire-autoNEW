# Content Pipeline — End-to-End Architecture

> **⚠ PARTIALLY STALE — 2026-07-24 (IG quality waves 1–8, PRs #1037+).** The
> Instagram admin described below was rebuilt: nine tabs → a five-view
> URL-backed shell (Today/Create/Publish/Community/Insights), server-persisted
> drafts with autosave, a lifecycle×health Publish board, scheduled_posts now
> carries `inventoryId` (migration 0096), reject cancels deferred publishes,
> dispatched-but-unanswered publishes park as `ambiguous`, and
> `instagramAdmin.schedulePost/listScheduled/cancelScheduled` plus four other
> dead procs were deleted. Trust the code + `instagramStudio` router for the
> Instagram flow; the non-Instagram sections below remain accurate as of the
> date underneath.
>
> **Last updated:** 2026-07-01 · Post Clarity Gate audit
>
> This document maps every component in the content generation pipeline across both apps and all shared packages. It is the single reference for understanding how content flows from idea → generation → evaluation → publishing.

---

## Pipeline Overview

```
Operator (Nour)
  │
  ├─ Chat command ("generate an IG post")
  │   └─ statenour/lib/ai/tools/social.ts
  │       └─ triggerInstagramAutopost → queryNick("instagram_autopost_run")
  │
  ├─ Admin UI button ("Fire Now")
  │   └─ nickstire/server/routers/nickActions.ts
  │       └─ fireIgAutopostNow → runIgAutopostOneOff()
  │
  └─ Cron (scheduled)
      └─ nickstire/server/cron/ → runIgAutopostOneOff()
          │
          ▼
    ┌─────────────────────────────────────────────┐
    │  Content Generation Engine                  │
    │                                             │
    │  IG: igAutopost.ts (6 archetypes)           │
    │  GBP: gbpContentGenerator.ts (4 archetypes) │
    │  Reels: contentManufacturing.ts             │
    │                                             │
    │  Image: brand-context.ts → gemini-image.ts  │
    │  Video: MoneyPrinterTurbo                   │
    │  Assets: social-assets (Satori → PNG)       │
    └──────────────┬──────────────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────────────┐
    │  Evaluation Gate                            │
    │                                             │
    │  Caption: voice-grade + engagement scoring  │
    │  Image: eval (skippable)                    │
    │  Overall: captionWeighted * imageScore      │
    │                                             │
    │  Threshold → PASS / ABORT                   │
    └──────────────┬──────────────────────────────┘
                   │
           ┌───────┴───────┐
           │               │
      Dry Run          Live Post
      (Telegram         (Meta Graph API)
       preview)         ig_autopost_log
                        gbp_post_log
```

---

## Component Inventory

### Shared Packages (`packages/`)

| Package | Purpose | Key Exports | Dependencies |
|---------|---------|-------------|-------------|
| `social-assets` | JSX → PNG renderer for social media images | `renderToPng()`, `validateEvidence()` | satori, @resvg/resvg-js, Inter + Outfit fonts |
| `gbp-publisher` | Google Business Profile OAuth + post publishing | `createPost()`, `getLocation()`, `authenticate()` | googleapis |
| `reel-engine` | Remotion-based video compositions | `RootComposition`, `render()` | @remotion/renderer |

### nickstire Services (`apps/nickstire/server/services/`)

| Service | Purpose | Archetypes | Data Sources |
|---------|---------|-----------|-------------|
| `gbpContentGenerator.ts` | Voice-grade GBP post generation | proof, anti, math, seasonal | Live reviews, specials, weather, seasonal context |
| `gbpAutoPost.ts` | GBP scheduling + UTM-tagged publishing | (uses GBP archetypes) | gbp_post_log, Telegram |
| `igAutopost.ts` | Instagram/Facebook autopost pipeline | proof, anti, math, seasonal, question, process | ig_autopost_log, Meta Graph API |
| `contentManufacturing.ts` | Reel/video manufacturing | pov_you_are_the_part + custom | Reel briefs, Higgsfield Studio, `skill_trend_topics` |
| `metaSocial.ts` | Meta API token management + comment moderation | — | Facebook/Instagram Graph API |
| `skillRouter.ts` | Fallback-safe routing for creative skill packs | — | `skill_ad_creative`, `skill_reel_script`, `skill_trend_topics` |
| `reelBriefGen.ts` | Client/server generation logic for Reels | — | Reel pipeline, `skill_reel_script` |

### nickstire Routers (`apps/nickstire/server/routers/`)

| Router | Surface | Key Procedures |
|--------|---------|---------------|
| `instagramAdmin.ts` | Admin IG console | getConnectionStatus, getLiveFeed, getAnalytics, getCreationBrief, syncFeed, postReply |
| `content.ts` | Content management | generateGBPPost, gbpPostHistory, reel CRUD |
| `nickActions.ts` | Nour-OS bridge actions | fireIgAutopostNow |

### statenour AI Tools (`apps/statenour/lib/ai/`)

| File | Purpose | Key Functions |
|------|---------|--------------|
| `tools/social.ts` | Cross-ring autopost tools | triggerInstagramAutopost, getInstagramAutopostStatus, setInstagramAutopostConfig |
| `brand-context.ts` | 3-tier brand injection for image generation | isMarketingIntent(), classifyDetail(), brandedPrompt() |
| `gemini-image.ts` | Venice AI → Gemini fallback image generation | generateImageWithFallback(), generateImageOpenRouter() |
| `moneyprinter/` | MoneyPrinterTurbo video generation | Topic → script → B-roll → TTS → subtitles → render |

---

## Archetype Reference

### GBP Archetypes (4)

| Archetype | % Mix | Description | Data Source |
|-----------|-------|-------------|-------------|
| **proof** | 50% | Real customer + real result | DB reviews (rating ≥ 4, text ≥ 10 chars) |
| **anti** | 15% | Industry honesty / anti-promises | Cliché kill-list, VOICE.md |
| **math** | 15% | First-principles math-as-argument | Service pricing, real numbers |
| **seasonal** | 20% | Cleveland-specific seasonal timing | Weather API, calendar |

### IG Archetypes (6)

| Archetype | Description |
|-----------|-------------|
| **proof** | Customer testimonial / result |
| **anti** | Industry truth-telling |
| **math** | Data/price-based argument |
| **seasonal** | Time-sensitive Cleveland content |
| **question** | Audience engagement prompt |
| **process** | Behind-the-scenes / how-we-work |

### Reel Archetypes

| Archetype | Description |
|-----------|-------------|
| **pov_you_are_the_part** | POV perspective, immersive |
| Custom briefs | Operator-defined via ReelBrief interface |

---

## Brand Context Injection (Image Generation)

The `brand-context.ts` engine applies a 3-tier injection system:

| Tier | When | What's Injected |
|------|------|----------------|
| **Vague** | Short/undirected prompt | Full system: identity, hex colors (3000-3500K), composition, environment, humans, Cleveland, mood, avoid list |
| **Partial** | Medium-detail prompt | Identity + color + lighting + environment + humans + avoid |
| **Specific** | Highly detailed prompt | Identity + color + avoid list only (respects existing composition) |

Marketing intent detection uses whole-word boundary matching against tire/shop/mechanic/instagram/post keywords. Personal prompts skip branding entirely.

---

## Creative Skill Packs & Feature Flags

Three autonomous skill pack generators run across the content pipelines to augment prompts dynamically. Each operates in a fail-open state behind feature flags in the database (`featureFlags.ts`).

| Skill | Router Injection Point | Behavior |
|-------|------------------------|----------|
| `skill_ad_creative` | `metaAdsArchitect.ts` | Injects localized hook strategies and copy rules. |
| `skill_reel_script` | `reelBriefGen.ts` | Augments prompt output with structured visual instructions. |
| `skill_trend_topics`| `contentManufacturing.ts`| Generates localized GSC/Seasonal topics and seeds reels. |

**Idempotent Backfill:** 
Existing inventory and job payloads (`promptPackVersion: 1`) can be upgraded to the latest prompt specifications using the operator script:
`pnpm run backfill:skills --write`

---

## Evaluation Pipeline

Content quality is NOT measured by BLEU/ROUGE/FID (those are for model training, not API-consumer content).

**Actual evaluation metrics:**

| Metric | Source | Stored In |
|--------|--------|-----------|
| Caption voice-grade | LLM eval against VOICE.md | `evalScoresJson` |
| Caption weighted score | Weighted dimensions × 100 | `captionWeighted` |
| Overall score | caption × image composite | `overallScore` |
| Post status | Pipeline outcome | `status` (dryrun/posted/failed/aborted) |
| Engagement (post-publish) | Instagram Insights API | `instagramAdmin.getAnalytics()` |
| Archetype performance | Aggregated from logs | `instagramAdmin.getCreationBrief()` |

**Evidence validation (`social-assets`):**
- Blocks fake testimonials (John Doe, Test User, placeholder, mock, lorem)
- Requires `sourceIds[]` and `evidenceSummary` for every rendered asset
- Content hash (SHA-256) computed for integrity tracking

---

## Data Flow: ig_autopost_log

```sql
CREATE TABLE ig_autopost_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  archetype     VARCHAR(20) NOT NULL,      -- proof|anti|math|seasonal|question|process
  conceptKey    VARCHAR(64) NOT NULL,      -- anti-repetition guard
  slot          VARCHAR(16) DEFAULT 'manual', -- morning|midday|evening|manual
  slotDate      VARCHAR(10) NOT NULL,      -- YYYY-MM-DD ET date
  evalScoresJson TEXT,                     -- full eval payload as JSON
  captionWeighted INT,                     -- weighted score × 100
  overallScore  INT,                       -- overall × 100
  status        VARCHAR(16) NOT NULL,      -- dryrun|posted|failed|aborted
  caption       TEXT NOT NULL,             -- final caption (≤ 2200 chars)
  hashtags      TEXT,                      -- space-joined without #
  imagePrompt   TEXT,                      -- art-direction prompt
  imageUrl      VARCHAR(1000),             -- public JPEG URL
  igPostId      VARCHAR(64),              -- Instagram media ID
  fbPostId      VARCHAR(64),              -- Facebook post ID
  error         VARCHAR(500),             -- failure reason
  source        VARCHAR(16) DEFAULT 'cron', -- cron|admin
  promptVersion VARCHAR(32),              -- prompt version stamp
  createdAt     TIMESTAMP DEFAULT NOW()
);
```

---

## Key Constraints

- **GBP Posts API is deprecated** (Google v4, 2024) — posts are Telegram copy-paste blocks, not API-pushed
- **Instagram/Facebook posting** uses Meta Graph API via `metaSocial.ts` — requires valid long-lived token
- **Variety guard** tracks last 14 archetypes/topics to prevent repetition (hybrid: DB + in-memory cache)
- **Dry-run by default** — `IG_AUTOPOST_DRYRUN !== "false"` sends Telegram preview without posting
- **Claim safety** — `reviewReplyQa.ts` checks every reply before it touches Graph API
- **Evidence validation** — `social-assets` blocks fake testimonials at the render layer
