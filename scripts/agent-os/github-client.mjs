#!/usr/bin/env node
/**
 * Shared GitHub REST client for agent-os scripts (Session Authority · 2026-09-23).
 *
 * Two environment gotchas, both verified live in a cloud container before this file
 * was written, that every GitHub-calling script in this repo needs to get right:
 *
 * 1. TOKEN SOURCE DIFFERS BY PLATFORM. Cloud sessions have no `gh` CLI on PATH but a
 *    valid, admin-scoped GITHUB_TOKEN in the environment. Bridge (Windows) sessions
 *    have a real `gh` but `apps/statenour/AGENTS.md` documents a DUMMY GITHUB_TOKEN
 *    that overrides `gh`'s own stored keyring credential when present in its env —
 *    the same reason root AGENTS.md's push recipe clears GITHUB_TOKEN before calling
 *    `gh` on Windows. `ghAuthToken()` below does the equivalent for any platform by
 *    stripping GH_TOKEN/GITHUB_TOKEN from the CHILD process env only (not this
 *    process's), so `gh auth token` is forced to answer from its real keyring
 *    wherever `gh` exists, and the env-var fallback only ever fires where it does not.
 *
 * 2. Node's built-in fetch() silently 401s against api.github.com in this sandbox
 *    unless NODE_USE_ENV_PROXY=1 is a REAL process environment variable at launch
 *    (setting it via process.env.X = "1" inside a running process does nothing —
 *    verified both ways). ensureProxyEnv() re-execs the current entry script once,
 *    with the flag set, when HTTPS_PROXY is present and the flag is not — call it
 *    as the FIRST line of any script's top-level code, before any fetch happens.
 *
 * Usage:
 *   import { ensureProxyEnv, ghFetch, ghJson, ghPaginate } from "./github-client.mjs";
 *   ensureProxyEnv();               // top of the entry script, before anything else
 *   const repo = await ghJson("/repos/owner/repo");
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";

const API = "https://api.github.com";

/**
 * Re-exec this process with NODE_USE_ENV_PROXY=1 if a proxy is configured and the
 * flag is not already set. No-op (returns immediately) when neither applies, so it
 * is safe to call unconditionally. Exits the CURRENT process and never returns when
 * a re-exec happens — the child's exit code becomes this process's exit code.
 */
export function ensureProxyEnv() {
  if (!process.env.HTTPS_PROXY || process.env.NODE_USE_ENV_PROXY === "1") return;
  const r = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 1);
}

/** True if `cmd` resolves on PATH, without throwing when it does not. */
function commandExists(cmd) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 5000 });
  return !r.error;
}

/** `gh auth token`, with GH_TOKEN/GITHUB_TOKEN stripped from the CHILD env so a
 * dummy value inherited from the parent cannot shadow gh's real stored credential
 * (see file header, point 1). Returns null if `gh` is absent, unauthenticated, or
 * errors — never throws. */
function ghAuthToken() {
  if (!commandExists("gh")) return null;
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8", env, timeout: 10000 });
  const token = r.status === 0 ? r.stdout?.trim() : "";
  return token ? token : null;
}

/** Resolve a GitHub token: `gh auth token` first (real credential, any platform
 * where `gh` exists and works), then GH_TOKEN, then GITHUB_TOKEN — never the
 * reverse, per the gotcha in the file header. Returns {token, source} or null. */
export function resolveToken() {
  const viaGh = ghAuthToken();
  if (viaGh) return { token: viaGh, source: "gh auth token" };
  if (process.env.GH_TOKEN) return { token: process.env.GH_TOKEN, source: "GH_TOKEN env" };
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: "GITHUB_TOKEN env" };
  return null;
}

/** API budget meter (2026-09-23). CI's GITHUB_TOKEN gets ~1,000 requests/hour per
 * repo, and live canaries here exhausted it ("403 API rate limit exceeded for
 * installation") the day the full-sweep canary landed. When AGENT_OS_GH_CALL_LOG
 * names a file, every request appends one JSON line {script, method, path} to it;
 * verify.mjs sets it and prints the per-run total and top consumers, so the budget
 * is measured on every run instead of discovered by the next 403. Never throws: a
 * meter that can break the call it meters is worse than none. */
