// Server-side probe of candidate RSS feeds to find SUPERIOR replacements
// for the 11 dead sources we disabled in v10.0.82. No CORS issues
// (Node fetch). Tests each URL with proper UA + 8s timeout, logs
// status, content-type, item count, and the most-recent item title
// so we can verify the feed is actually fresh + relevant.
import { setTimeout as wait } from "node:timers/promises";

interface Candidate {
  id: string;
  category: string;
  url: string;
  notes?: string;
}

const CANDIDATES: Candidate[] = [
  // ── RECALLS / SAFETY ────────────────────────────────────────
  // NHTSA's RSS is dead but they have a JSON API
  { id: "nhtsa-api", category: "recall", url: "https://api.nhtsa.gov/recalls/recallsByVehicle?make=Toyota&model=Camry&modelYear=2024", notes: "JSON API not RSS — needs different parser" },
  { id: "iihs-news-alt", category: "recall", url: "https://www.iihs.org/news/rss/all" },
  { id: "consumer-reports-cars", category: "recall", url: "https://www.consumerreports.org/cars-driving/index.htm" },

  // ── EV ADOPTION ─────────────────────────────────────────────
  { id: "cleantechnica", category: "ev", url: "https://cleantechnica.com/feed/" },
  { id: "electrek-confirm", category: "ev", url: "https://electrek.co/feed/" },
  { id: "insideevs-alt", category: "ev", url: "https://insideevs.com/rss/articles/all/" },
  { id: "greencarreports", category: "ev", url: "https://www.greencarreports.com/rss/news.xml" },
  { id: "doe-eere", category: "ev", url: "https://www.energy.gov/eere/articles/feed" },

  // ── TIRE INDUSTRY ───────────────────────────────────────────
  { id: "tire-review", category: "tire", url: "https://www.tirereview.com/feed/" },
  { id: "tire-business-alt1", category: "tire", url: "https://www.tirebusiness.com/feed" },
  { id: "tire-business-alt2", category: "tire", url: "https://www.tirebusiness.com/rss/recent.xml" },
  { id: "modern-tire-dealer-alt", category: "tire", url: "https://www.moderntiredealer.com/rss/all-news" },

  // ── SHOP OWNER ──────────────────────────────────────────────
  { id: "ratchet-wrench-alt1", category: "shop", url: "https://www.ratchetandwrench.com/rss/all-articles" },
  { id: "ratchet-wrench-alt2", category: "shop", url: "https://www.ratchetandwrench.com/feeds/news.xml" },
  { id: "shopownermag-alt", category: "shop", url: "https://www.shopownermag.com/feeds/news.xml" },
  { id: "auto-care-pro", category: "shop", url: "https://www.autocare.org/feed" },
  { id: "motor-age", category: "shop", url: "https://www.motorage.com/rss" },
  { id: "tomorrows-tech", category: "shop", url: "https://tomorrowstechnician.com/feed/" },
  { id: "engine-builder", category: "shop", url: "https://www.enginebuildermag.com/feed/" },

  // ── CONSUMER (what customers read) ──────────────────────────
  { id: "edmunds-news", category: "consumer", url: "https://www.edmunds.com/feeds/news.xml" },
  { id: "kelley-blue-book", category: "consumer", url: "https://www.kbb.com/feed/" },
  { id: "motor-trend", category: "consumer", url: "https://www.motortrend.com/feed/" },
  { id: "autoblog", category: "consumer", url: "https://www.autoblog.com/rss.xml" },
  { id: "reuters-business-cars", category: "consumer", url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best" },

  // ── CLEVELAND LOCAL ─────────────────────────────────────────
  { id: "cleveland-com-confirm", category: "local", url: "https://www.cleveland.com/arc/outboundfeeds/rss/?outputType=xml" },
  { id: "wkyc-3", category: "local", url: "https://www.wkyc.com/feeds/syndication/rss/news/local" },
  { id: "wkyc-3-alt", category: "local", url: "https://www.wkyc.com/rss/news/local" },
  { id: "fox8-cleveland", category: "local", url: "https://fox8.com/feed/" },
  { id: "news5-cleveland", category: "local", url: "https://www.news5cleveland.com/feed" },
  { id: "ideastream", category: "local", url: "https://www.ideastream.org/feeds/news.xml" },
  { id: "crains-cleveland", category: "local", url: "https://www.crainscleveland.com/rss.xml" },

  // ── AI / TOOLING ────────────────────────────────────────────
  { id: "anthropic-rss", category: "ai_industry", url: "https://www.anthropic.com/rss.xml" },
  { id: "anthropic-news-rss", category: "ai_industry", url: "https://www.anthropic.com/news/rss" },
  { id: "openai-blog", category: "ai_industry", url: "https://openai.com/blog/rss.xml" },
  { id: "huggingface-blog", category: "ai_industry", url: "https://huggingface.co/blog/feed.xml" },
];

interface Result {
  id: string;
  category: string;
  status: number | "ERR";
  ok: boolean;
  ms: number;
  contentType?: string;
  itemCount?: number;
  latestTitle?: string;
  err?: string;
}

const UA = "Mozilla/5.0 (compatible; NickStire-Brain/10.0; +https://bdnick.info/about)";

async function probe(c: Candidate): Promise<Result> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(c.url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!r.ok) {
      return { id: c.id, category: c.category, status: r.status, ok: false, ms };
    }
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    // Coarse RSS/Atom detection
    const items = (text.match(/<item[\s>]/g) || []).length;
    const entries = (text.match(/<entry[\s>]/g) || []).length;
    const total = items + entries;
    // Pull first <title> after <item> or <entry> for sniff
    let latest: string | undefined;
    const titleMatch = text.match(/<(?:item|entry)[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/);
    if (titleMatch) {
      latest = titleMatch[1]
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .trim()
        .slice(0, 80);
    }
    return {
      id: c.id,
      category: c.category,
      status: r.status,
      ok: true,
      ms,
      contentType: ct.split(";")[0],
      itemCount: total,
      latestTitle: latest,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      id: c.id,
      category: c.category,
      status: "ERR",
      ok: false,
      ms: Date.now() - t0,
      err: String(e).slice(0, 60),
    };
  }
}

async function main() {
  const results: Result[] = [];
  // Concurrency 6 — reasonable politeness across 30+ external hosts
  const BATCH = 6;
  for (let i = 0; i < CANDIDATES.length; i += BATCH) {
    const batch = await Promise.all(CANDIDATES.slice(i, i + BATCH).map(probe));
    results.push(...batch);
    await wait(150);
  }
  // Group by category, sort within by ok-desc + itemCount-desc
  const byCat = results.reduce<Record<string, Result[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});
  const categories = Object.keys(byCat).sort();
  console.log("\n" + "═".repeat(120));
  for (const cat of categories) {
    const rows = byCat[cat].sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return (b.itemCount ?? 0) - (a.itemCount ?? 0);
    });
    console.log(`\n[${cat.toUpperCase()}]`);
    for (const r of rows) {
      const tag = r.ok ? "✅" : "❌";
      const status = r.ok
        ? `${r.status} · ${r.itemCount} items · ${r.ms}ms`
        : `${r.status} ${r.err ? "· " + r.err : ""}`;
      console.log(`  ${tag} ${r.id.padEnd(30)} ${status.padEnd(35)} ${r.latestTitle ?? ""}`);
    }
  }
  console.log("\n" + "═".repeat(120));
  const okCount = results.filter((r) => r.ok).length;
  console.log(`SUMMARY: ${okCount}/${results.length} alive`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
