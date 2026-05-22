// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { buildTodoDesk } from "@/lib/services/todo-desk";

/**
 * GET /api/ultron/todo-desk
 *
 * The intelligent-under, simple-on-front data source for the TodoDesk
 * HQ card. Merges active task + ranked queue + aging backlog +
 * tomorrow preview into one payload so the UI stays minimal.
 *
 * Phase B.6a (2026-05-22) · the desk composer was extracted into
 * `lib/services/todo-desk.ts` (buildTodoDesk) so the new
 * `operator.todoDesk` tRPC procedure calls the SAME function · drift
 * impossible. This route stays mounted as the rollback path. The
 * `cached()` wrapper lives inside `buildTodoDesk` so both transports
 * share the 60s window.
 */

export const revalidate = 60;

export async function GET() {
  try {
    const payload = await buildTodoDesk();
    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: sanitizeError(err),
      },
      { status: 500 },
    );
  }
}
