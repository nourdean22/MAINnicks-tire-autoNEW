/**
 * POST /api/system/session-import · F1 Claude session importer.
 *
 * Body: { text: string, store?: boolean }  (owner-only)
 * Returns the structured digest + suggested follow-up tasks. Persists the digest
 * to SessionReport unless store=false. Does NOT create tasks (suggestion-only —
 * no hidden autonomy); the operator confirms tasks elsewhere.
 */

import { apiHandler } from "@/lib/utils/http";
import { importSession } from "@/lib/services/session-import";

export const POST = apiHandler(
  async (req: Request) => {
    const body = (await req.json().catch(() => ({}))) as { text?: unknown; store?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    if (text.trim().length === 0) {
      return { error: "Provide a non-empty 'text' (the pasted session log)." };
    }
    const store = body.store !== false; // default true
    return importSession(text, { store });
  },
  { auth: "owner" }, // operator pastes session logs; owner-only
);
