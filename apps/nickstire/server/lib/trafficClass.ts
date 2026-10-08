/**
 * server/lib/trafficClass.ts · 2026-10-07
 *
 * Classifies an analytics beacon as human / datacenter / ua_inconsistent /
 * automation / unknown, so experiments and visitor counts stop counting a bot
 * fleet as people.
 *
 * Why: on 2026-10-01 most home-page traffic came from Microsoft Azure IPs with
 * spoofed UAs (~21 page loads per IP) that executed JS and fired
 * experiment_exposure + CTA-click events. Measured against that day's 501
 * /api/analytics/conversion POSTs: the cloud providers' own published ranges
 * plus the UA rules below flag 486 (97%); the unflagged were mostly
 * mobile-carrier IPs. UA rules alone caught 32% — the fleet rotates realistic
 * UAs. False positives on 26 real visitors from 2026-10-06: 0 by UA, 1 by IP.
 *
 * Sources are the providers' OWN publications (AWS ip-ranges.json, GCP
 * cloud.json, Azure Service Tags, Oracle public_ip_ranges.json), refreshed
 * daily. X4BNet/lists_vpn caught slightly more but ships no licence file, so
 * it is not used (docs/UPSTREAMS.md).
 *
 * Honesty rules:
 *  - Ingest never waits on the network: classification uses whatever ranges
 *    are already loaded and triggers a refresh in the background.
 *  - Until EVERY source has loaded, an IP that matches nothing is `unknown`,
 *    never `human` — an incomplete list must not certify anyone.
 *  - Raw IPs are never stored; only the class is.
 */
import { isIP, BlockList } from "net";
import { sql } from "drizzle-orm";
import { ipv4ToInt } from "./publicFetch";
import { createLogger } from "./logger";

const log = createLogger("traffic-class");

export type TrafficClass = "human" | "datacenter" | "ua_inconsistent" | "automation" | "unknown";

/** Classes that readers exclude from visitor / experiment counts. */
const NON_HUMAN_TRAFFIC_CLASSES: readonly TrafficClass[] = ["datacenter", "ua_inconsistent", "automation"];

/**
 * customer_events predicate: drop rows tagged non-human. Rows written before
 * tagging existed (no `traffic` key) and `unknown` rows are KEPT — excluding
 * them would silently erase all history and every visitor seen while the
 * ranges were still loading.
 */
