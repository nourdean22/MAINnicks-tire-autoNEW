/**
 * GET /api/brain/not-seeing · 2026-10-22 · preview of the weekly "What you're not
 * seeing" section (lib/services/not-seeing-note.ts). Read-only: composes, never sends.
 * `inMondayBrief` says whether NICK_WEEKLY_GAP_NOTE puts it in the morning brief.
 *
 * Auth: owner only.
 */
import { apiHandler } from "@/lib/utils/http";
import { buildNotSeeingSlice } from "@/lib/services/not-seeing-note";
import { getFlag } from "@/lib/feature-flags";
import { today } from "@/lib/utils/datetime";

export const GET = apiHandler(
  async () => {
    const slice = await buildNotSeeingSlice(today());
    return {
      text: slice.lines.join("\n"),
      lines: slice.lines,
      payload: slice.payload,
      inMondayBrief: getFlag("NICK_WEEKLY_GAP_NOTE")?.isOn ?? false,
    };
  },
  { auth: "owner" },
);
