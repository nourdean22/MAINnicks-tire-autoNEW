// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/ultron/error-patterns
 *
 * Groups the last-7d ErrorLog rows by a stable signature (first 80
 * chars of message + path from context) so recurring failures bubble
 * up as actionable patterns rather than drowning the surface with
 * near-duplicates.
 *
 * Returns the top 10 patterns ordered by occurrence count. Each pattern
 * includes:
 *   - signature    — the grouping key
 *   - count        — total occurrences in the window
 *   - lastSeen     — most recent occurrence ISO
 *   - firstSeen    — oldest occurrence ISO (tells us how long this
 *                    has been recurring)
 *   - sample       — the full message from the most recent instance
 *   - paths        — distinct request paths the error fired on
 *   - severity     — derived: critical=count≥10 in 24h, warning=count≥5
 *                    in 7d, info otherwise
 *
 * Query ?window=24h|7d|30d (default 7d).
 */

export const revalidate = 180; // 3 min

interface ErrorPattern {
  signature: string;
  count: number;
  lastSeen: string;
  firstSeen: string;
  sample: string;
  paths: string[];
  severity: "info" | "warning" | "critical";
  recurring: boolean;
}

function parseWindow(w: string | null): { ms: number; label: string } {
  switch (w) {
    case "24h":
      return { ms: 24 * 3600_000, label: "24h" };
    case "30d":
      return { ms: 30 * 86400_000, label: "30d" };
    default:
      return { ms: 7 * 86400_000, label: "7d" };
  }
}

/** Stable grouping signature — first 80 chars of message. */
function signatureFor(message: string): string {
  return message.slice(0, 80).toLowerCase().replace(/\s+/g, " ").trim();
}

function extractPath(context: unknown): string | null {
  if (!context || typeof context !== "object") return null;
  const c = context as Record<string, unknown>;
  if (typeof c.path === "string") return c.path;
  if (typeof c.route === "string") return c.route;
  return null;
}

export async function GET(req: NextRequest) {
  const { ms, label } = parseWindow(req.nextUrl.searchParams.get("window"));
  const since = new Date(Date.now() - ms);
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const errors = await prisma.errorLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, message: true, context: true, createdAt: true, level: true },
  });

  const groups = new Map<
    string,
    {
      count: number;
      count24h: number;
      first: Date;
      last: Date;
      sample: string;
      paths: Set<string>;
    }
  >();

  for (const e of errors) {
    const sig = signatureFor(e.message);
    const p = extractPath(e.context);
    const g = groups.get(sig) ?? {
      count: 0,
      count24h: 0,
      first: e.createdAt,
      last: e.createdAt,
      sample: e.message,
      paths: new Set<string>(),
    };
    g.count++;
    if (e.createdAt >= since24h) g.count24h++;
    if (e.createdAt < g.first) g.first = e.createdAt;
    if (e.createdAt > g.last) {
      g.last = e.createdAt;
      g.sample = e.message; // keep the most recent full message
    }
    if (p) g.paths.add(p);
    groups.set(sig, g);
  }

  const patterns: ErrorPattern[] = [...groups.entries()].map(([sig, g]) => {
    let severity: ErrorPattern["severity"] = "info";
    if (g.count24h >= 10) severity = "critical";
    else if (g.count >= 5) severity = "warning";
    const recurring =
      g.count >= 3 && g.last.getTime() - g.first.getTime() > 6 * 3600_000;
    return {
      signature: sig,
      count: g.count,
      lastSeen: g.last.toISOString(),
      firstSeen: g.first.toISOString(),
      sample: g.sample.slice(0, 300),
      paths: [...g.paths].slice(0, 5),
      severity,
      recurring,
    };
  });

  patterns.sort((a, b) => b.count - a.count);

  return NextResponse.json({
    data: {
      window: label,
      totalErrors: errors.length,
      distinctPatterns: patterns.length,
      topPatterns: patterns.slice(0, 10),
      generatedAt: new Date().toISOString(),
    },
  });
}
