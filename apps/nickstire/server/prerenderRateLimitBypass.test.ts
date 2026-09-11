/**
 * The prerender rate-limit exemption must exempt the prerenderer and NOBODY else.
 *
 * WHY IT EXISTS. `app.use("/api/trpc", apiLimiter)` charges 100 requests per 15
 * minutes to anonymous callers. scripts/prerender.mjs boots this very server on
 * localhost and walks 339 routes through Puppeteer; the home page alone issues
 * eight tRPC queries on load, and batching is blocked upstream so each is
 * charged separately. The budget is gone long before the walk ends.
 *
 * Static routes shrug that off — their content is in the bundle. DB-backed blog
 * posts have nothing without their query, so they rendered "ARTICLE NOT FOUND",
 * the prerenderer captured it at HTTP 200, and Google filed Soft 404s. The 429
 * is returned by middleware BEFORE tRPC, so the procedure logger, the
 * articleBySlug miss diagnostic and the error log could none of them see it:
 * four green instruments over an empty page, because the request they measure
 * never arrived.
 *
 * WHAT IS ASSERTED. An exemption is a hole in a control, so the arms below spend
 * far more effort proving it does NOT open than proving it does. The predicate is
 * IMPORTED, never restated — a rate-limit exemption asserted against a copy of
 * itself is an exemption nobody tested (see measurement-proxies-lie).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

/** Mirrors ANON_MAX_PER_WINDOW; only used as an upper bound on the control arm. */
const ANON_CEILING = 100;

/**
 * Run a limiter middleware `times` times against one request, counting how many
 * calls reached `next()` and how many were answered 429.
 */
async function drive(
  limiter: (req: unknown, res: unknown, next: () => void) => unknown,
  req: Request,
  times: number,
): Promise<{ passed: number; blocked: number }> {
  let passed = 0;
  let blocked = 0;
  for (let i = 0; i < times; i++) {
    await new Promise<void>((done) => {
      const res = {
        setHeader: () => {},
        getHeader: () => undefined,
        removeHeader: () => {},
        status(code: number) {
          if (code === 429) blocked++;
          return this;
        },
        send: () => done(),
        json: () => done(),
        end: () => done(),
        headersSent: false,
      };
      limiter(req, res, () => {
        passed++;
        done();
      });
    });
  }
  return { passed, blocked };
}

/** A request whose SOCKET address is `addr`, optionally with forged headers. */
function reqFrom(addr: string | undefined, headers: Record<string, string> = {}): Request {
  return {
    socket: addr === undefined ? undefined : { remoteAddress: addr },
    headers,
    ip: headers["x-forwarded-for"] ?? addr,
  } as unknown as Request;
}

/**
 * PRERENDER_MODE is read ONCE at module load — deliberately, so no request can
 * flip it — which means each arm must re-import the module under its own env.
 */
async function loadPredicate(prerenderMode: string | undefined) {
  vi.resetModules();
  if (prerenderMode === undefined) vi.stubEnv("PRERENDER_MODE", "");
  else vi.stubEnv("PRERENDER_MODE", prerenderMode);
  if (prerenderMode === undefined) delete process.env.PRERENDER_MODE;
  const mod = await import("./middleware/rateLimiters");
  return mod.isPrerenderLoopbackRequest;
}

