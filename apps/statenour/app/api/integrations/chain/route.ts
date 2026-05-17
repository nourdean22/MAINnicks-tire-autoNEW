import { NextRequest, NextResponse } from "next/server";
import {
  newLeadChain,
  reviewResponseChain,
  competitorInsightChain,
  dailyBriefChain,
} from "@/lib/integrations/chain";
import type {
  NewLeadChainInput,
  ReviewResponseChainInput,
  CompetitorInsightChainInput,
  DailyBriefChainInput,
} from "@/lib/integrations/chain";
import { logArsenalActivity } from "@/lib/integrations/arsenal-log";

import { requireSession } from "@/lib/auth-guard";
const CHAINS: Record<string, (input: never) => Promise<unknown>> = {
  newLead: newLeadChain as (input: never) => Promise<unknown>,
  reviewResponse: reviewResponseChain as (input: never) => Promise<unknown>,
  competitorInsight: competitorInsightChain as (input: never) => Promise<unknown>,
  dailyBrief: dailyBriefChain as (input: never) => Promise<unknown>,
};

function validateChainInput(
  chain: string,
  input: Record<string, unknown>
): string | null {
  switch (chain) {
    case "newLead": {
      const i = input as unknown as NewLeadChainInput;
      if (!i.clickupListId) return "clickupListId is required";
      break;
    }
    case "reviewResponse": {
      const i = input as unknown as ReviewResponseChainInput;
      if (!i.reviewerName) return "reviewerName is required";
      if (i.rating == null) return "rating is required";
      if (!i.reviewText) return "reviewText is required";
      if (!i.platform) return "platform is required";
      if (!i.clickupListId) return "clickupListId is required";
      break;
    }
    case "competitorInsight": {
      const i = input as unknown as CompetitorInsightChainInput;
      if (!i.competitorName) return "competitorName is required";
      if (!i.clickupListId) return "clickupListId is required";
      break;
    }
    case "dailyBrief": {
      const i = input as unknown as DailyBriefChainInput;
      if (!i.todaySummary) return "todaySummary is required";
      if (!i.clickupListId) return "clickupListId is required";
      break;
    }
    default:
      return `Unknown chain: ${chain}. Available: ${Object.keys(CHAINS).join(", ")}`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const body = await req.json();
    const { chain, input } = body as { chain?: string; input?: Record<string, unknown> };

    if (!chain) {
      return NextResponse.json(
        { error: "Missing 'chain' field", available: Object.keys(CHAINS) },
        { status: 400 }
      );
    }

    if (!input || typeof input !== "object") {
      return NextResponse.json(
        { error: "Missing or invalid 'input' object" },
        { status: 400 }
      );
    }

    const validationError = validateChainInput(chain, input);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const handler = CHAINS[chain];
    if (!handler) {
      return NextResponse.json(
        { error: `Unknown chain: ${chain}`, available: Object.keys(CHAINS) },
        { status: 400 }
      );
    }

    const start = Date.now();
    const result = await handler(input as never);
    const chainResult = result as { status?: string; steps?: unknown[] };

    logArsenalActivity({
      toolId: "chain",
      action: `chain:${chain}`,
      status: chainResult.status === "complete" ? "success" : chainResult.status === "partial" ? "partial" : "error",
      durationMs: Date.now() - start,
      inputPreview: JSON.stringify(input).slice(0, 300),
      resultPreview: JSON.stringify(result).slice(0, 1000),
      metadata: { chain, stepCount: chainResult.steps?.length ?? 0 },
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// public: this GET returns only static usage docs (chain names +
// example payloads). No operator data exposed. v10.0.183 audit
// confirmed.
export async function GET() {
  return NextResponse.json({
    chains: Object.keys(CHAINS),
    usage: {
      method: "POST",
      body: {
        chain: "newLead | reviewResponse | competitorInsight | dailyBrief",
        input: "chain-specific input object",
      },
      examples: {
        newLead: { chain: "newLead", input: { clickupListId: "list_123" } },
        reviewResponse: {
          chain: "reviewResponse",
          input: {
            reviewerName: "John D.",
            rating: 5,
            reviewText: "Great service!",
            platform: "Google",
            clickupListId: "list_123",
          },
        },
        competitorInsight: {
          chain: "competitorInsight",
          input: { competitorName: "Midas", clickupListId: "list_123" },
        },
        dailyBrief: {
          chain: "dailyBrief",
          input: {
            todaySummary: "12 cars serviced, 2 fleet accounts contacted...",
            clickupListId: "list_123",
          },
        },
      },
    },
  });
}
