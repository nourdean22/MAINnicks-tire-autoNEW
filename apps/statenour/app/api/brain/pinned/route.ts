/**
 * PINNED MEMORY API — Nour's always-loaded context slots.
 *
 * A pin is a BrainMemory row with:
 *   category: BRAIN_CATEGORIES.PINNED_USER
 *   confidence:  1.0 (max — survives every pruning pass)
 *   expiresAt:   null (permanent)
 *   source:      "pin:chat" | "pin:command" | "pin:manual" | etc.
 *
 * System prompt (lib/ai/system-prompt.ts) reads category=pinned_user
 * every turn and injects the top 5 into a "Pinned by Nour" block
 * above the rolling memory window.
 *
 * Phase YY (2026-05-19 AM) · heavy lifting moved to `lib/services/pins`
 * so both this REST endpoint AND the new
 * `trpc.brain.{pinned,createPin,updatePin,deletePin}` procedures call
 * the same functions · drift impossible.
 */

// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  listPins,
  createPin,
  updatePin,
  deletePin,
  PinNotFoundError,
  PinContentRequiredError,
  PinContentTooLongError,
} from "@/lib/services/pins";

/**
 * 2026-09-07 · anonymous requests used to hit `requireSession()` OUTSIDE the
 * handler's try/catch, so the ServiceError it throws escaped as an unhandled
 * 500 — live-probed: `GET /api/brain/pinned` answered 500 and minted a Sentry
 * issue per probe, while every sibling under the session-exempt `/api/brain`
 * prefix answered 401. Same denial, honest status, no error-log noise. Any
 * throw from the session check is a denial: nothing else is allowed through.
 * Pinned by tests/security/brain-pinned-anonymous.test.ts. The name keeps
 * the `requireSession` idiom scripts/check-sensitive-get-auth.ts scans each
 * handler body for.
 */
async function requireSessionOr401(req: NextRequest): Promise<NextResponse | null> {
  try {
    await requireSession(req);
    return null;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

interface PinCreateBody {
  content?: string;
  source?: string;
  label?: string;
}

interface PinPatchBody {
  id?: string;
  content?: string;
  label?: string;
  source?: string;
}

export async function GET(req: NextRequest) {
  const denied = await requireSessionOr401(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const withStats = url.searchParams.get("withStats") === "1";
    return NextResponse.json(await listPins({ withStats }));
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "fetch failed",
        code: "PINS_FETCH_FAILED",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireSessionOr401(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as PinCreateBody;
    return NextResponse.json(
      await createPin({
        content: body.content ?? "",
        source: body.source,
        label: body.label,
      }),
    );
  } catch (err) {
    if (err instanceof PinContentRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof PinContentTooLongError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "pin failed",
        code: "PIN_WRITE_FAILED",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSessionOr401(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as PinPatchBody;
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    return NextResponse.json(
      await updatePin({
        id: body.id,
        content: body.content,
        label: body.label,
        source: body.source,
      }),
    );
  } catch (err) {
    if (err instanceof PinNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof PinContentRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "patch failed",
        code: "PIN_PATCH_FAILED",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSessionOr401(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    return NextResponse.json(await deletePin({ id }));
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "unpin failed",
        code: "PIN_DELETE_FAILED",
      },
      { status: 500 },
    );
  }
}
