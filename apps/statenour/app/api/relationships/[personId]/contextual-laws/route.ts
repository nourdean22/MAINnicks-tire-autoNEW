/**
 * /api/relationships/[personId]/contextual-laws · Wave AB.b · 2026-05-28.
 *
 * Returns the top 3 Greene laws applicable to this person right now,
 * with verbatim action strings from the Wave Z corpus. Cached daily.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { pickContextualLawsForPerson } from "@/lib/ai/contextual-greene-laws";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ personId: string }> },
): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { personId } = await context.params;
  if (!personId) {
    return NextResponse.json(
      { error: "missing_person_id" },
      { status: 400 },
    );
  }

  const result = await pickContextualLawsForPerson(personId);
  return NextResponse.json(result);
}
