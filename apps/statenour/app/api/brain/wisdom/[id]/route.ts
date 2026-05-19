/**
 * /api/brain/wisdom/[id] · v10.0.383 · Phase UU (2026-05-19 AM)
 *
 * Curation actions on a single brain wisdom memory:
 *   · PATCH  · update content / confidence (operator-curated)
 *   · POST { action: "deprecate" | "promote" | "restore" }
 *
 * Phase UU · heavy lifting moved to `lib/services/brain-wisdom` so
 * both these REST endpoints AND the new `trpc.brain.{updateWisdom,
 * actOnWisdom}` mutations call the same functions · drift impossible.
 *
 * Auth · session required (operator-only).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { withTracing } from "@/lib/utils/with-tracing";
import {
  updateWisdom,
  actOnWisdom,
  WisdomNotFoundError,
  WrongCategoryError,
  NoValidFieldsError,
  type WisdomAction,
} from "@/lib/services/brain-wisdom";

interface UpdateBody {
  content?: string;
  confidence?: number;
}

interface ActionBody {
  action: WisdomAction;
}

async function patchHandler(req: NextRequest, ctx?: unknown): Promise<Response> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = await (ctx as { params?: Promise<{ id: string }> } | undefined)?.params;
  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as UpdateBody;
  try {
    return NextResponse.json(await updateWisdom({ id, ...body }));
  } catch (err) {
    if (err instanceof NoValidFieldsError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "update failed" },
      { status: 500 },
    );
  }
}

async function postHandler(req: NextRequest, ctx?: unknown): Promise<Response> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = await (ctx as { params?: Promise<{ id: string }> } | undefined)?.params;
  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as ActionBody;
  if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  try {
    return NextResponse.json(await actOnWisdom({ id, action: body.action }));
  } catch (err) {
    if (err instanceof WisdomNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof WrongCategoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "action failed" },
      { status: 500 },
    );
  }
}

export const PATCH = withTracing(patchHandler, { name: "/api/brain/wisdom/[id]" });
export const POST = withTracing(postHandler, { name: "/api/brain/wisdom/[id]" });
