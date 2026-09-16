/**
 * /api/ai/draft-outreach · Wave AB Phase 2 · 2026-05-28.
 *
 * Generates a 1-2 sentence outreach message from Nick to a specific
 * person. Reads:
 *   · PersonProfile (name, role, dossier markdown excerpt)
 *   · last 5 RelationshipLedger entries (recent context)
 *   · the rationale string from the pick endpoint (Why now)
 *
 * Body: { personId, rationale, regenerate?: boolean }
 * Returns: { draft: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";

const log = rootLogger.withSurface("api/ai/draft-outreach");

const SYSTEM_PROMPT = `You draft outreach messages for a personal-OS operator
to send to people in their network. Keep messages:

  · 1-2 sentences max (~140 chars total)
  · plain, warm, specific to the person + the rationale
  · referencing one concrete past topic or shared context when present
  · no "Hope this finds you well" · no boilerplate
  · no signature

Return ONLY the draft message itself · no preamble, no quotes, no JSON.`;

interface RequestBody {
  personId: string;
  rationale?: string;
  regenerate?: boolean;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ draft: "" }, { status: 200 });
  }

  if (!body?.personId) {
    return NextResponse.json({ draft: "" }, { status: 200 });
  }

  try {
    const person = await prisma.personProfile.findUnique({
      where: { id: body.personId },
      select: {
        name: true,
        role: true,
        dossierMd: true,
        leverageNotes: true,
      },
    });
    if (!person) {
      return NextResponse.json({ draft: "" }, { status: 200 });
    }

    // 2026-09-16 (W8): CONTACT rows only — a status-flip audit row ("Status:
    // active → cooling", amount −5) read to the model as if the operator had
    // done something to the person.
    const recentLedger = contactRowsOnly(
      await prisma.relationshipLedger.findMany({
        where: { personId: body.personId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { amount: true, note: true, createdAt: true, source: true, metadata: true },
      }),
    ).slice(0, 5);

    const ledgerBlock = recentLedger.length
      ? recentLedger
          .map(
            (l) =>
              `· ${l.amount > 0 ? "+" : ""}${l.amount} (${l.source}) · ${l.note.slice(0, 80)}`,
          )
          .join("\n")
      : "(no recent ledger entries)";

    const dossierExcerpt = (person.dossierMd ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);

    const userBlock = [
      `PERSON: ${person.name} (${person.role})`,
      body.rationale ? `RATIONALE: ${body.rationale}` : "",
      person.leverageNotes ? `LEVERAGE NOTES: ${person.leverageNotes.slice(0, 200)}` : "",
      dossierExcerpt ? `DOSSIER EXCERPT: ${dossierExcerpt}` : "",
      "",
      "RECENT LEDGER (most recent first):",
      ledgerBlock,
      "",
      body.regenerate
        ? "Generate a DIFFERENT angle than the obvious one · try humor, a shared memory, or a forward-looking ask."
        : "Generate the most direct, warm outreach that fits the rationale.",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await tracedAiChat(
      { label: "draft-outreach", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userBlock },
      ],
      "reason",
    );

    const draft = (result.content ?? "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 320);

    return NextResponse.json({ draft });
  } catch (err) {
    log.warn("draft_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ draft: "" }, { status: 200 });
  }
}
