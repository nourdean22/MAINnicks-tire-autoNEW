/**
 * linkGraph — page features for every indexable public page, built WITHOUT
 * network from the registries this repo already owns (README §P, Wave C).
 *
 * Why a separate pure module: the scorer (`server/services/linkRecommender.ts`)
 * needs the same page features the client needs for "related" picks
 * (`BlogPost.tsx`), and neither side may import the other. Everything here is
 * derived from `shared/routes.ts`, `shared/blog.ts`, `shared/guides.ts`,
 * `shared/services.ts` and the curated prior in `shared/internalLinks.ts`.
 *
 * No embeddings, deliberately — `shared/creativeFingerprint.ts` records the
 * decision; semantic match is word-set Jaccard (`shared/reelOriginality.ts`).
 */
import { ALL_ROUTES, SITEMAP_ROUTES, getRouteByPath, type RouteEntry } from "./routes";
import { BLOG_ARTICLES, type BlogArticle } from "./blog";
import { GUIDES } from "./guides";
import { SERVICES } from "./services";
import { NEIGHBORHOODS } from "./neighborhoods";
import { jaccardSimilarity, normalizeForComparison } from "./reelOriginality";
import {
  SERVICE_RELATIONSHIPS,
  SERVICE_TO_CITIES,
  SERVICE_PATH_ALIASES,
  BLOG_TAG_TO_SERVICES,
  canonicalServicePath,
  serviceSlugToName,
} from "./internalLinks";

export type PageType =
  | "core"
  | "service"
  | "seo-service"
  | "city"
  | "neighborhood"
  | "blog"
  | "guide"
  | "problem"
  | "seasonal"
  | "comparison"
  | "tire-size"
  | "utility"
  | "legal"
  | "landing";

/** Search intent, coarse. Drives the intent-match weight in the scorer. */
export type PageIntent = "transactional" | "local" | "informational" | "comparison" | "navigational";

/** Topic cluster — one of a fixed, hand-named set so cluster equality is cheap. */
export type Cluster =
  | "tires"
  | "brakes"
  | "diagnostics"
  | "emissions"
  | "oil"
  | "electrical"
  | "hvac"
  | "drivetrain"
  | "maintenance"
  | "local"
  | "money"
  | "general";

export interface PageFeatures {
  path: string;
  type: PageType;
  title: string;
  /** H1-ish: the hero headline for services, the article title for blog/guides, else the SEO title. */
  h1: string;
  headings: string[];
  tags: string[];
  cluster: Cluster;
  intent: PageIntent;
  /** In SITEMAP_ROUTES (or a blog/guide leaf, which the sitemap builds from BLOG_SLUGS / GUIDES). */
  indexable: boolean;
  /** Links INTO this page from the curated graph + site-wide component lists + article chips. */
  inbound: number;
  /** Links OUT of this page from the same sources. */
  outbound: number;
  /** Approximate word count of the body we know about; 0 = unknown, never "thin". */
  wordCount: number;
  /** Set when the page is a service: the canonical service slug. */
  serviceSlug?: string;
  /** Set when the page is a city/neighborhood: the geo slug. */
  geoSlug?: string;
}

/**
 * Hrefs rendered on (almost) every page by `client/src/components/InternalLinks.tsx`
 * plus the three footer links of `RelatedServices.tsx`. Mirrored here because a
 * shared module cannot import a React component; the parity canary
 * `client/src/__tests__/internal-links-parity.test.ts` fails if the two drift.
 * Fragment hrefs (`/tires#tire-repair`) count for `/tires`.
 */
export const SITEWIDE_COMPONENT_LINKS: readonly string[] = [
  "/tires", "/brakes", "/diagnostics", "/emissions", "/oil-change", "/auto-repair-near-me",
  "/ac-repair", "/transmission", "/electrical", "/battery", "/alignment", "/exhaust",
  "/cooling", "/starter-alternator", "/belts-hoses", "/pre-purchase-inspection",
  "/diagnose", "/pricing", "/services", "/specials", "/reviews", "/blog", "/guides",
  "/guides/how-to-read-tire-size", "/guides/when-to-replace-tires",
  "/guides/new-vs-used-tires-cleveland", "/guides/annual-car-maintenance-cost-guide",
  "/faq", "/contact", "/booking", "/fleet", "/financing", "/rewards", "/car-care-guide",
  "/about", "/careers", "/cleveland-auto-repair", "/euclid-auto-repair",
  "/lakewood-auto-repair", "/parma-auto-repair", "/shaker-heights-auto-repair",
  "/cleveland-heights-auto-repair", "/mentor-auto-repair", "/tires#tire-repair",
  "/wheel-alignment-cleveland", "/no-credit-check-tires-cleveland", "/tires#open-sundays",
  "/areas-served",
];

