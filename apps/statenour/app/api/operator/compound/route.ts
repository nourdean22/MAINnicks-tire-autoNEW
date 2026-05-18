/**
 * GET /api/operator/compound · Phase G (2026-05-18 PM)
 *
 * Returns the CompoundChain · task → goal → axis → scoreboard chain
 * for the requested surface.
 *
 * Query: `?surface=tasks|goals|scoreboard|home` (default: home).
 *
 * Caching: 60s private. Compound chains move slowly (tied to check-offs
 * + nightly mastery roll-up) · 60s strikes the balance between
 * freshness and avoiding repeated queries across multiple surface
 * mounts.
 *
 * See: lib/services/compound-chain.ts
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import {
  buildCompoundChain,
  type CompoundSurface,
} from "@/lib/services/compound-chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const VALID_SURFACES = new Set<CompoundSurface>([
  "tasks",
  "goals",
  "scoreboard",
  "home",
]);

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("surface") ?? "home").toLowerCase();
    const surface = VALID_SURFACES.has(raw as CompoundSurface)
      ? (raw as CompoundSurface)
      : ("home" as CompoundSurface);
    const snapshot = await buildCompoundChain(surface);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: "compound_chain_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