function recordCall(method, url) {
  const log = process.env.AGENT_OS_GH_CALL_LOG;
  if (!log) return;
  try {
    const script = process.argv[1] ? basename(process.argv[1]) : "(eval)";
    appendFileSync(log, JSON.stringify({ script, method, path: new URL(url).pathname }) + "\n");
  } catch {
    /* metering is best-effort */
  }
}

/** Low-level fetch against the GitHub REST API. Caller must have already called
 * ensureProxyEnv() once at process start. Throws if no token can be resolved. */
export async function ghFetch(path, opts = {}) {
  // Defensive, not the fix itself: if a caller forgot ensureProxyEnv() at the top
  // of its entry script, fail LOUDLY and specifically instead of a silent 401 that
  // downstream code could misread as "no access" or "not found" (see file header,
  // point 2 — this exact silent-401 shape is the bug #2589 fixed for pretool.mjs's
  // hook path, one layer down).
  if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== "1") {
    throw new Error(
      "github-client: HTTPS_PROXY is set but NODE_USE_ENV_PROXY!=1 — call ensureProxyEnv() as the FIRST line of your entry script before any GitHub call, or every request here silently 401s",
    );
  }
  const auth = resolveToken();
  if (!auth) {
    throw new Error(
      "no GitHub token available: `gh auth token` failed/absent and neither GH_TOKEN nor GITHUB_TOKEN is set",
    );
  }
  const url = path.startsWith("http") ? path : `${API}${path}`;
  recordCall(opts.method ?? "GET", url);
  return fetch(url, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${auth.token}`,
      "User-Agent": "nourcity-agent-os",
      ...(opts.headers ?? {}),
    },
  });
}

/** ghFetch + parse JSON + throw a loud, specific error on a non-2xx response
 * (status, method, path, and the first 300 chars of the body — never a silent
 * `undefined` downstream). */
export async function ghJson(path, opts = {}) {
  const res = await ghFetch(path, opts);
  const bodyText = await res.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }
  if (!res.ok) {
    const method = opts.method ?? "GET";
    const snippet = typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
    throw new Error(`GitHub API ${method} ${path} -> ${res.status} ${res.statusText}: ${snippet}`);
  }
  return body;
}

/** Follow pagination and return every item across all pages. Only for endpoints
 * that return a top-level JSON array.
 *
 * Deliberately does NOT follow the URL inside the Link header's rel="next" entry —
 * GitHub returns that URL in the numeric-ID form (api.github.com/repositories/{id}/...)
 * for at least the branches endpoint, and this environment's outbound proxy 403s
 * that form ("Numeric-ID repository paths are not supported through this proxy" —
 * caught live by branch-sweep.test.mjs, not assumed). So this only checks the
 * header for WHETHER a next page exists, and constructs the next request itself
 * from the original owner/repo-form path with an incremented `page` param, which
 * the proxy always accepts. */
export async function ghPaginate(path, opts = {}) {
  const items = [];
  const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
  if (!url.searchParams.has("per_page")) url.searchParams.set("per_page", "100");
  let page = Number(url.searchParams.get("page") || "1");
  for (;;) {
    url.searchParams.set("page", String(page));
    const res = await ghFetch(url.toString(), opts);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API GET ${url} -> ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
    }
    const pageItems = await res.json();
    if (!Array.isArray(pageItems)) throw new Error(`ghPaginate: ${url} did not return an array`);
    items.push(...pageItems);
    if (pageItems.length === 0) break;
    const link = res.headers.get("link") ?? "";
    const hasNext = link.split(",").some((s) => s.trim().endsWith('rel="next"'));
    if (!hasNext) break;
    page += 1;
  }
  return items;
}
