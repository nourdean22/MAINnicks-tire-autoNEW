/**
 * /api/content/drafts/[key] — approve / reject a single draft.
 * v10.0.529.106 · Wave 76.
 *
 * POST { action: "approve" | "reject", reason? } · state transition
 * DELETE · soft-delete the draft (alias for reject)
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { approveDraft, rejectDraft } from "@/lib/content/drafts";
import { sanitizeError } from "@/lib/utils/sanitize-error";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  await requireSession(req);
  const { key } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      reason?: string;
    };
    const action = body.action === "reject" ? "reject" : "approve";

    if (action === "approve") {
      const draft = await approveDraft(key);
      if (!draft) {
        return NextResponse.json({ error: "draft_not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, draft });
    }
    // reject
    await rejectDraft(key, body.reason);
    return NextResponse.json({ ok: true, rejected: true });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  await requireSession(req);
  const { key } = await params;
  try {
    await rejectDraft(key, "deleted by operator");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
