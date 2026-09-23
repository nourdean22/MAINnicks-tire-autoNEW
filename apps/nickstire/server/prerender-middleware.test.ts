/**
 * Prerender middleware bypass test · wave-181.19 · Gap 5 from test-analyzer audit
 *
 * Wave-181.12 added: `if (process.env.PRERENDER_MODE === "true") return next();`
 * to server/prerender-middleware.ts. This is the critical fix for the
 * circular-bug where puppeteer (Googlebot UA) was being served prior
 * prerendered HTML by the same middleware its prerender pass was
 * supposed to update.
 *
 * The bypass does NOTHING in prod (PRERENDER_MODE never true), making
 * it a tempting "dead code" target for a future cleanup commit. This
 * test fails loudly if the line gets deleted.
 *
 * Tests cover:
 *   1. PRERENDER_MODE=true → bypass (next() called, sendFile not)
 *   2. PRERENDER_MODE=undefined + bot UA + file exists → serves file
 *   3. PRERENDER_MODE=undefined + bot UA + no file → falls through
 *   4. PRERENDER_MODE=undefined + non-bot UA → falls through
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPrerenderMiddleware } from "./prerender-middleware";
import type { Request, Response, NextFunction } from "express";

function mockReq(opts: { ua: string; method?: string; path?: string }) {
  return {
    method: opts.method ?? "GET",
    path: opts.path ?? "/",
    get: (h: string) => (h.toLowerCase() === "user-agent" ? opts.ua : ""),
  } as unknown as Request;
}

function mockRes() {
  const sendFile = vi.fn();
  const setHeader = vi.fn();
  const set = vi.fn();
  return { sendFile, setHeader, set } as unknown as Response & {
    sendFile: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

describe("prerender-middleware · PRERENDER_MODE bypass (wave-181.12 critical fix)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prerender-test-"));
    // Seed an index.html so middleware doesn't disable itself
    fs.writeFileSync(path.join(tmpDir, "index.html"), "<html>seed</html>");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PRERENDER_MODE;
  });

  it("PRERENDER_MODE=true · bypasses serving even for Googlebot (the bug fix)", () => {
    process.env.PRERENDER_MODE = "true";
    const mw = createPrerenderMiddleware(tmpDir);
    const req = mockReq({ ua: "Googlebot/2.1" });
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile).not.toHaveBeenCalled();
  });

  it("PRERENDER_MODE unset · serves file to bot UA when file exists", () => {
    const mw = createPrerenderMiddleware(tmpDir);
    const req = mockReq({ ua: "Googlebot/2.1" });
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect((res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("PRERENDER_MODE unset · non-bot UA falls through to next() (regular users)", () => {
    const mw = createPrerenderMiddleware(tmpDir);
    const req = mockReq({ ua: "Mozilla/5.0 (regular human)" });
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile).not.toHaveBeenCalled();
  });

  it("PRERENDER_MODE unset · bot UA + missing file falls through to SPA", () => {
    const mw = createPrerenderMiddleware(tmpDir);
    const req = mockReq({ ua: "Googlebot/2.1", path: "/nonexistent-route" });
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile).not.toHaveBeenCalled();
  });

  it("PRERENDER_MODE=true takes precedence over bot UA + existing file", () => {
    process.env.PRERENDER_MODE = "true";
    const mw = createPrerenderMiddleware(tmpDir);
    // bot UA + file present + PRERENDER_MODE=true → MUST bypass
    const req = mockReq({ ua: "claudebot" });
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile).not.toHaveBeenCalled();
  });
});

describe("prerender-middleware · a closed job leaf is never served its stale artifact", () => {
  // Codex review on #2557: the middleware runs BEFORE the SPA fallback, so a
  // filled role's committed prerendered/careers/<slug>/index.html (which
  // still carries a live JobPosting) kept answering 200 to Googlebot and the
  // fallback's 404 never ran.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prerender-careers-"));
    fs.writeFileSync(path.join(tmpDir, "index.html"), "<html>seed</html>");
    for (const slug of ["automotive-technician", "no-such-role"]) {
      fs.mkdirSync(path.join(tmpDir, "careers", slug), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "careers", slug, "index.html"), `<html>${slug}</html>`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const run = (p: string) => {
    const mw = createPrerenderMiddleware(tmpDir);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq({ ua: "Googlebot/2.1", path: p }), res, next);
    return { served: (res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile.mock.calls.length, next };
  };

  it("an OPEN role's artifact is still served (control)", () => {
    expect(run("/careers/automotive-technician").served).toBe(1);
  });

  it("an artifact for a role that is not open falls through to the SPA fallback (404)", async () => {
    const r = run("/careers/no-such-role");
    expect(r.served).toBe(0);
    expect(r.next).toHaveBeenCalled();
  });

  it("a role flipped to filled stops being served, even with its file on disk", async () => {
    const { JOB_OPENINGS } = await import("../shared/jobOpenings");
    const job = JOB_OPENINGS.find((j) => j.slug === "automotive-technician")!;
    const original = job.status;
    try {
      job.status = "filled";
      expect(run("/careers/automotive-technician").served).toBe(0);
    } finally {
      job.status = original;
    }
  });
});
