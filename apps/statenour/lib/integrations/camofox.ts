/**
 * camofox-browser — read-only scrape fallback behind `scrapeUrl`.
 *
 * A self-hosted camofox-browser service (jo-inc/camofox-browser, pinned to
 * commit 39c8209, runbook: docs/runbooks/camofox-scrape-fallback.md) serves a
 * page when Firecrawl cannot (no key, credits exhausted, vendor error). It is
 * NOT a tool: the only caller is `_scrapeUrl` in ./firecrawl.ts, which runs the
 * SSRF gate before it reaches this file.
 *
 * Read-only by construction: requests go through `camofoxRequest`, which
 * refuses any method + path outside CAMOFOX_ALLOWED_ENDPOINTS (create tab with
 * an initial URL, read its accessibility snapshot, close its tab group). The
 * service's cookie, login, act, click, type, upload, download and evaluate
 * endpoints are unreachable from here.
 *
 * camofox's own URL check is scheme-only (server.js validateUrl @39c8209) and
 * the service sits on Railway's private network, so the final URL it reports is
 * re-checked with assertPublicUrl: a public page that redirects to an internal
 * host is refused, not returned.
 */

import { randomUUID } from "node:crypto";
import type { FirecrawlOptions, FirecrawlResult } from "@/lib/integrations/firecrawl";
import { logger } from "@/lib/logger";

const log = logger.withSurface("integrations/camofox");

/** Every method + path this adapter may call. A test pins this list exactly. */
export const CAMOFOX_ALLOWED_ENDPOINTS = [
  { method: "POST", path: "/tabs" },
  { method: "GET", path: "/tabs/{tabId}/snapshot" },
  { method: "DELETE", path: "/tabs/group/{sessionKey}" },
] as const;

// Enforcement is derived from the list above, so the pinned list IS the gate.
const ALLOWED_PATTERNS = CAMOFOX_ALLOWED_ENDPOINTS.map((e) => ({
  method: e.method as string,
  re: new RegExp(`^${e.path.replace(/\{[^}]+\}/g, "[A-Za-z0-9_-]+")}$`),
}));

// Copied from the existing Firecrawl values (guardian timeoutMs 30_000 and
// maxLength 12_000 in ./firecrawl.ts), not tuned for camofox.
export const CAMOFOX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LENGTH = 12_000;
const CLOSE_TIMEOUT_MS = 5_000;
// camofox caps a snapshot at 80_000 chars (lib/snapshot.js MAX_SNAPSHOT_CHARS);
// 2 MB leaves room for JSON escaping and still bounds an untrusted body.
const MAX_RESPONSE_BYTES = 2_000_000;
// One fixed browser identity for scrapes; each call gets its own tab group.
const CAMOFOX_USER_ID = "statenour-scrape";

/** Both the service URL and its bearer key must be set. */
export function isCamofoxConfigured(): boolean {
  return !!process.env.CAMOFOX_URL && !!process.env.CAMOFOX_API_KEY;
}

function baseUrl(): URL {
  const raw = process.env.CAMOFOX_URL;
  if (!raw || !process.env.CAMOFOX_API_KEY) throw new Error("CAMOFOX_URL / CAMOFOX_API_KEY not configured");
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("CAMOFOX_URL must be http(s)");
  return u;
}

/** Reads at most MAX_RESPONSE_BYTES, then parses. An untrusted body is size-capped before JSON.parse. */
async function readCappedJson(res: Response): Promise<any> {
  const reader = res.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`camofox response too large (> ${MAX_RESPONSE_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`camofox returned non-JSON (HTTP ${res.status})`);
  }
}

async function camofoxRequest(
  method: "POST" | "GET" | "DELETE",
  path: string,
  signal: AbortSignal,
  init: { query?: Record<string, string>; body?: unknown } = {},
): Promise<any> {
  if (!ALLOWED_PATTERNS.some((p) => p.method === method && p.re.test(path))) {
    throw new Error(`camofox endpoint not allowlisted: ${method} ${path}`);
  }
  const base = baseUrl();
  const target = new URL(path, base);
  // new URL(path, base) keeps base's origin for an absolute path; assert it anyway.
  if (target.origin !== base.origin) throw new Error("camofox request left the configured host");
  for (const [k, v] of Object.entries(init.query ?? {})) target.searchParams.set(k, v);

  const res = await fetch(target.toString(), {
    method,
    headers: {
      authorization: `Bearer ${process.env.CAMOFOX_API_KEY}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal,
    redirect: "error",
  });
  const data = await readCappedJson(res);
  if (!res.ok) {
    const detail = typeof data?.error === "string" ? data.error.slice(0, 200) : "";
    throw new Error(`camofox ${method} ${path.split("/").slice(0, 3).join("/")} failed: HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
  }
  return data;
}

/** The aria-snapshot YAML minus element refs (`[e12]`), which are browser plumbing, not page text. */
function snapshotToText(snapshot: string): string {
  return snapshot.replace(/ \[e\d+\]/g, "").trim();
}

async function assertLandedPublic(requested: string, landed: unknown): Promise<void> {
  if (typeof landed !== "string" || !landed || landed === requested) return;
  const { assertPublicUrl } = await import("@/lib/utils/url-safety");
  const safety = await assertPublicUrl(landed);
  if (!safety.safe) {
    const { UnsafeScrapeUrlError } = await import("@/lib/integrations/firecrawl");
    throw new UnsafeScrapeUrlError(requested, `landed_on_non_public_url: ${safety.reason ?? "failed_url_safety_check"}`);
  }
}

/**
 * Scrape one URL through camofox. Callers MUST have passed the URL through the
 * SSRF gate first (only `_scrapeUrl` calls this). The tab group is always
 * closed in `finally`, including when creation itself failed or timed out.
 */
export async function scrapeWithCamofox(url: string, opts: FirecrawlOptions = {}): Promise<FirecrawlResult> {
  const sessionKey = `scrape-${randomUUID()}`;
  const signal = AbortSignal.timeout(CAMOFOX_TIMEOUT_MS);
  try {
    const tab = await camofoxRequest("POST", "/tabs", signal, {
      body: { userId: CAMOFOX_USER_ID, sessionKey, url },
    });
    if (tab?.navigationOk === false) {
      throw new Error(`camofox navigation returned HTTP ${tab.httpStatus ?? "error"}`);
    }
    const tabId = typeof tab?.tabId === "string" ? tab.tabId : "";
    if (!tabId) throw new Error("camofox create tab returned no tabId");
    await assertLandedPublic(url, tab.url);

    const snap = await camofoxRequest("GET", `/tabs/${encodeURIComponent(tabId)}/snapshot`, signal, {
      query: { userId: CAMOFOX_USER_ID, format: "text" },
    });
    await assertLandedPublic(url, snap?.url);

    const text = snapshotToText(typeof snap?.snapshot === "string" ? snap.snapshot : "");
    const maxLen = opts.maxLength ?? DEFAULT_MAX_LENGTH;
    return {
      markdown: text.length > maxLen ? text.slice(0, maxLen) + "\n\n...[truncated]" : text,
      // The snapshot carries no <title>; null is honest, a guessed heading is not.
      title: null,
      description: null,
      sourceUrl: typeof snap?.url === "string" && snap.url ? snap.url : url,
      charCount: text.length,
      provider: "camofox",
    };
  } finally {
    await camofoxRequest("DELETE", `/tabs/group/${sessionKey}`, AbortSignal.timeout(CLOSE_TIMEOUT_MS), {
      query: { userId: CAMOFOX_USER_ID },
    }).catch((err) => {
      log.warn("camofox_tab_close_failed", {
        err: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    });
  }
}