/** Lexicon: a word in title/tags/headings → cluster. First match in this order wins. */
const CLUSTER_LEXICON: Array<[Cluster, string[]]> = [
  ["emissions", ["emissions", "e-check", "echeck", "exhaust", "muffler", "catalytic"]],
  ["brakes", ["brake", "brakes", "rotor", "rotors", "caliper", "pads"]],
  ["tires", ["tire", "tires", "tread", "alignment", "tpms", "wheel", "pothole", "flat"]],
  ["diagnostics", ["diagnostic", "diagnostics", "check engine", "obd", "code", "codes", "scan"]],
  ["oil", ["oil", "synthetic", "lube"]],
  ["electrical", ["battery", "alternator", "starter", "electrical", "wiring", "won't start", "wont start"]],
  ["hvac", ["ac", "a/c", "heater", "heating", "cooling", "radiator", "coolant", "overheat", "overheating", "thermostat"]],
  ["drivetrain", ["transmission", "clutch", "axle", "cv", "belt", "belts", "hose", "hoses", "timing"]],
  ["money", ["cost", "price", "pricing", "financing", "payment", "budget", "cheap", "coupon", "specials", "credit"]],
  ["maintenance", ["maintenance", "inspection", "seasonal", "winter", "spring", "summer", "fall", "checklist", "rotation"]],
];

const SERVICE_CLUSTER: Record<string, Cluster> = {
  tires: "tires", alignment: "tires", brakes: "brakes", diagnostics: "diagnostics",
  "check-engine": "diagnostics", emissions: "emissions", exhaust: "emissions",
  "oil-change": "oil", "general-repair": "general", "pre-purchase-inspection": "maintenance",
  "ac-repair": "hvac", cooling: "hvac", battery: "electrical", "starter-alternator": "electrical",
  electrical: "electrical", transmission: "drivetrain", "belts-hoses": "drivetrain", financing: "money",
};

const SERVICE_SLUGS = new Set<string>([...SERVICES.map((s) => s.slug), "alignment"]);
/** Reverse of SERVICE_PATH_ALIASES: canonical path → the SERVICES slug it serves. */
const SERVICE_SLUG_BY_ALIAS_TARGET = new Map(Object.entries(SERVICE_PATH_ALIASES).map(([slug, target]) => [target, slug]));

function clusterOf(text: string, fallback: Cluster = "general"): Cluster {
  const n = ` ${normalizeForComparison(text)} `;
  for (const [cluster, words] of CLUSTER_LEXICON) {
    for (const w of words) {
      const nw = normalizeForComparison(w);
      if (nw && n.includes(` ${nw} `)) return cluster;
    }
  }
  return fallback;
}

function intentFor(type: PageType): PageIntent {
  switch (type) {
    case "service":
    case "seo-service":
    case "tire-size":
    case "landing":
      return "transactional";
    case "city":
    case "neighborhood":
      return "local";
    case "blog":
    case "guide":
    case "problem":
    case "seasonal":
      return "informational";
    case "comparison":
      return "comparison";
    default:
      return "navigational";
  }
}

/** Blog paths are leaves under /blog/; the sitemap builds them from BLOG_SLUGS. */
const blogPath = (slug: string): string => `/blog/${slug}`;
const guidePath = (slug: string): string => `/guides/${slug}`;

const SITEMAP_PATHS = new Set(SITEMAP_ROUTES.map((r) => r.path));
const INDEXED_NEIGHBORHOODS = new Set(NEIGHBORHOODS.filter((n) => n.indexed).map((n) => `/${n.slug}`));

/**
 * Indexable = Google is invited to index it: in the sitemap set (which already
 * drops noindex neighborhoods and `sitemap:false` entries), or a blog/guide leaf.
 * A registered-but-noindex page is a valid LINK target for users but never a
 * recommendation target — linking equity into a noindex page is wasted.
 */
