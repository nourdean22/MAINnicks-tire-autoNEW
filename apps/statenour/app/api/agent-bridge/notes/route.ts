/**
 * GET /api/agent-bridge/notes?since=<id> - Nour's unread phone notes for a
 * coding session, newest first, at most 20. Contract and trust rules:
 * lib/agent-bridge/phone-notes.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import {
  requireBridgeAuth,
  PHONE_NOTE_KIND,
  PHONE_NOTE_UNREAD,
  PHONE_NOTES_PAGE,
} from "@/lib/agent-bridge/phone-notes";

const log = rootLogger.withSurface("api/agent-bridge/notes");
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const auth = requireBridgeAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const since = req.nextUrl.searchParams.get("since");
    let after: Date | undefined;
    if (since) {
      const anchor = await prisma.captureInboxItem.findFirst({
        where: { id: since.slice(0, 64), kind: PHONE_NOTE_KIND },
        select: { createdAt: true },
      });
      if (!anchor) return NextResponse.json({ error: "unknown since id" }, { status: 400, headers: NO_STORE });
      after = anchor.createdAt;
    }
    const rows = await prisma.captureInboxItem.findMany({
      where: { kind: PHONE_NOTE_KIND, status: PHONE_NOTE_UNREAD, ...(after ? { createdAt: { gt: after } } : {}) },
      orderBy: { createdAt: "desc" },
      take: PHONE_NOTES_PAGE,
      select: { id: true, createdAt: true, summary: true },
    });
    return NextResponse.json(
      { notes: rows.map((r) => ({ id: r.id, created_at: r.createdAt.toISOString(), text: r.summary })) },
      { headers: NO_STORE },
    );
  } catch (err) {
    // A failed read must not look like an empty inbox.
    log.error("phone_notes_read_failed", { client: auth.clientId, error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    return NextResponse.json({ error: "read_failed" }, { status: 500, headers: NO_STORE });
  }
}
