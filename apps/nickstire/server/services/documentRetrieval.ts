/**
 * Fetch a public source and extract the readable prose an entailment check can
 * actually be run against.
 *
 * WHAT THIS REPLACES
 * `snapshotUrl` fetched a page and kept only a content HASH. A hash proves the
 * page existed and hasn't changed; it says nothing about what the page SAYS, so
 * every public-source evidence record stayed `entailment: "not_evaluated"`.
 * This keeps the text.
 *
 * MEASURED 2026-08-01 against the three curated sources:
 *   nhtsa.gov          HTTP 403  — still blocks bots
 *   epa.ohio.gov       HTTP 200  — 10,089 chars (registry said fetch_blocked; stale)
 *   carcare.org        HTTP 200  —  8,453 chars
 *
 * Naive tag-stripping on those pages yields navigation chrome
 * ("Site Builder > Global Components > IOP Desktop > Header"), which is why
 * extraction prefers <main>/<article> and drops nav/header/footer/aside before
 * anything reaches the entailment checker.
 */
import { createHash } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("services:document-retrieval");

const FETCH_TIMEOUT_MS = 12_000;
/** Enough for a long guidance page; passage selection narrows it afterwards. */
const MAX_TEXT_CHARS = 40_000;

export type RetrievalStatus = "fetched" | "fetch_blocked" | "fetch_failed" | "not_attempted";

export interface RetrievedDocument {
  status: RetrievalStatus;
  /** Readable prose, chrome removed. Null unless status is "fetched". */
  text: string | null;
  /** sha256 of the raw body, unchanged from the previous snapshot contract. */
  hash: string | null;
  httpStatus: number | null;
  reason?: string;
}

/** Blocks whose content is never the document's argument. */
const CHROME = /<(script|style|nav|header|footer|aside|form|noscript|svg)\b[\s\S]*?<\/\1>/gi;

/**
 * Pull the readable text out of an HTML document.
 *
 * Prefers <main> then <article>: government and non-profit pages wrap their
 * actual guidance in one of them and surround it with menus, and a claim
 * checked against the menus is checked against nothing.
 */
export function extractReadableText(html: string): string {
  let scoped = html;
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (main?.[1] && main[1].length > 400) scoped = main[1];
  else if (article?.[1] && article[1].length > 400) scoped = article[1];

  return scoped
    .replace(CHROME, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Keep block boundaries as sentence breaks so passage selection can split.
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, ". ")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    // Collapse the ". . ." runs the block-boundary substitution creates.
    .replace(/(?:\.\s*){2,}/g, ". ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Retrieve one document. Every outcome is RECORDED — a 403 is a fact about the
 * source, not an error to retry into oblivion. One attempt, short budget: these
 * run inside an operator-facing enqueue.
 */
export async function retrieveDocument(url: string): Promise<RetrievedDocument> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Identifies the fetcher honestly. Sites that block bots stay blocked,
        // which is the correct outcome — spoofing a browser to take content
        // from a source that declined is not evidence-gathering.
        "user-agent": "Mozilla/5.0 (compatible; NicksTireEvidenceBot/1.0; +https://nickstire.org)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (res.status === 403 || res.status === 401 || res.status === 429) {
      log.info("document retrieval blocked by source", { url, httpStatus: res.status });
      return { status: "fetch_blocked", text: null, hash: null, httpStatus: res.status, reason: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { status: "fetch_failed", text: null, hash: null, httpStatus: res.status, reason: `HTTP ${res.status}` };
    }

    const body = await res.text();
    const text = extractReadableText(body);
    if (text.length < 200) {
      // A page that renders its content client-side gives us markup and no
      // prose. Calling that "fetched" would hand the checker an empty document
      // and let it conclude "not supported" about a source it never read.
      return {
        status: "fetch_failed",
        text: null,
        hash: createHash("sha256").update(body).digest("hex"),
        httpStatus: res.status,
        reason: `only ${text.length} chars of readable text — likely client-rendered`,
      };
    }

    return {
      status: "fetched",
      text,
      hash: createHash("sha256").update(body).digest("hex"),
      httpStatus: res.status,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.info("document retrieval failed", { url, reason });
    return { status: "fetch_failed", text: null, hash: null, httpStatus: null, reason };
  }
}