export function isIndexablePath(path: string, dynamicBlogSlugs: ReadonlySet<string> = new Set()): boolean {
  if (SITEMAP_PATHS.has(path)) return true;
  if (path.startsWith("/blog/")) {
    const slug = path.slice("/blog/".length);
    return BLOG_ARTICLES.some((a) => a.slug === slug) || dynamicBlogSlugs.has(slug);
  }
  if (path.startsWith("/guides/")) return GUIDES.some((g) => guidePath(g.slug) === path);
  return INDEXED_NEIGHBORHOODS.has(path);
}

/** Strip `#fragment` and `?query`; keep the pathname only. */
export function canonicalPath(href: string): string {
  const noHash = href.split("#")[0] ?? "";
  const noQuery = noHash.split("?")[0] ?? "";
  if (noQuery.length > 1 && noQuery.endsWith("/")) return noQuery.slice(0, -1);
  return noQuery || "/";
}

/**
 * Service slug ("brakes" or "/brakes") → CANONICAL route path, or null when it
 * is not a service route. An aliased slug resolves to its 301 target.
 */
export function servicePathFor(slug: string): string | null {
  const cleaned = slug.replace(/^\//, "");
  if (!SERVICE_SLUGS.has(cleaned) && cleaned !== "financing") return null;
  return canonicalServicePath(cleaned);
}

/** SERVICE_TO_CITIES values are city slugs ("cleveland"); the routes are `/<slug>-auto-repair`. */
export function cityPathFor(citySlug: string): string | null {
  const candidate = `/${citySlug}-auto-repair`;
  return ALL_ROUTES.some((r) => r.path === candidate) ? candidate : null;
}

/**
 * Word-level tag → service mapping. BLOG_TAG_TO_SERVICES is keyed by single
 * words ("brakes", "winter") but real article tags are phrases ("winter tires
 * Cleveland"), so the exact-key lookup in `getServicesForBlogTags` matched
 * nothing. Tokenise, then map each token.
 */
export function servicesForTagWords(tags: readonly string[], limit = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    for (const word of normalizeForComparison(tag).split(" ")) {
      const key = word.endsWith("s") && BLOG_TAG_TO_SERVICES[word.slice(0, -1)] ? word.slice(0, -1) : word;
      for (const svc of BLOG_TAG_TO_SERVICES[key] ?? BLOG_TAG_TO_SERVICES[`${key}s`] ?? []) {
        if (seen.has(svc)) continue;
        seen.add(svc);
        out.push(`/${svc}`);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** Minimal shape for a DB-published article (dynamic_articles row, already JSON-parsed). */
export interface DynamicArticleLite {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  relatedServices: string[];
  headings?: string[];
  wordCount?: number;
}

export interface BuildCorpusOptions {
  dynamicArticles?: DynamicArticleLite[];
}

interface Edge { from: string; to: string }

function curatedEdges(corpusPaths: ReadonlySet<string>, articles: ReadonlyArray<{ path: string; relatedServices: string[] }>): Edge[] {
  const edges: Edge[] = [];
  const push = (from: string, to: string) => {
    if (from !== to && corpusPaths.has(from) && corpusPaths.has(to)) edges.push({ from, to });
  };
  for (const [svc, rel] of Object.entries(SERVICE_RELATIONSHIPS)) {
    const from = servicePathFor(svc);
    if (!from) continue;
    for (const r of rel) {
      const to = servicePathFor(r);
      if (to) push(from, to);
    }
  }
  for (const [svc, cities] of Object.entries(SERVICE_TO_CITIES)) {
    const from = servicePathFor(svc);
    if (!from) continue;
    for (const c of cities) {
      const to = cityPathFor(c);
      if (to) { push(from, to); push(to, from); }
    }
  }
  for (const a of articles) {
    for (const s of a.relatedServices) {
      const to = servicePathFor(s);
      if (to) push(a.path, to);
    }
  }
  // Site-wide component lists: every page that renders InternalLinks /
  // RelatedServices can reach these. Count ONE inbound per target (the
  // rotation shows a subset per page, so a per-page count would overstate).
  const footerTargets = new Set(SITEWIDE_COMPONENT_LINKS.map(canonicalPath));
  for (const to of footerTargets) if (corpusPaths.has(to)) edges.push({ from: "/", to });
  return edges;
}

function routeFeatures(r: RouteEntry): Omit<PageFeatures, "inbound" | "outbound"> {
  const type = r.group as PageType;
  const slug = SERVICE_SLUG_BY_ALIAS_TARGET.get(r.path) ?? r.path.replace(/^\//, "");
  const svc = SERVICES.find((s) => s.slug === slug);
  const headings: string[] = [];
  const tags: string[] = [];
  let h1 = r.title;
  let wordCount = 0;
  if (svc) {
    h1 = svc.heroHeadline;
    headings.push(...svc.problems.map((p) => p.question), ...(svc.signs ?? []));
    tags.push(...svc.keywords);
    wordCount = normalizeForComparison(
      [svc.shortDesc, svc.heroSubline, ...svc.problems.map((p) => p.answer), ...svc.whyUs].join(" "),
    ).split(" ").length;
  }
  const geo = type === "city" ? slug.replace(/-auto-repair$/, "") : type === "neighborhood" ? slug : undefined;
  const clusterFallback: Cluster = type === "city" || type === "neighborhood" ? "local" : "general";
  const cluster = svc
    ? SERVICE_CLUSTER[svc.slug] ?? "general"
    : slug === "alignment" || slug === "financing"
      ? SERVICE_CLUSTER[slug]
      : clusterOf(`${r.title} ${tags.join(" ")}`, clusterFallback);
  return {
    path: r.path,
    type,
    title: r.title,
    h1,
    headings,
    tags,
    cluster,
    intent: intentFor(type),
    indexable: isIndexablePath(r.path),
    wordCount,
    serviceSlug: svc ? svc.slug : slug === "alignment" ? "alignment" : undefined,
    geoSlug: geo,
  };
}

function articleFeatures(a: Pick<BlogArticle, "slug" | "title" | "category" | "tags"> & { headings: string[]; wordCount: number; relatedServices: string[] }): Omit<PageFeatures, "inbound" | "outbound"> {
  return {
    path: blogPath(a.slug),
    type: "blog",
    title: a.title,
    h1: a.title,
    headings: a.headings,
    tags: [...a.tags, a.category],
    cluster: clusterOf(`${a.title} ${a.category} ${a.tags.join(" ")}`),
    intent: "informational",
    indexable: true,
    wordCount: a.wordCount,
  };
}

/**
 * Build the corpus. Pure and synchronous; a DB-published article list may be
 * passed in by a server caller (the client passes nothing and gets the static
 * tree, which is exactly what the prerender sees).
 */
export function buildLinkCorpus(opts: BuildCorpusOptions = {}): PageFeatures[] {
  const base: Array<Omit<PageFeatures, "inbound" | "outbound">> = [];
  for (const r of ALL_ROUTES) {
    if (r.path.startsWith("/admin") || r.path.startsWith("/portal") || r.group === "landing") continue;
    base.push(routeFeatures(r));
  }
  const articleLinks: Array<{ path: string; relatedServices: string[] }> = [];
  for (const a of BLOG_ARTICLES) {
    const wordCount = normalizeForComparison(a.sections.map((s) => s.content).join(" ")).split(" ").length;
    base.push(articleFeatures({ ...a, headings: a.sections.map((s) => s.heading), wordCount }));
    articleLinks.push({ path: blogPath(a.slug), relatedServices: a.relatedServices });
  }
  const staticSlugs = new Set(BLOG_ARTICLES.map((a) => a.slug));
  for (const d of opts.dynamicArticles ?? []) {
    if (staticSlugs.has(d.slug)) continue; // static wins, same as BlogPost.tsx lookup order
    base.push(articleFeatures({ ...d, headings: d.headings ?? [], wordCount: d.wordCount ?? 0 }));
    articleLinks.push({ path: blogPath(d.slug), relatedServices: d.relatedServices });
  }
  for (const g of GUIDES) {
    base.push({
      path: guidePath(g.slug),
      type: "guide",
      title: g.title,
      h1: g.title,
      headings: g.sections.map((s) => s.heading),
      tags: [g.category],
      cluster: clusterOf(`${g.title} ${g.category} ${g.sections.map((s) => s.heading).join(" ")}`),
      intent: "informational",
      indexable: true,
      wordCount: normalizeForComparison(g.sections.map((s) => s.content).join(" ")).split(" ").length,
    });
  }

  const paths = new Set(base.map((b) => b.path));
  const edges = curatedEdges(paths, articleLinks);
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const e of edges) {
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    outbound.set(e.from, (outbound.get(e.from) ?? 0) + 1);
  }
  return base.map((b) => ({ ...b, inbound: inbound.get(b.path) ?? 0, outbound: outbound.get(b.path) ?? 0 }));
}

/** Curated edge lookup for the scorer: true when the prior says A should link to B. */
export function curatedRelation(a: PageFeatures, b: PageFeatures): "hub→spoke" | "spoke→hub" | "spoke→spoke" | "service→local" | "local→service" | "article→service" | "none" {
  if (a.serviceSlug && b.serviceSlug) {
    const rel = SERVICE_RELATIONSHIPS[a.serviceSlug] ?? [];
    if (rel.includes(b.serviceSlug)) return "spoke→spoke";
  }
  if (a.serviceSlug && b.geoSlug) {
    if ((SERVICE_TO_CITIES[a.serviceSlug] ?? []).includes(b.geoSlug)) return "service→local";
  }
  if (a.geoSlug && b.serviceSlug) {
    if ((SERVICE_TO_CITIES[b.serviceSlug] ?? []).includes(a.geoSlug)) return "local→service";
  }
  if (a.type === "blog" && b.serviceSlug) {
    if (servicesForTagWords(a.tags, 8).includes(`/${b.serviceSlug}`)) return "article→service";
  }
  if (a.path === "/services" && b.serviceSlug) return "hub→spoke";
  if (a.serviceSlug && b.path === "/services") return "spoke→hub";
  return "none";
}

/** Topic text used for the semantic Jaccard: title + H1 + headings + tags. */
function topicText(p: Pick<PageFeatures, "title" | "h1" | "headings" | "tags">): string {
  return [p.title, p.h1, ...p.headings, ...p.tags].join(" ");
}

export function topicSimilarity(a: PageFeatures, b: PageFeatures): number {
  return jaccardSimilarity(topicText(a), topicText(b));
}

/**
 * Related-article ranking for BlogPost.tsx: Jaccard on title+tags+headings,
 * plus a same-category bonus and a shared-service bonus. Deterministic, ties
 * broken by slug so the prerender is stable run to run.
 */
export interface RankableArticle {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  relatedServices: string[];
  headings?: string[];
}

function relatedArticleScore(current: RankableArticle, candidate: RankableArticle): number {
  const text = (a: RankableArticle) => [a.title, ...a.tags, ...(a.headings ?? [])].join(" ");
  const sem = jaccardSimilarity(text(current), text(candidate));
  const sameCategory = current.category === candidate.category ? 0.25 : 0;
  const sharedSvc = candidate.relatedServices.some((s) => current.relatedServices.includes(s)) ? 0.1 : 0;
  return sem + sameCategory + sharedSvc;
}

export function rankRelatedArticles<T extends RankableArticle>(current: RankableArticle, pool: readonly T[], limit = 2): T[] {
  return pool
    .filter((a) => a.slug !== current.slug)
    .map((a) => ({ a, s: relatedArticleScore(current, a) }))
    .sort((x, y) => y.s - x.s || x.a.slug.localeCompare(y.a.slug))
    .slice(0, limit)
    .map((x) => x.a);
}

/**
 * Validate an article's "related services" chips for rendering: keep only
 * registered routes with `sitemap: true` (the registry marks every redirecting
 * alias `sitemap: false`, which is the client-safe proxy for `isRedirectedPath`
 * — that helper lives in server/_core and cannot be imported here). Order is
 * preserved, duplicates dropped. When nothing survives, fall back to the
 * tag-word mapping so a chip strip never renders empty for a tagged article.
 */
export function validateServiceChips(paths: readonly string[], tags: readonly string[] = [], limit = 4): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const p = canonicalServicePath(canonicalPath(raw.startsWith("/") ? raw : `/${raw}`));
    const route = getRouteByPath(p);
    if (!route || !route.sitemap || out.includes(p)) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : servicesForTagWords(tags, limit).map(canonicalServicePath).filter((p) => getRouteByPath(p)?.sitemap);
}

/** Display label for a service chip — the curated name, never a raw slug. */
export function serviceChipLabel(path: string): string {
  return serviceSlugToName(path);
}
