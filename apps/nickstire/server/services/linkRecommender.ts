/**
 * linkRecommender — scores source→target internal-link candidates (README §P,
 * PROMPT-PACK §10 `link_recommender.v1`). Pure scoring over `shared/linkGraph`
 * features plus OPTIONAL GSC signals; the only I/O lives in the two loaders at
 * the bottom (`loadGscSignals`, `buildAdminLinkRecommendations`) and in
 * `verifyRenderedLinks`, which reads the committed prerender tree.
 *
 * No LLM, no embeddings: Jaccard + curated prior + GSC. The prompt in
 * PROMPT-PACK §10 may later ADJUST a prior by ±10; it never produces one.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildLinkCorpus,
  canonicalPath,
  curatedRelation,
  isIndexablePath,
  topicSimilarity,
  type DynamicArticleLite,
  type PageFeatures,
} from "@shared/linkGraph";
import { ALL_ROUTES } from "@shared/routes";
import { isRedirectedPath } from "../_core/redirects";
import { createLogger } from "../lib/logger";

const log = createLogger("services:link-recommender");

// ─── Weights ─────────────────────────────────────────────────────────────────
// HYPOTHESIS, not measurement (README §P: "Weights are hypotheses; calibrate
// against GSC position deltas"). Positive weights sum to 100 so a score reads
// as a percentage; penalties are subtracted after. Change a number here only
// with a before/after GSC position delta in the PR body. Only the two terms a
// test pins by value are exported; the rest surface through `evidence.weights`
// in the admin report.
const W_SEMANTIC = 25;      // Jaccard(title+H1+headings+tags) — topical fit
const W_INTENT = 20;        // same or complementary search intent
const W_CURATED = 20;       // the hand-tuned prior says these belong together
const W_CONTEXTUAL = 10;    // an insertion point exists (headings mention the target cluster)
const W_GSC_OPPORTUNITY = 10; // target has impressions and either low CTR or position 8–20
const W_BUSINESS_VALUE = 10; // money pages (services, local) over informational
export const W_GRAPH_NEED = 5;     // target is an orphan / under-linked
export const P_CANNIBALIZATION = 20; // source and target compete for the same query
const P_OVER_LINKED = 10;   // target already has many inbound links
const P_ANCHOR_REPEAT = 15; // an anchor already used on the source page
const P_THIN_DESTINATION = 10; // destination body is known-thin
const P_GEO_MISMATCH = 25;  // a city page linking to a different city's page
/** Inbound count at or above which a target counts as over-linked (site-wide components give ~1). */
const OVER_LINKED_INBOUND = 6;
/** Known word count below which a destination is "thin". 0 = unknown, never thin. */
const THIN_WORDS = 120;

export type LinkRole =
  | "hub→spoke" | "spoke→hub" | "spoke→spoke" | "service→local" | "local→service"
  | "article→service" | "article→article" | "service→article" | "local→local" | "other";

export interface LinkRecommendation {
  source: string;
  target: string;
  score: number;
  role: LinkRole;
  why: string[];
  /** Exactly 3 descriptive anchors, ≤8 words, no "click here", unique across the page. */
  anchors: [string, string, string];
  insertionHint: string;
}

export interface RejectedCandidate { targetPath: string; reason: string }

export interface GscSignals {
  /** path → impressions / ctr(%) / weighted position (position may be absent for page-level rows). */
  pages: Map<string, { impressions: number; ctr: number; position?: number }>;
  /** query → set of competing paths (from detectCannibalization). */
  cannibalPairs: Set<string>; // "a|b" sorted pair keys
}

