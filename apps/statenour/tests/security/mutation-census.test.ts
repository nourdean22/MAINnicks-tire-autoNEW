/**
 * tests/security/mutation-census.test.ts — WP-12 (2026-07-29).
 *
 * Pins the census classifier, including a RED SELF-TEST: a ghost fixture
 * that MUST be flagged. Same discipline as verify-crons check [7/7] —
 * a guard that can no longer fail is decoration, and this one only
 * earns its place in verify:hard if it still bites.
 */

import { describe, it, expect } from "vitest";
import { scanRouteSource, scanTrpcSource } from "@/scripts/audit-mutation-receipts";

const unauthedRoute = `
import { prisma } from "@/lib/prisma";
export async function POST(req: Request) {
  const body = await req.json();
  await prisma.brainMemory.create({ data: body });
  return Response.json({ ok: true });
}
`;

const authedRoute = `
import { requireSession } from "@/lib/auth-guard";
export async function POST(req: Request) {
  await requireSession(req);
  return Response.json({ ok: true });
}
`;

/** The real defect class: file authenticates, but not in THIS handler. */
const splitAuthRoute = `
import { requireSession } from "@/lib/auth-guard";
export async function POST(req: Request) {
  await prisma.brainMemory.update({ where: { id: "x" }, data: {} });
  return Response.json({ ok: true });
}
export async function GET(req: Request) {
  await requireSession(req);
  return Response.json({ ok: true });
}
`;

describe("route classifier", () => {
  it("RED SELF-TEST — a ghost unauthed mutation is flagged as a gap", () => {
    const [entry] = scanRouteSource("app/api/ghost/route.ts", unauthedRoute);
    expect(entry.verdict).toBe("gap");
    expect(entry.authed).toBe(false);
  });

  it("an auth guard inside the handler body is covered", () => {
    expect(scanRouteSource("app/api/x/route.ts", authedRoute)[0].verdict).toBe("covered");
  });

  it("auth in a SIBLING handler lands in review, never silently covered", () => {
    // This is the mission-surface-stats class — the real finding this
    // census produced on its first run. It must never read as covered.
    const post = scanRouteSource("app/api/y/route.ts", splitAuthRoute).find((e) => e.name === "POST");
    expect(post?.verdict).toBe("review");
    expect(post?.verdict).not.toBe("covered");
  });

  it("recognizes the repo's non-session auth idioms (not just requireSession)", () => {
    const idioms = [
      ["timingSafeEqual(a, b)", "hmac"],
      ["await verifyStripeSignature(req)", "signature"],
      ["assertRunnerRequest(req)", "assert-guard"],
      ["const session = await auth();", "raw next-auth"],
      ['req.headers.get("x-sync-key")', "header secret"],
      ['req.headers.get("authorization")?.startsWith("Bearer ")', "bearer"],
    ];
    for (const [guard, label] of idioms) {
      const src = `export async function POST(req: Request) {\n  ${guard}\n  return Response.json({});\n}`;
      expect(scanRouteSource("app/api/z/route.ts", src)[0].verdict, label).toBe("covered");
    }
  });

  it("a documented exception above the handler is honored and keeps its reason", () => {
    const src = `
// mutation-census: exception — retired stub, writes nothing
export async function POST(req: Request) { return Response.json({ retired: true }); }
`;
    const [entry] = scanRouteSource("app/api/retired/route.ts", src);
    expect(entry.verdict).toBe("exception");
    expect(entry.note).toContain("retired stub");
  });
});

describe("tRPC classifier", () => {
  it("publicProcedure mutations are gaps; operatorProcedure mutations are covered", () => {
    const src = `
export const r = {
  openThing: publicProcedure
    .input(z.object({}))
    .mutation(async () => ({ ok: true })),
  guardedThing: operatorProcedure
    .input(z.object({}))
    .mutation(async () => ({ ok: true })),
};
`;
    const entries = scanTrpcSource("lib/trpc/routers/x.ts", src);
    expect(entries.find((e) => e.name === "openThing")?.verdict).toBe("gap");
    expect(entries.find((e) => e.name === "guardedThing")?.verdict).toBe("covered");
  });

  it("queries are not counted — the census is about MUTATIONS", () => {
    const src = `
export const r = {
  justReading: publicProcedure.query(async () => ({ ok: true })),
};
`;
    expect(scanTrpcSource("lib/trpc/routers/x.ts", src)).toHaveLength(0);
  });
});
