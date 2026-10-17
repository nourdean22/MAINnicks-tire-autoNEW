/**
 * POST /api/agent-bridge/notes/ack { ids: string[] } - mark phone notes read.
 * Compare-and-swap: the update matches only notes that are still unread, so a
 * second ack (or a racing session) flips nothing and `acked` counts only the
 * notes this call moved. Contract: lib/agent-bridge/phone-notes.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import {
  auditNotesCall,
  requireBridgeAuth,
  PHONE_NOTE_KIND,
  PHONE_NOTE_READ,
  PHONE_NOTE_UNREAD,
} from "@/lib/agent-bridge/phone-notes";

const log = rootLogger.withSurface("api/agent-bridge/notes/ack");
const AckBody = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50) });

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireBridgeAuth(req, "phone_notes_ack");
  if (auth instanceof NextResponse) return auth;

  const raw: unknown = await req.json().catch(() => null);
  const inputRaw = JSON.stringify(raw ?? null);
  const parsed = AckBody.safeParse(raw);
  if (!parsed.success) {
    await auditNotesCall(auth, "phone_notes_ack", startedAt, inputRaw, { status: "error", errorCode: "bad_body" });
    return NextResponse.json({ error: "body must be { ids: string[] } (1-50 ids)" }, { status: 400 });
  }

  try {
    const res = await prisma.captureInboxItem.updateMany({
      where: { id: { in: parsed.data.ids }, kind: PHONE_NOTE_KIND, status: PHONE_NOTE_UNREAD },
      data: { status: PHONE_NOTE_READ, triagedAt: new Date() },
    });
    await auditNotesCall(auth, "phone_notes_ack", startedAt, inputRaw, { status: "success", resultSize: res.count });
    return NextResponse.json({ acked: res.count });
  } catch (err) {
    log.error("phone_notes_ack_failed", { client: auth.clientId, error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    await auditNotesCall(auth, "phone_notes_ack", startedAt, inputRaw, { status: "error", errorCode: "ack_failed" });
    return NextResponse.json({ error: "ack_failed" }, { status: 500 });
  }
}
