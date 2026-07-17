/**
 * Media-permanence census — READ-ONLY (pure SELECT/SHOW + outbound HEAD probes).
 *
 * Answers the question the creative-quality baseline starts from: where do the
 * media URLs we have ever recorded actually live, and how many still resolve?
 * Prod serves storagePut output from ephemeral Railway disk (/generated/*) when
 * S3_BUCKET is unset, and provider CDN URLs expire — this measures the damage
 * instead of assuming it.
 *
 * Run from apps/nickstire:  pnpm exec tsx scripts/probe-media-permanence.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const URL_RE = /https?:\/\/[^\s"'\\<>)\]}]+/g;

function classify(url: string): string {
  if (url.includes("/generated/")) return "ephemeral_local_disk";
  if (/higgsfield|hf-cdn|seedance/i.test(url)) return "provider_cdn_higgsfield";
  if (/googleapis|googleusercontent|storage\.google/i.test(url)) return "provider_cdn_google";
  if (/cdninstagram|fbcdn|instagram\.com/i.test(url)) return "instagram_cdn";
  if (/elevenlabs/i.test(url)) return "provider_cdn_elevenlabs";
  if (/catbox\.moe/i.test(url)) return "anonymous_catbox";
  if (url.startsWith("mock://")) return "mock";
  return "other";
}

function collectUrls(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.match(URL_RE) ?? []) {
      if (/\.(mp4|jpg|jpeg|png|webp|mp3|wav|mov)([?#]|$)/i.test(m) || m.includes("/generated/")) out.add(m);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectUrls(v, out);
  }
}

async function rows(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const res: unknown = await db.execute(query);
  return (res as [Record<string, unknown>[], unknown])[0] ?? [];
}

// ---- 1. table census -------------------------------------------------------
const tables = await rows(sql`
  SELECT table_name AS t, table_rows AS n FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name IN
    ('reel_jobs','social_content_inventory','social_content_approvals','creative_genomes','social_posts')
`);
console.log("TABLES:", JSON.stringify(tables));

// ---- 2. reel jobs by status ------------------------------------------------
const reelByStatus = await rows(sql`SELECT status, COUNT(*) AS n FROM reel_jobs GROUP BY status ORDER BY n DESC`);
console.log("REEL_JOBS_BY_STATUS:", JSON.stringify(reelByStatus));

// ---- 3. inventory by status/type ------------------------------------------
const invByStatus = await rows(sql`
  SELECT status, series_name, COUNT(*) AS n FROM social_content_inventory
  GROUP BY status, series_name ORDER BY n DESC LIMIT 25
`);
console.log("INVENTORY_BY_STATUS_SERIES:", JSON.stringify(invByStatus));

// ---- 4. harvest media URLs from recent rows -------------------------------
const urls = new Set<string>();
for (const r of await rows(sql`SELECT * FROM reel_jobs LIMIT 80`)) {
  for (const v of Object.values(r)) {
    if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
      try { collectUrls(JSON.parse(v), urls); } catch { collectUrls(v, urls); }
    } else collectUrls(v, urls);
  }
}
for (const r of await rows(sql`SELECT * FROM social_content_inventory LIMIT 60`)) {
  for (const v of Object.values(r)) {
    if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
      try { collectUrls(JSON.parse(v), urls); } catch { collectUrls(v, urls); }
    } else collectUrls(v, urls);
  }
}
console.log("DISTINCT_MEDIA_URLS_HARVESTED:", urls.size);

// ---- 5. liveness probe, capped, grouped by class --------------------------
const byClass = new Map<string, string[]>();
for (const u of urls) {
  const c = classify(u);
  if (!byClass.has(c)) byClass.set(c, []);
  byClass.get(c)!.push(u);
}

async function alive(url: string): Promise<{ ok: boolean; status: number; bytes?: string | null; contentType?: string | null }> {
  try {
    let res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000), redirect: "follow" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(6000) });
    }
    const contentType = res.headers.get("content-type");
    // An SPA catch-all answers 200 text/html for ANY missing /generated/ path —
    // a media URL serving HTML is dead, whatever the status code says.
    const htmlLie = /text\/html/i.test(contentType ?? "") && /\.(mp4|jpg|jpeg|png|webp|mp3|wav|mov)([?#]|$)/i.test(url);
    return { ok: res.ok && !htmlLie, status: res.status, bytes: res.headers.get("content-length"), contentType };
  } catch {
    return { ok: false, status: 0 };
  }
}

const CAP_PER_CLASS = 12;
const report: Record<string, { total: number; probed: number; alive: number; dead: number; samples: Array<{ url: string; status: number; bytes?: string | null; contentType?: string | null }> }> = {};
for (const [cls, list] of byClass) {
  if (cls === "mock") continue;
  const sample = list.slice(0, CAP_PER_CLASS);
  const results = [];
  for (const u of sample) results.push({ url: u.slice(0, 140), ...(await alive(u)) });
  report[cls] = {
    total: list.length,
    probed: sample.length,
    alive: results.filter((r) => r.ok).length,
    dead: results.filter((r) => !r.ok).length,
    samples: results.map((r) => ({ url: r.url, status: r.status, bytes: r.bytes, contentType: r.contentType })),
  };
}
console.log("PERMANENCE_REPORT:", JSON.stringify(report, null, 2));
process.exit(0);
