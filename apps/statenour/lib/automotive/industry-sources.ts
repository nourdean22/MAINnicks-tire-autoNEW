/**
 * AUTOMOTIVE INDUSTRY SOURCES — what to monitor.
 *
 * v6 · BATCH 5 · Apr 28. Per Nour's spec: NOT just Moe Rabah, the
 * ENTIRE automotive industry around Nick's Tire & Auto.
 *
 * Sources span:
 *   1. Recalls + safety (NHTSA, IIHS) — "is the customer in your bay
 *      driving a recalled vehicle?" content angle
 *   2. EV adoption (DOE, Inside EVs) — every EV is a future battery,
 *      tire, and brake customer
 *   3. AAA reports (battery failure rates, breakdown causes) —
 *      seasonal content gold
 *   4. Tire industry (Tire Business, Modern Tire Dealer) — pricing
 *      shifts, new models
 *   5. Independent shop trends (Ratchet+Wrench, ShopOwner) — pricing,
 *      labor rates, customer behavior
 *   6. Cleveland-specific (local news + 216-area auto news)
 *   7. Consumer-facing (Edmunds, Car and Driver) — what Nour's
 *      customers are reading
 *
 * Each source is RSS-first when possible because RSS is cheap and
 * reliable. Fallback to scraping ?json or sitemap.xml endpoints.
 *
 * Output: stored in BrainMemory category="industry_intel" so chat
 * recall can surface relevant items when generating content.
 */

export interface IndustrySource {
  id: string;
  name: string;
  category: "recall" | "ev" | "tire" | "shop" | "consumer" | "local" | "weather" | "ai_industry";
  url: string;
  type: "rss" | "json" | "html";
  /** Importance weight for ranking — higher = surfaces more often in chat */
  weight: number;
  /** Optional Cleveland/automotive keyword filter; only items matching land in the brain */
  filterKeywords?: string[];
  enabled: boolean;
}

