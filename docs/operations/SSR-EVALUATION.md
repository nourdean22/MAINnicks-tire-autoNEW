# SSR Migration Evaluation

**Question:** Should nickstire.org migrate from Vite SPA + build-time
prerender to a runtime SSR framework (Next.js, Remix, TanStack Start,
or vike)?

**TL;DR recommendation:** **Stay on Vite + runtime prerender middleware
for now**, but harden the prerender pipeline. A full SSR migration is a
2-3 week engineering cost with real risk, and the current setup is close
to good enough. Revisit only if mobile Core Web Vitals plateau or Google
starts penalizing the bot-UA branching.

---

## 1. Current setup

```
├── Vite + React 19 SPA
├── server/_core/index.ts — Express
├── server/prerender-middleware.ts — serves pre-rendered HTML when
│   the User-Agent looks like Googlebot / FB crawler / etc.
├── scripts/prerender.mjs — Puppeteer hits every route at build time,
│   captures the hydrated HTML into dist/prerendered/**/index.html
└── Rollup manualChunks — main bundle is 43 KB gzip after v1.1 wave.
```

**Strengths today:**
- Fast initial paint for humans (SPA shell + lazy routes)
- Bots get fully-rendered HTML with meta tags + JSON-LD schema
- Zero runtime SSR cost — prerender runs once at build
- Zero per-request overhead
- Already coexists with an Express API server on Railway

**Weaknesses today:**
- **Route registry drift risk**: if a route is added to `App.tsx` but not
  to the prerender script, it ships with a blank `<head>` — a silent
  SEO regression. Mitigation: T11.1 route-registry validator (pending).
- **Cloaking perception risk**: serving different HTML to bots vs humans
  is technically legal per Google's own guidance as long as content is
  equivalent, but edge cases (A/B tests, dynamic pricing) can trip it.
  Low practical risk for a tire shop with static service content.
- **Puppeteer is brittle**: headless Chromium at build time is a slow,
  flaky step. If Chromium fails to launch on CI, the build dies.
- **No incremental regen**: if specials or reviews change, you have to
  redeploy to refresh the prerendered HTML.

---

## 2. Framework options evaluated

### Option A — Full Next.js App Router migration

**Pros:**
- Best-in-class ISR (Incremental Static Regen) — auto-refresh static
  pages without redeploy
- React Server Components cut bundle size further
- Vercel-optimized, but Railway deploys are fine too
- Active ecosystem, TypeScript-first
- Built-in image optimization, font optimization, metadata API

**Cons:**
- **Huge rewrite**: our Express + tRPC setup would need to move under
  Next.js API routes OR coexist in a custom server. Either way,
  significant refactor.
- **Learning curve**: App Router + Server Components + "use client"
  semantics are non-trivial.
- **New deploy target risk**: we just corrected nickstire.org's deploy
  target (Railway, not Vercel) — adding Next.js on top of Railway
  works but is less common than Next.js on Vercel.
- Prod builds are slower than Vite.
- Migrating 88 service pages + dynamic route generation is weeks, not days.

**Estimate:** 2–3 engineering weeks of focused work. Meaningful
regression risk for 0 dollars of incremental revenue in month 1.

### Option B — Remix / React Router v7

**Pros:**
- Keeps closer to stock React patterns (no RSC complexity)
- Loaders + Actions are elegant for our tRPC-less alternative
- Single runtime — no split between SSR and client
- Now co-evolves with React Router

**Cons:**
- Less mature ISR story than Next.js (workarounds exist)
- Smaller ecosystem
- Same rewrite cost as Next.js
- We'd lose tRPC or have to wrap it heavily

**Estimate:** 2–3 weeks. Similar risk to Next.js.

### Option C — vike (formerly vite-plugin-ssr)

**Pros:**
- **Minimal migration** — uses the same Vite config we already have
- Can run in SSR mode, SSG mode, or SPA fallback mode per route
- Preserves our Express + tRPC architecture
- Route-by-route incremental adoption — start with Home + top service
  pages, leave the rest as SPA

**Cons:**
- Smaller ecosystem, slower documentation
- Renames some lifecycle hooks (onBeforeRender, onHydrationEnd, etc)
- Lower "battle-tested" bar than Next/Remix

**Estimate:** 1 week for a proof-of-concept on Home + 10 SEO pages.
This is the lowest-risk migration path if we commit to SSR.

### Option D — TanStack Start (new)

**Pros:**
- Native tRPC integration (same team)
- React 19 + RSC support
- Tiny runtime

**Cons:**
- Still in beta as of 2026-Q2
- Smallest ecosystem of the four
- Risk of API churn mid-migration

**Estimate:** High risk. Not ready for a production shop site.

---

## 3. Decision matrix

| Dimension | Current | Next.js | Remix | vike | TanStack Start |
|---|---|---|---|---|---|
| Migration cost | — | High (2–3w) | High (2–3w) | Low (1w) | Medium (1–2w) |
| Runtime cost | Zero | Low | Low | Low | Low |
| SEO quality | B+ | A | A | A- | A- (if works) |
| Cloaking risk | Low | None | None | None | None |
| ISR / regen | None | Best | OK | Manual | Manual |
| Ecosystem | — | A | B+ | B | C |
| tRPC compat | Native | Needs work | Needs work | Native | Native |
| Risk to current live site | — | High | High | Medium | High |

---

## 4. Recommendation

**Do not migrate now.** Instead, in priority order:

1. **Ship T11.1 route-registry validator** (pending task). Add a CI
   step that diffs `App.tsx` routes against the prerender registry and
   fails if they drift. Kills the silent-SEO-regression risk cheaply.
2. **Add Puppeteer retry + fallback** in `scripts/prerender.mjs`. If
   a single route fails to render, we keep the last-known-good HTML
   and flag it for manual review rather than failing the build.
3. **Consider vike as the long-term migration target** if we hit
   either of these triggers:
   - Google Search Console flags cloaking or crawl issues for > 30d
   - Mobile CWV for homepage drops below the Good threshold and we
     can't fix it with more code-split
   - We need ISR for real-time specials/reviews surfaces
4. **Benchmark discipline**: track homepage LCP + CLS monthly via
   CrUX data. Migration trigger is data-driven, not vibes.

If you commit to a migration, vike is the right bet — lowest refactor
cost, preserves tRPC + Express, can ship incrementally route-by-route.
Budget 1 week for the first 10 pages and 2 more weeks to port the
remaining 78 SEO pages.

---

## 5. What we WILL ship regardless

Route-registry validator (T11.1) — blocks SEO regression drift at CI time.

Internal linking engine (T11.4) — boosts link equity without touching
rendering architecture.

Core Web Vitals admin report (T11.5) — so the migration trigger is
data-driven. Pulls CrUX field data weekly.

These three cover 80% of what an SSR migration would buy, at 10% of the
cost.