describe("prerender rate-limit exemption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("it EXEMPTS only the prerenderer", () => {
    it("exempts a loopback request when PRERENDER_MODE is on", async () => {
      const skip = await loadPredicate("true");
      expect(skip(reqFrom("127.0.0.1"))).toBe(true);
      expect(skip(reqFrom("::1"))).toBe(true);
      expect(skip(reqFrom("::ffff:127.0.0.1"))).toBe(true);
    });
  });

  describe("it EXEMPTS NOBODY ELSE — the half that matters", () => {
    it("does not exempt loopback when PRERENDER_MODE is off", async () => {
      // Production never sets the flag. Without it, even localhost is charged.
      const skip = await loadPredicate(undefined);
      expect(skip(reqFrom("127.0.0.1"))).toBe(false);
      expect(skip(reqFrom("::1"))).toBe(false);
    });

    it("does not exempt a non-loopback caller even with PRERENDER_MODE on", async () => {
      // Defence in depth: if the env var ever leaked into a deployment, no
      // external caller gains anything.
      const skip = await loadPredicate("true");
      expect(skip(reqFrom("203.0.113.9"))).toBe(false);
      expect(skip(reqFrom("10.0.0.4"))).toBe(false);
      expect(skip(reqFrom("::ffff:203.0.113.9"))).toBe(false);
    });

    it("cannot be spoofed by a forwarded-for header claiming loopback", async () => {
      // THE REASON THE CHECK READS req.socket.remoteAddress AND NOT req.ip.
      // req.ip is derived from x-forwarded-for under trust-proxy; a socket
      // address cannot be forged by a caller.
      const skip = await loadPredicate("true");
      const spoofed = reqFrom("203.0.113.9", { "x-forwarded-for": "127.0.0.1" });
      expect(spoofed.ip, "fixture must actually carry the forged value").toBe("127.0.0.1");
      expect(skip(spoofed), "a forged header must not buy an exemption").toBe(false);
    });

    it("treats a truthy-looking but non-exact flag as OFF", async () => {
      // Only the exact string "true" arms it; "1", "yes", "TRUE" do not.
      for (const v of ["1", "yes", "TRUE", "True", " true"]) {
        const skip = await loadPredicate(v);
        expect(skip(reqFrom("127.0.0.1")), `PRERENDER_MODE=${JSON.stringify(v)}`).toBe(false);
      }
    });

    it("survives a request with no socket at all", async () => {
      const skip = await loadPredicate("true");
      expect(skip(reqFrom(undefined))).toBe(false);
    });
  });

  describe("the exemption is actually WIRED to the limiter", () => {
    it("apiLimiter passes the predicate as its skip option", () => {
      // A perfect predicate that nothing calls is decorative. express-rate-limit
      // does not expose its resolved options, so this is asserted on the source
      // — bounded with sliceBlock, which throws on a missing anchor instead of
      // silently widening the slice to EOF.
      const src = readFileSync(
        resolve(process.cwd(), "server/middleware/rateLimiters.ts"),
        "utf8",
      );
      const block = sliceBlock(src, "export const apiLimiter = rateLimit({", "});", {
        label: "rateLimiters.ts",
      });
      expect(block, "apiLimiter must pass the real predicate as skip").toContain(
        "skip: isPrerenderLoopbackRequest",
      );
      // And it must be THIS limiter, not a neighbour that happens to be nearby.
      expect(block).toContain("windowMs: AUTHED_WINDOW_MS");
    });

    it("driven through the REAL limiter: exempt traffic is never throttled", async () => {
      // The arm above asserts the STRING "skip:". If express-rate-limit ever
      // renamed that option the string would still be present and nothing would
      // work — presence, not behaviour. So run the actual exported middleware
      // past its own ceiling and count outcomes.
      vi.resetModules();
      vi.stubEnv("PRERENDER_MODE", "true");
      const { apiLimiter } = await import("./middleware/rateLimiters");
      const out = await drive(apiLimiter as never, reqFrom("127.0.0.1"), 150);
      expect(out.blocked, "the prerenderer must never be throttled").toBe(0);
      expect(out.passed).toBe(150);
    });

    it("POSITIVE CONTROL: the same traffic IS throttled with the flag off", async () => {
      // Without this, a limiter that never blocks anybody would satisfy the arm
      // above and the exemption would look proven while proving nothing.
      vi.resetModules();
      vi.stubEnv("PRERENDER_MODE", "");
      delete process.env.PRERENDER_MODE;
      const { apiLimiter } = await import("./middleware/rateLimiters");
      const out = await drive(apiLimiter as never, reqFrom("127.0.0.1"), 150);
      expect(out.blocked, "anonymous traffic past the ceiling must be throttled").toBeGreaterThan(
        0,
      );
      expect(out.passed).toBeLessThanOrEqual(ANON_CEILING);
    });

    it("the stricter form limiter is NOT exempted", () => {
      // formLimiter guards booking/lead/callback writes. The prerenderer never
      // submits a form, so it has no business being exempt there.
      const src = readFileSync(
        resolve(process.cwd(), "server/middleware/rateLimiters.ts"),
        "utf8",
      );
      const block = sliceBlock(src, "export const formLimiter = rateLimit({", "});", {
        label: "rateLimiters.ts",
      });
      expect(block, "formLimiter must not carry the prerender exemption").not.toContain(
        "isPrerenderLoopbackRequest",
      );
    });
  });
});
