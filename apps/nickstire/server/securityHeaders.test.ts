/**
 * Hash-based script-src — the three things that must stay true for it to be
 * safe to drop 'unsafe-inline' in production:
 *
 *   1. the hash extractor hashes exactly the executable inline scripts (not
 *      external ones, not JSON-LD) — pinned against a known sha256;
 *   2. every HTML document this server serves carries ONLY inline scripts
 *      whose hashes come from client/index.html — the source of the single
 *      analytics loader — so hashing the built index covers the 336
 *      prerendered snapshots too (parity, checked file by file);
 *   3. the header actually swaps: hashes configured → 'sha256-…' and no
 *      'unsafe-inline' in script-src; nothing configured → 'unsafe-inline'
 *      (dev). style-src keeps 'unsafe-inline' in both cases.
 *
 * Module state (configureCspInlineScripts) is reset after every test — the
 * suite is serial in one process.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response, NextFunction } from "express";
import {
  configureCspInlineScripts,
  cspInlineScriptSource,
  inlineScriptHashes,
  securityHeaders,
} from "./middleware/securityHeaders";

const ROOT = process.cwd(); // apps/nickstire
// sha256("alert(1)") — computed once, outside this file, with node:crypto.
const ALERT_HASH = "bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=";

function cspOf(): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response;
  securityHeaders({} as Request, res, (() => {}) as NextFunction);
  const out: Record<string, string> = {};
  for (const d of headers["Content-Security-Policy"].split("; ")) {
    const [name, ...rest] = d.split(" ");
    out[name] = rest.join(" ");
  }
  return out;
}

function htmlFilesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFilesUnder(p, out);
    else if (name === "index.html") out.push(p);
  }
  return out;
}

afterEach(() => configureCspInlineScripts([]));

describe("inlineScriptHashes", () => {
  it("hashes executable inline scripts only, in document order", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Thing"}</script>
      <script src="/assets/app.js"></script>
      <script>alert(1)</script>
      <script type="module">alert(1)</script>
      <SCRIPT type="text/javascript" >alert(1)</SCRIPT>`;
    expect(inlineScriptHashes(html)).toEqual([ALERT_HASH, ALERT_HASH, ALERT_HASH]);
  });

  it("canary: whitespace inside the script changes the hash (the browser hashes bytes, so must we)", () => {
    expect(inlineScriptHashes("<script>alert(1) </script>")).not.toEqual([ALERT_HASH]);
    expect(inlineScriptHashes("<p>no scripts</p>")).toEqual([]);
  });
});

describe("served-HTML parity", () => {
  const sourceHashes = inlineScriptHashes(readFileSync(join(ROOT, "client", "index.html"), "utf8"));

  it("client/index.html carries exactly one executable inline script (the analytics loader)", () => {
    expect(sourceHashes).toHaveLength(1);
  });

  it("every prerendered snapshot carries only that script — one hash set covers all 300+ pages", () => {
    const files = htmlFilesUnder(join(ROOT, "prerendered"));
    expect(files.length).toBeGreaterThan(300);
    const offenders: string[] = [];
    for (const f of files) {
      const hs = inlineScriptHashes(readFileSync(f, "utf8"));
      if (hs.length !== 1 || hs[0] !== sourceHashes[0]) offenders.push(`${f} → ${JSON.stringify(hs)}`);
    }
    expect(offenders, "snapshots whose inline scripts are not the source loader").toEqual([]);
  });

  it("the built index (when present) has the same hash — Vite leaves the plain inline script untouched", () => {
    const built = join(ROOT, "dist", "public", "index.html");
    if (!existsSync(built)) return; // CI unit stage runs before build; the parity above still holds
    expect(inlineScriptHashes(readFileSync(built, "utf8"))).toEqual(sourceHashes);
  });
});

describe("Content-Security-Policy script-src", () => {
  it("control: nothing configured → 'unsafe-inline' (dev behaviour, unchanged)", () => {
    configureCspInlineScripts([]);
    expect(cspInlineScriptSource()).toBe("'unsafe-inline'");
    const csp = cspOf();
    expect(csp["script-src"]).toContain("'unsafe-inline'");
    expect(csp["script-src"]).not.toContain("sha256-");
  });

  it("canary: hashes configured → only those hashes; 'unsafe-inline' leaves script-src but stays in style-src", () => {
    configureCspInlineScripts([ALERT_HASH, ALERT_HASH]); // duplicates collapse
    const csp = cspOf();
    expect(csp["script-src"]).toContain(`'sha256-${ALERT_HASH}'`);
    expect(csp["script-src"].split(" ").filter((t) => t.startsWith("'sha256-"))).toHaveLength(1);
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["script-src"]).toContain("'self'");
    expect(csp["script-src"]).toContain("https://www.googletagmanager.com");
    expect(csp["style-src"]).toContain("'unsafe-inline'");
  });

  it("the other directives are untouched by the swap", () => {
    configureCspInlineScripts([ALERT_HASH]);
    const csp = cspOf();
    expect(csp["frame-ancestors"]).toBe("'none'");
    expect(csp["object-src"]).toBe("'none'");
    expect(csp["connect-src"]).toContain("https://*.google-analytics.com");
  });
});
