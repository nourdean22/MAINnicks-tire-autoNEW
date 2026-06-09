/**
 * POST /api/system/command · F5 personal command shortcuts.
 *
 * Body: { text: string }  (e.g. "/what-changed" or "/import-session <log>")
 * Owner-only. Runs a registered command end-to-end and returns its text result.
 * Unknown commands return suggestions (never an error page).
 */

import { apiHandler } from "@/lib/utils/http";
import { runCommand } from "@/lib/ai/chat/command-registry";

export const POST = apiHandler(
  async (req: Request) => {
    const body = (await req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    return runCommand(text);
  },
  { auth: "owner" },
);