export interface RecommendInput {
  sourcePath: string;
  corpus: PageFeatures[];
  gsc?: GscSignals | null;
  /** Hrefs already present on the source page (so they are rejected, and their anchors avoided). */
  existingOutbound?: string[];
  /** Anchor texts already on the source page. */
  existingAnchors?: string[];
  max?: number;
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ─── Validation ──────────────────────────────────────────────────────────────

const REGISTRY_PATHS = new Set(ALL_ROUTES.map((r) => r.path));

/**
 * A target is valid when it is a real, final, indexable URL: in ALL_ROUTES (or a
 * blog/guide leaf the corpus knows), NOT a redirect source, and indexable
 * (sitemap member / indexed neighborhood / article leaf).
 */
export function validateTarget(target: string, corpus: ReadonlyMap<string, PageFeatures>): string | null {
  const p = canonicalPath(target);
  if (isRedirectedPath(p)) return "redirected";
  const known = REGISTRY_PATHS.has(p) || corpus.has(p);
  if (!known) return "not-in-registry";
  const feat = corpus.get(p);
  const indexable = feat ? feat.indexable : isIndexablePath(p);
  if (!indexable) return "noindex";
  return null;
}

// ─── Anchors ─────────────────────────────────────────────────────────────────

const BANNED_ANCHORS = /\b(click here|here|read more|learn more|this page|link)\b/i;

export function isDescriptiveAnchor(anchor: string): boolean {
  const words = anchor.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  if (BANNED_ANCHORS.test(anchor)) return false;
  return true;
}

function clip8(words: string): string {
  return words.trim().split(/\s+/).slice(0, 8).join(" ");
}

function cleanTitle(title: string): string {
  // Registry titles carry SERP suffixes ("… | Nick's", "… — Nick's Tire & Auto").
  return title.split(/\s[|·—-]\s/)[0]?.trim() ?? title;
}

/** Three natural anchors for a target, distinct from each other and from `taken`. */
export function anchorsFor(target: PageFeatures, taken: ReadonlySet<string>): [string, string, string] {
  const base = cleanTitle(target.title);
  const h1 = cleanTitle(target.h1);
  const candidates: string[] = [];
  if (target.serviceSlug) {
    const name = base.replace(/\bcleveland\b.*$/i, "").trim() || base;
    candidates.push(`${name} in Cleveland`, `our ${name.toLowerCase()} service`, `${name} on Euclid Ave`);
  } else if (target.geoSlug) {
    candidates.push(base, `auto repair for ${target.geoSlug.replace(/-/g, " ")} drivers`, `${base} — walk in 7 days`);
  } else if (target.type === "blog" || target.type === "guide") {
    candidates.push(base, `read: ${base}`, `${base} (guide)`);
  } else {
    candidates.push(base, h1, `${base} at Nick's`);
  }
  // Pad with deterministic variants until three distinct, unused anchors exist.
  const out: string[] = [];
  const pool = [...candidates, h1, `${base} details`, `more on ${base.toLowerCase()}`, `${base} (Nick's Tire & Auto)`];
  for (const raw of pool) {
    const a = clip8(raw);
    const key = a.toLowerCase();
    if (!isDescriptiveAnchor(a) || taken.has(key) || out.some((o) => o.toLowerCase() === key)) continue;
    out.push(a);
    if (out.length === 3) break;
  }
  while (out.length < 3) out.push(clip8(`${base} option ${out.length + 1}`));
  return [out[0]!, out[1]!, out[2]!];
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function intentScore(a: PageFeatures, b: PageFeatures): number {
  if (a.intent === b.intent) return 1;
  // Complementary pairs: an informational page sending readers to a transactional
  // or local page is the whole point of the article lane.
  if (a.intent === "informational" && (b.intent === "transactional" || b.intent === "local")) return 0.8;
  if (a.intent === "local" && b.intent === "transactional") return 0.8;
  if (a.intent === "transactional" && b.intent === "local") return 0.6;
  if (a.intent === "comparison" && b.intent === "transactional") return 0.7;
  return 0.2;
}

function roleFor(a: PageFeatures, b: PageFeatures): LinkRole {
  const cur = curatedRelation(a, b);
  if (cur !== "none") return cur;
  if (a.type === "blog" && b.type === "blog") return "article→article";
  if (a.type === "blog" && b.serviceSlug) return "article→service";
  if (a.serviceSlug && b.type === "blog") return "service→article";
  if (a.geoSlug && b.geoSlug) return "local→local";
  if (a.serviceSlug && b.geoSlug) return "service→local";
  if (a.geoSlug && b.serviceSlug) return "local→service";
  return "other";
}

function businessValue(b: PageFeatures): number {
  if (b.serviceSlug || b.type === "seo-service" || b.type === "tire-size") return 1;
  if (b.type === "city" || b.type === "neighborhood" || b.type === "comparison") return 0.7;
  if (b.type === "guide" || b.type === "problem") return 0.4;
  return 0.2;
}

/** Score ONE pair. Exported so tests can pin each signal with a positive control. */
export function scorePair(a: PageFeatures, b: PageFeatures, gsc: GscSignals | null | undefined, takenAnchors: ReadonlySet<string>): { score: number; why: string[]; role: LinkRole; anchors: [string, string, string] } {
  const why: string[] = [];
  let score = 0;

  const sem = topicSimilarity(a, b);
  score += W_SEMANTIC * Math.min(1, sem * 4); // Jaccard of 0.25+ on word sets is a strong topical match
  if (sem > 0) why.push(`semantic jaccard ${sem.toFixed(2)}`);

  const intent = intentScore(a, b);
  score += W_INTENT * intent;
  why.push(`intent ${a.intent}→${b.intent} (${intent})`);

  const role = roleFor(a, b);
  const curated = curatedRelation(a, b) !== "none";
  if (curated) { score += W_CURATED; why.push(`curated prior: ${role}`); }

  if (a.cluster === b.cluster && a.cluster !== "general" && a.cluster !== "local") {
    score += W_CONTEXTUAL; why.push(`shared cluster ${a.cluster} gives an insertion point`);
  } else if (a.headings.some((h) => h.toLowerCase().includes(b.cluster))) {
    score += W_CONTEXTUAL * 0.6; why.push(`a heading mentions ${b.cluster}`);
  }

  const g = gsc?.pages.get(b.path);
  if (g && g.impressions > 0) {
    const lowCtr = g.ctr < 2;
    const striking = g.position !== undefined && g.position >= 8 && g.position <= 20;
    if (lowCtr || striking) {
      score += W_GSC_OPPORTUNITY;
      why.push(`gsc opportunity: ${g.impressions} impr, ctr ${g.ctr}%${g.position !== undefined ? `, pos ${g.position}` : ""}`);
    }
  }

  const bv = businessValue(b);
  score += W_BUSINESS_VALUE * bv;
  if (bv >= 0.7) why.push(`business value ${bv}`);

  if (b.inbound <= 1) { score += W_GRAPH_NEED; why.push(`graph need: ${b.inbound} inbound`); }

  if (gsc?.cannibalPairs.has(pairKey(a.path, b.path))) { score -= P_CANNIBALIZATION; why.push("cannibalization penalty"); }
  if (b.inbound >= OVER_LINKED_INBOUND) { score -= P_OVER_LINKED; why.push(`over-linked target (${b.inbound} inbound)`); }
  if (b.wordCount > 0 && b.wordCount < THIN_WORDS) { score -= P_THIN_DESTINATION; why.push(`thin destination (${b.wordCount} words)`); }
  if (a.geoSlug && b.geoSlug && a.geoSlug !== b.geoSlug) { score -= P_GEO_MISMATCH; why.push("geo mismatch"); }

  const anchors = anchorsFor(b, takenAnchors);
  const titleKey = cleanTitle(b.title).toLowerCase();
  if (takenAnchors.has(titleKey)) { score -= P_ANCHOR_REPEAT; why.push("anchor repetition avoided (title already used on page)"); }

  return { score: Math.max(0, Math.min(100, Math.round(score))), why, role, anchors };
}

function insertionHintFor(a: PageFeatures, b: PageFeatures): string {
  const heading = a.headings.find((h) => h.toLowerCase().includes(b.cluster)) ?? a.headings[0];
  if (heading) return `after the paragraph under "${heading}"`;
  if (a.serviceSlug) return "in the related-services strip or the closing CTA paragraph";
  return "in the first body paragraph that names the topic";
}

/** Main entry: recommendations for ONE source page, PROMPT-PACK §10 shape. */
export function recommendLinks(input: RecommendInput): { recommendations: LinkRecommendation[]; rejected: RejectedCandidate[] } {
  const max = input.max ?? 5;
  const byPath = new Map(input.corpus.map((p) => [p.path, p]));
  const source = byPath.get(canonicalPath(input.sourcePath));
  if (!source) return { recommendations: [], rejected: [{ targetPath: input.sourcePath, reason: "source-not-in-corpus" }] };

  const existing = new Set((input.existingOutbound ?? []).map(canonicalPath));
  const taken = new Set((input.existingAnchors ?? []).map((s) => s.toLowerCase()));
  const rejected: RejectedCandidate[] = [];
  const scored: LinkRecommendation[] = [];

  for (const target of input.corpus) {
    if (target.path === source.path) continue;
    if (existing.has(target.path)) { rejected.push({ targetPath: target.path, reason: "already-linked" }); continue; }
    const invalid = validateTarget(target.path, byPath);
    if (invalid) { rejected.push({ targetPath: target.path, reason: invalid }); continue; }
    const r = scorePair(source, target, input.gsc, taken);
    if (source.cluster === target.cluster && input.gsc?.cannibalPairs.has(pairKey(source.path, target.path))) {
      rejected.push({ targetPath: target.path, reason: "same-cluster-cannibalization" });
      continue;
    }
    scored.push({ source: source.path, target: target.path, score: r.score, role: r.role, why: r.why, anchors: r.anchors, insertionHint: insertionHintFor(source, target) });
  }

  scored.sort((x, y) => y.score - x.score || x.target.localeCompare(y.target));
  // Anchor diversity across the page: once an anchor is used by a higher-ranked
  // recommendation, lower ones must not reuse it.
  const out: LinkRecommendation[] = [];
  for (const rec of scored) {
    if (out.length >= max) break;
    const target = byPath.get(rec.target)!;
    const anchors = anchorsFor(target, taken);
    for (const a of anchors) taken.add(a.toLowerCase());
    out.push({ ...rec, anchors });
  }
  return { recommendations: out, rejected };
}

// ─── Rendered-truth check (advisory) ─────────────────────────────────────────

export interface RenderedLinkCheck {
  path: string;
  /** null = no prerendered snapshot for this path (not an error; the refresh workflow has not run). */
  snapshotFound: boolean | null;
  present: string[];
  missing: string[];
}

/**
 * Reads `prerendered/<path>/index.html` (the COMMITTED tree, refreshed only by
 * `.github/workflows/prerender-refresh.yml` on main — never hand-edited, never
 * regenerated from a session) and reports which targets have an `<a href>`.
 * ADVISORY: a `missing` entry after a client change only becomes a defect once
 * that refresh has run on main; before then it reports the previous snapshot.
 */
export function verifyRenderedLinks(pagePath: string, targets: readonly string[], prerenderRoot = path.resolve(process.cwd(), "prerendered")): RenderedLinkCheck {
  const p = canonicalPath(pagePath);
  const file = p === "/" ? path.join(prerenderRoot, "index.html") : path.join(prerenderRoot, p.replace(/^\//, ""), "index.html");
  if (!existsSync(file)) return { path: p, snapshotFound: null, present: [], missing: [...targets] };
  const html = readFileSync(file, "utf8");
  const present: string[] = [];
  const missing: string[] = [];
  for (const t of targets) {
    const re = new RegExp(`<a\\b[^>]*\\bhref="${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[#?][^"]*)?"`, "i");
    (re.test(html) ? present : missing).push(t);
  }
  return { path: p, snapshotFound: true, present, missing };
}

// ─── I/O: GSC signals + the admin builder ────────────────────────────────────

function pathFromGscPage(page: string): string {
  try {
    return canonicalPath(new URL(page).pathname);
  } catch {
    return canonicalPath(page);
  }
}

/**
 * Empty-vs-error: a thrown read returns `{ ok: false }` and the caller reports
 * "GSC unavailable" — it must never score as "no opportunities".
 */
async function loadGscSignals(): Promise<{ ok: true; signals: GscSignals; pagesRead: number; cannibalRows: number } | { ok: false; error: string }> {
  try {
    const { getPagePerformance, findCtrOpportunities, detectCannibalization } = await import("../pipelines/gsc-data");
    const [perf, ctr, cannibal] = await Promise.all([
      getPagePerformance({ limit: 500 }),
      findCtrOpportunities({ limit: 100 }),
      detectCannibalization({ limit: 50 }),
    ]);
    const pages = new Map<string, { impressions: number; ctr: number; position?: number }>();
    for (const row of perf) pages.set(pathFromGscPage(row.page), { impressions: Number(row.impressions) || 0, ctr: Number(row.avgCtr) || 0 });
    for (const o of ctr) {
      const p = pathFromGscPage(o.page);
      const cur = pages.get(p) ?? { impressions: o.impressions, ctr: o.currentCtr };
      pages.set(p, { ...cur, position: o.avgPosition });
    }
    const cannibalPairs = new Set<string>();
    for (const issue of cannibal) {
      const paths = issue.pages.map((p) => pathFromGscPage(p.page));
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) cannibalPairs.add(pairKey(paths[i]!, paths[j]!));
    }
    return { ok: true, signals: { pages, cannibalPairs }, pagesRead: perf.length, cannibalRows: cannibal.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("GSC signals unavailable — scoring without the opportunity/cannibalization terms", { error });
    return { ok: false, error };
  }
}

function safeJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function loadDynamicArticlesLite(): Promise<{ ok: true; articles: DynamicArticleLite[] } | { ok: false; error: string }> {
  try {
    const { getPublishedArticles } = await import("../content-generator");
    // getPublishedArticles() rides the untyped getDb() path, so rows is `any`:
    // name the shape we read instead of inheriting `any`.
    const rows = (await getPublishedArticles()) as Array<{
      slug: string; title: string; category: string;
      sectionsJson?: string | null; tagsJson?: string | null; relatedServicesJson?: string | null;
    }>;
    const articles: DynamicArticleLite[] = rows.map((r) => {
      let headings: string[] = [];
      let wordCount = 0;
      try {
        const sections = JSON.parse(String(r.sectionsJson ?? "[]")) as Array<{ heading?: string; content?: string; body?: string }>;
        headings = sections.map((s) => s.heading ?? "").filter(Boolean);
        wordCount = sections.map((s) => s.content ?? s.body ?? "").join(" ").split(/\s+/).filter(Boolean).length;
      } catch { /* malformed sections: headings stay empty, wordCount 0 = unknown */ }
      return {
        slug: r.slug,
        title: r.title,
        category: r.category,
        tags: safeJsonArray(r.tagsJson),
        relatedServices: safeJsonArray(r.relatedServicesJson).map((s) => (s.startsWith("/") ? s : `/${s}`)),
        headings,
        wordCount,
      };
    });
    return { ok: true, articles };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface AdminLinkReport {
  generatedAt: string;
  corpusSize: number;
  evidence: {
    gsc: { state: "HEALTHY" | "UNAVAILABLE"; pagesRead?: number; cannibalRows?: number; error?: string };
    dynamicArticles: { state: "HEALTHY" | "UNAVAILABLE"; count?: number; error?: string };
    rendered: RenderedLinkCheck[];
    weights: Record<string, number>;
  };
  recommendations: LinkRecommendation[];
  rejected: RejectedCandidate[];
}

/**
 * Admin-only builder (seoTools.linkRecommendations). Nothing is written and no
 * page is changed: this is the evidence panel the operator reads before a
 * client change goes through a PR.
 */
export async function buildAdminLinkRecommendations(opts: { sourcePath?: string; limit?: number } = {}): Promise<AdminLinkReport> {
  const [gsc, dyn] = await Promise.all([loadGscSignals(), loadDynamicArticlesLite()]);
  const corpus = buildLinkCorpus({ dynamicArticles: dyn.ok ? dyn.articles : [] });
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const sources = opts.sourcePath
    ? corpus.filter((p) => p.path === canonicalPath(opts.sourcePath!))
    : corpus.filter((p) => p.indexable && (p.serviceSlug || p.type === "city" || p.type === "blog"));

  const recommendations: LinkRecommendation[] = [];
  const rejected: RejectedCandidate[] = [];
  const perSource = opts.sourcePath ? limit : 3;
  for (const src of sources) {
    const r = recommendLinks({ sourcePath: src.path, corpus, gsc: gsc.ok ? gsc.signals : null, max: perSource });
    recommendations.push(...r.recommendations);
    if (opts.sourcePath) rejected.push(...r.rejected.filter((x) => x.reason !== "not-in-registry"));
  }
  recommendations.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
  const top = recommendations.slice(0, limit);

  const bySource = new Map<string, string[]>();
  for (const rec of top) bySource.set(rec.source, [...(bySource.get(rec.source) ?? []), rec.target]);
  const rendered = Array.from(bySource.entries()).slice(0, 25).map(([src, targets]) => verifyRenderedLinks(src, targets));

  return {
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    evidence: {
      gsc: gsc.ok ? { state: "HEALTHY", pagesRead: gsc.pagesRead, cannibalRows: gsc.cannibalRows } : { state: "UNAVAILABLE", error: gsc.error },
      dynamicArticles: dyn.ok ? { state: "HEALTHY", count: dyn.articles.length } : { state: "UNAVAILABLE", error: dyn.error },
      rendered,
      weights: { W_SEMANTIC, W_INTENT, W_CURATED, W_CONTEXTUAL, W_GSC_OPPORTUNITY, W_BUSINESS_VALUE, W_GRAPH_NEED, P_CANNIBALIZATION, P_OVER_LINKED, P_ANCHOR_REPEAT, P_THIN_DESTINATION, P_GEO_MISMATCH },
    },
    recommendations: top,
    rejected,
  };
}