export function excludeNonHumanTraffic() {
  return sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.traffic.class')), 'unclassified') NOT IN (${sql.join(
    NON_HUMAN_TRAFFIC_CLASSES.map((c) => sql`${c}`),
    sql`, `,
  )})`;
}

const AUTOMATION_UA = /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|Lighthouse|PageSpeed|axe-audit|Claude Code|\b(bot|crawler|spider|slurp)\b/i;

/**
 * Deterministic UA verdict, or null when the UA alone proves nothing.
 * `ua_inconsistent`: from iOS 26 Safari FREEZES the UA's OS token at 18_x
 * ("iPhone OS 18_7 ... Version/26.6" is a real iPhone), so the impossible pair
 * is Safari 26+ with an OS token below 18 — e.g. the fleet's "iPhone OS 16_0
 * ... Version/26.6". (A first version used < 26 and flagged every real iPhone.)
 */
export function classifyUserAgent(ua: string | null | undefined): "automation" | "ua_inconsistent" | null {
  if (!ua) return null;
  if (AUTOMATION_UA.test(ua)) return "automation";
  const ios = /iPhone OS (\d+)_/.exec(ua);
  const safari = /Version\/(\d+)\./.exec(ua);
  if (ios && safari && Number(safari[1]) >= 26 && Number(ios[1]) < 18) return "ua_inconsistent";
  return null;
}

// ─── datacenter ranges ───────────────────────────────────────────────

/** Sorted, merged, inclusive uint32 intervals for IPv4; a BlockList for IPv6. */
export interface RangeSet {
  v4: Array<[number, number]>;
  v6: BlockList;
}

export function buildRangeSet(cidrs: string[]): RangeSet {
  const raw: Array<[number, number]> = [];
  const v6 = new BlockList();
  for (const c of cidrs) {
    const [addr, bitsRaw] = c.trim().split("/");
    const bits = Number(bitsRaw);
    const fam = isIP(addr);
    if (fam === 4 && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
      // `&` yields a SIGNED int32: unsign it before the arithmetic, or every
      // range at or above 128.0.0.0 (most of Azure) gets a wrong end.
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      const start = (ipv4ToInt(addr) & mask) >>> 0;
      raw.push([start, start + 2 ** (32 - bits) - 1]);
    } else if (fam === 6 && Number.isInteger(bits) && bits >= 0 && bits <= 128) {
      try { v6.addSubnet(addr, bits, "ipv6"); } catch { /* malformed prefix · skip */ }
    }
  }
  raw.sort((a, b) => a[0] - b[0]);
  const v4: Array<[number, number]> = [];
  for (const r of raw) {
    const last = v4[v4.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else v4.push([r[0], r[1]]);
  }
  return { v4, v6 };
}

export function inRangeSet(set: RangeSet, ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    let lo = 0;
    let hi = set.v4.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [s, e] = set.v4[mid];
      if (n < s) hi = mid - 1;
      else if (n > e) lo = mid + 1;
      else return true;
    }
    return false;
  }
  if (fam === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked against the v4 table.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return inRangeSet(set, mapped[1]);
    return set.v6.check(ip, "ipv6");
  }
  return false;
}

/** Pure decision, given the UA verdict, the range lookup and whether the ranges are complete. */
export function decideTrafficClass(input: {
  userAgent: string | null | undefined;
  ip: string | null | undefined;
  ranges: RangeSet | null;
  rangesComplete: boolean;
}): TrafficClass {
  const byUa = classifyUserAgent(input.userAgent);
  if (byUa) return byUa;
  if (!input.ip || !input.ranges) return "unknown";
  if (inRangeSet(input.ranges, input.ip)) return "datacenter";
  return input.rangesComplete ? "human" : "unknown";
}

// ─── source fetch + cache ────────────────────────────────────────────

const AZURE_DETAILS_PAGE = "https://www.microsoft.com/en-us/download/details.aspx?id=56519";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;

type SourceName = "aws" | "gcp" | "azure" | "oracle";
const SOURCES: SourceName[] = ["aws", "gcp", "azure", "oracle"];

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Extract the CIDR strings each provider publishes. Exported for tests. */
export function parseProviderCidrs(source: SourceName, body: unknown): string[] {
  const b = body as Record<string, unknown>;
  switch (source) {
    case "aws": {
      const v4 = (b.prefixes as Array<{ ip_prefix?: string }> | undefined) ?? [];
      const v6 = (b.ipv6_prefixes as Array<{ ipv6_prefix?: string }> | undefined) ?? [];
      return [...v4.map((p) => p.ip_prefix), ...v6.map((p) => p.ipv6_prefix)].filter((x): x is string => typeof x === "string");
    }
    case "gcp": {
      const ps = (b.prefixes as Array<{ ipv4Prefix?: string; ipv6Prefix?: string }> | undefined) ?? [];
      return ps.map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter((x): x is string => typeof x === "string");
    }
    case "azure": {
      const vs = (b.values as Array<{ properties?: { addressPrefixes?: string[] } }> | undefined) ?? [];
      return vs.flatMap((v) => v.properties?.addressPrefixes ?? []);
    }
    case "oracle": {
      const rs = (b.regions as Array<{ cidrs?: Array<{ cidr?: string }> }> | undefined) ?? [];
      return rs.flatMap((r) => (r.cidrs ?? []).map((c) => c.cidr)).filter((x): x is string => typeof x === "string");
    }
  }
}

async function fetchSource(source: SourceName): Promise<string[]> {
  switch (source) {
    case "aws":
      return parseProviderCidrs("aws", await getJson("https://ip-ranges.amazonaws.com/ip-ranges.json"));
    case "gcp":
      return parseProviderCidrs("gcp", await getJson("https://www.gstatic.com/ipranges/cloud.json"));
    case "oracle":
      return parseProviderCidrs("oracle", await getJson("https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json"));
    case "azure": {
      // The Service Tags file URL rotates weekly; the details page links the current one.
      const page = await fetch(AZURE_DETAILS_PAGE, { signal: AbortSignal.timeout(30_000) });
      if (!page.ok) throw new Error(`azure details page -> HTTP ${page.status}`);
      const m = /https:\/\/download\.microsoft\.com\/download\/[^"']+ServiceTags_Public_\d+\.json/.exec(await page.text());
      if (!m) throw new Error("azure details page: no ServiceTags link");
      return parseProviderCidrs("azure", await getJson(m[0]));
    }
  }
}

interface CacheState {
  ranges: RangeSet | null;
  complete: boolean;
  loadedAt: number;
  nextAttemptAt: number;
  inFlight: Promise<void> | null;
}
const state: CacheState = { ranges: null, complete: false, loadedAt: 0, nextAttemptAt: 0, inFlight: null };

async function refreshRanges(): Promise<void> {
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const cidrs: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length > 0) cidrs.push(...r.value);
    else failed.push(SOURCES[i]);
  });
  // Keep a previous complete set rather than downgrading to a partial one.
  if (failed.length > 0 && state.complete) {
    log.warn("datacenter range refresh partial; keeping previous complete set", { failed });
    state.nextAttemptAt = Date.now() + RETRY_MS;
    return;
  }
  if (cidrs.length > 0) {
    state.ranges = buildRangeSet(cidrs);
    state.complete = failed.length === 0;
    state.loadedAt = Date.now();
  }
  state.nextAttemptAt = Date.now() + (failed.length === 0 ? REFRESH_MS : RETRY_MS);
  log.info("datacenter ranges loaded", { prefixes: cidrs.length, v4Intervals: state.ranges?.v4.length ?? 0, complete: state.complete, failed });
}

function ensureFresh(now: number): void {
  if (state.inFlight || now < state.nextAttemptAt) return;
  state.inFlight = refreshRanges()
    .catch((err) => {
      log.warn("datacenter range refresh failed", { error: err instanceof Error ? err.message : String(err) });
      state.nextAttemptAt = Date.now() + RETRY_MS;
    })
    .finally(() => { state.inFlight = null; });
}

/** Non-blocking: classifies with what is loaded now, refreshes in the background. */
export function classifyTraffic(userAgent: string | null | undefined, ip: string | null | undefined): TrafficClass {
  ensureFresh(Date.now());
  return decideTrafficClass({ userAgent, ip, ranges: state.ranges, rangesComplete: state.complete });
}

/** Test seam: replace the cached ranges. */
export function __setTrafficRangesForTest(ranges: RangeSet | null, complete: boolean): void {
  state.ranges = ranges;
  state.complete = complete;
  state.nextAttemptAt = Number.MAX_SAFE_INTEGER; // no background fetch in tests
}