// 2026-05-02 — TOP-TIER REPLACEMENT PASS. 35-candidate probe completed
// (scripts/probe-rss-candidates.ts). The dead 11 (404/403) were
// replaced with verified-alive higher-quality sources. Stayed-active
// originals: aaa-newsroom, electrek, car-driver, cleveland-com.
// Net active sources: 4 → ~10.
//
// REPLACEMENTS THAT LANDED (alive + relevant + recent):
//   tire-review           ✅ 10 items, e.g. "Titan Expands Black Rock Aluminum Wheel Line"
//   cleantechnica         ✅ 45 items, EV+climate (replaces inside-evs)
//   insideevs (alt URL)   ✅ 20 items @ /rss/articles/all/ (was /rss/news/)
//   wkyc-3                ✅ 40 items local Cleveland (replaces cleveland-19)
//   fox8-cleveland        ✅ 20 items local Cleveland
//   engine-builder        ✅ 10 items shop trends (replaces ratchet-wrench)
//   openai-blog           ✅ 929 items AI industry (replaces anthropic, retains AI angle)
//   huggingface-blog      ✅ 774 items AI/ML industry
//
// STILL DEAD WITH NO BETTER OPTION (kept disabled, marked terminal):
//   nhtsa-recalls         🪦 RSS retired; full move would need JSON API + parser
//   iihs-news             🪦 no RSS at all
//   tire-business         🪦 paywall + no public RSS
//   modern-tire-dealer    🪦 same
//   ratchet-wrench        🪦 paywall
//   shop-owner            🪦 paywall
//   edmunds-articles      🪦 CDN-cookied 403
//   doe-ev                🪦 RSS retired by DOE
//   cleveland-19          🪦 station retired RSS
//   anthropic-news        🪦 no RSS published
export const INDUSTRY_SOURCES: IndustrySource[] = [
  // ── RECALLS + SAFETY ──
  {
    id: "nhtsa-recalls",
    name: "NHTSA Recalls",
    category: "recall",
    url: "https://www.nhtsa.gov/rss/recalls",
    type: "rss",
    weight: 9,
    enabled: false, // 404 verified 2026-05-01
  },
  {
    id: "iihs-news",
    name: "IIHS Safety Reports",
    category: "recall",
    url: "https://www.iihs.org/news/feed",
    type: "rss",
    weight: 7,
    enabled: false, // 404 verified 2026-05-01
  },

  // ── EV ADOPTION ──
  {
    id: "inside-evs",
    name: "Inside EVs",
    category: "ev",
    url: "https://insideevs.com/rss/articles/all/", // 2026-05-02 alt URL
    type: "rss",
    weight: 8,
    enabled: true, // ✅ alive @ alt URL · 20 items
  },
  {
    id: "cleantechnica",
    name: "CleanTechnica",
    category: "ev",
    url: "https://cleantechnica.com/feed/",
    type: "rss",
    weight: 7,
    enabled: true, // ✅ alive · 45 items · climate+EV+grid
  },
  {
    id: "doe-ev",
    name: "DOE Vehicle Tech Office",
    category: "ev",
    url: "https://www.energy.gov/eere/vehicles/articles/feed",
    type: "rss",
    weight: 6,
    enabled: false, // 404 verified 2026-05-01
  },
  {
    id: "electrek",
    name: "Electrek",
    category: "ev",
    url: "https://electrek.co/feed/",
    type: "rss",
    weight: 7,
    enabled: true, // ✅ alive
  },

  // ── AAA / BREAKDOWN DATA ──
  {
    id: "aaa-newsroom",
    name: "AAA Newsroom",
    category: "consumer",
    url: "https://newsroom.aaa.com/feed/",
    type: "rss",
    weight: 8,
    enabled: true, // ✅ alive
    filterKeywords: ["battery", "tire", "breakdown", "winter", "summer", "seasonal", "weather"],
  },

  // ── TIRE INDUSTRY ──
  {
    id: "tire-business",
    name: "Tire Business",
    category: "tire",
    url: "https://www.tirebusiness.com/rss/news.xml",
    type: "rss",
    weight: 9,
    enabled: false, // 🪦 paywall + no public RSS (2026-05-02 reverify)
  },
  {
    id: "modern-tire-dealer",
    name: "Modern Tire Dealer",
    category: "tire",
    url: "https://www.moderntiredealer.com/rss",
    type: "rss",
    weight: 8,
    enabled: false, // 🪦 paywall (2026-05-02 reverify)
  },
  {
    id: "tire-review",
    name: "Tire Review",
    category: "tire",
    url: "https://www.tirereview.com/feed/",
    type: "rss",
    weight: 9,
    enabled: true, // ✅ NEW 2026-05-02 · Babcox Media · 10 items · tire industry intel
  },

  // ── SHOP OWNER TRENDS ──
  {
    id: "ratchet-wrench",
    name: "Ratchet+Wrench",
    category: "shop",
    url: "https://www.ratchetandwrench.com/rss",
    type: "rss",
    weight: 7,
    enabled: false, // 🪦 paywall (2026-05-02 reverify · 4 alt paths all 404)
  },
  {
    id: "shop-owner",
    name: "ShopOwner",
    category: "shop",
    url: "https://www.shopownermag.com/feed",
    type: "rss",
    weight: 6,
    enabled: false, // 🪦 paywall + 403 even with UA (2026-05-02 reverify)
  },
  {
    id: "engine-builder",
    name: "Engine Builder",
    category: "shop",
    url: "https://www.enginebuildermag.com/feed/",
    type: "rss",
    weight: 7,
    enabled: true, // ✅ NEW 2026-05-02 · Babcox · 10 items · engine + driveline trends
  },

  // ── CONSUMER-FACING (what customers read) ──
  {
    id: "edmunds-articles",
    name: "Edmunds Articles",
    category: "consumer",
    url: "https://www.edmunds.com/articles/rss/",
    type: "rss",
    weight: 6,
    enabled: false, // 403 verified 2026-05-01 — needs User-Agent header
  },
  {
    id: "car-driver",
    name: "Car and Driver News",
    category: "consumer",
    url: "https://www.caranddriver.com/rss/all.xml",
    type: "rss",
    weight: 5,
    enabled: true, // ✅ alive
  },

  // ── CLEVELAND / 216 LOCAL ──
  {
    id: "cleveland-19",
    name: "Cleveland 19 News",
    category: "local",
    url: "https://www.cleveland19.com/feed/?categories=2",
    type: "rss",
    weight: 7,
    enabled: false, // 🪦 station retired RSS (2026-05-02 reverify)
    filterKeywords: ["car", "auto", "tire", "weather", "snow", "ice", "rain", "winter"],
  },
  {
    id: "cleveland-com",
    name: "Cleveland.com",
    category: "local",
    url: "https://www.cleveland.com/arc/outboundfeeds/rss/?outputType=xml",
    type: "rss",
    weight: 6,
    enabled: true, // ✅ alive · 50 items
    filterKeywords: ["car", "auto", "tire", "weather"],
  },
  {
    id: "wkyc-3",
    name: "WKYC Cleveland (NBC 3)",
    category: "local",
    url: "https://www.wkyc.com/feeds/syndication/rss/news/local",
    type: "rss",
    weight: 7,
    enabled: true, // ✅ NEW 2026-05-02 · 40 items · NBC affiliate, strong local coverage
    filterKeywords: ["car", "auto", "tire", "weather", "snow", "ice", "rain", "winter", "traffic"],
  },
  {
    id: "fox8-cleveland",
    name: "Fox 8 Cleveland",
    category: "local",
    url: "https://fox8.com/feed/",
    type: "rss",
    weight: 6,
    enabled: true, // ✅ NEW 2026-05-02 · 20 items · Fox affiliate, complementary coverage
    filterKeywords: ["car", "auto", "tire", "weather", "snow", "ice", "rain", "winter", "traffic"],
  },

  // ── WEATHER (Cleveland-specific, drives seasonal content) ──
  {
    id: "nws-cleveland",
    name: "NWS Cleveland Forecast",
    category: "weather",
    url: "https://forecast.weather.gov/MapClick.php?lat=41.4993&lon=-81.6944&FcstType=dwml",
    type: "html",
    weight: 5,
    enabled: false, // wired separately via existing weather integration
  },

  // ── AI / TOOLING (since Nour's OS is AI-built) ──
  {
    id: "anthropic-news",
    name: "Anthropic News",
    category: "ai_industry",
    url: "https://www.anthropic.com/news/feed",
    type: "rss",
    weight: 5,
    enabled: false, // 🪦 no RSS published; would need HTML scrape (2026-05-02)
  },
  {
    id: "openai-blog",
    name: "OpenAI Blog",
    category: "ai_industry",
    url: "https://openai.com/blog/rss.xml",
    type: "rss",
    weight: 6,
    enabled: true, // ✅ NEW 2026-05-02 · 929 items · most-active AI lab feed
  },
  {
    id: "huggingface-blog",
    name: "Hugging Face Blog",
    category: "ai_industry",
    url: "https://huggingface.co/blog/feed.xml",
    type: "rss",
    weight: 6,
    enabled: true, // ✅ NEW 2026-05-02 · 774 items · ML/AI research + tooling
  },
];

/**
 * Filter to enabled sources, sorted by weight desc. Used by the
 * industry-pull cron to decide pull order under a time budget.
 */
export function getActiveSources(): IndustrySource[] {
  return INDUSTRY_SOURCES.filter((s) => s.enabled).sort((a, b) => b.weight - a.weight);
}
