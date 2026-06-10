import { apiHandler } from "@/lib/utils/http";
import {
  fireMorningPush,
  fireAfternoonPush,
  fireEveningPush,
  fireSlotForCurrentHour,
} from "@/lib/brain/proactive-pushes";
import { NextResponse } from "next/server";

export const GET = apiHandler(
  async (req: Request) => {
    const url = new URL(req.url);
    const slot = url.searchParams.get("slot") || "all";
    const nowParam = url.searchParams.get("now");

    const now = nowParam ? new Date(nowParam) : new Date();
    if (nowParam && isNaN(now.getTime())) {
      return NextResponse.json({ error: "Invalid 'now' timestamp format" }, { status: 400 });
    }

    const previews: any[] = [];
    const dryRun = true;

    try {
      if (slot === "auto") {
        const preview = await fireSlotForCurrentHour({ dryRun, now });
        previews.push(preview);
      } else if (slot === "morning") {
        const preview = await fireMorningPush({ dryRun, now });
        previews.push(preview);
      } else if (slot === "afternoon") {
        const preview = await fireAfternoonPush({ dryRun, now });
        previews.push(preview);
      } else if (slot === "evening") {
        const preview = await fireEveningPush({ dryRun, now });
        previews.push(preview);
      } else if (slot === "all") {
        const morning = await fireMorningPush({ dryRun, now });
        const afternoon = await fireAfternoonPush({ dryRun, now });
        const evening = await fireEveningPush({ dryRun, now });
        previews.push(morning, afternoon, evening);
      } else {
        return NextResponse.json({ error: "Invalid slot parameter" }, { status: 400 });
      }

      return {
        dryRun: true,
        generatedAt: now.toISOString(),
        previews,
        warning: "Dry run only. No Telegram messages were sent and no BrainMemory markers were written.",
        noSendGuarantee: true,
      };
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Internal error during preview generation" },
        { status: 500 }
      );
    }
  },
  { auth: "owner" }
);
