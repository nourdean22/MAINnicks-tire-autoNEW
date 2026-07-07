/**
 * POST /api/outreach/propose · Wave-200 outreach segmentation
 * (2026-05-17 follow-up)
 *
 * Owner-only · accepts a campaign proposal · emits the
 * `bulk-sms/proposed` Inngest event so the operator-approval gate
 * fires (Telegram preview → /approve or /reject reply → dispatch).
 *
 * Body shape (zod-light validation):
 *   {
 *     campaignId: string,        // unique label, e.g. "winback-high-ltv-2026-05-17"
 *     targetSegment: string,     // human-readable, e.g. "high-LTV slow payers"
 *     recipientCount: number,    // matched count at compose time
 *     bodyPreview: string,       // first ~120 chars of the message
 *     reason?: string,           // operator-noted intent
 *   }
 *
 * Returns the campaignId echo so the client can show the operator
 * "watch Telegram for the approval request".
 *
 * Why owner-only · this endpoint emits a high-impact event. If a
 * caller could spoof it, anyone could propose a campaign that the
 * operator might accidentally approve. Auth gates the proposer; the
 * Telegram approval gates the actual send.
 *
 * See: src/inngest/functions/bulk-sms-approval.ts
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { recordError } from "@/lib/errors/record-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

interface ProposalBody {
  campaignId: string;
  targetSegment: string;
  recipientCount: number;
  bodyPreview: string;
  reason?: string;
}

function validate(input: unknown): ProposalBody | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.campaignId !== "string" || r.campaignId.trim().length === 0)
    return null;
  if (typeof r.targetSegment !== "string" || r.targetSegment.trim().length === 0)
    return null;
  if (typeof r.recipientCount !== "number" || r.recipientCount < 1) return null;
  if (typeof r.bodyPreview !== "string" || r.bodyPreview.trim().length === 0)
    return null;
  return {
    campaignId: r.campaignId.trim().slice(0, 80),
    targetSegment: r.targetSegment.trim().slice(0, 120),
    recipientCount: Math.floor(r.recipientCount),
    bodyPreview: r.bodyPreview.trim().slice(0, 240),
    reason: typeof r.reason === "string" ? r.reason.trim().slice(0, 240) : undefined,
  };
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    const raw = await req.json();
    const proposal = validate(raw);
    if (!proposal) {
      return NextResponse.json(
        {
          error: "invalid_body",
          hint: "expected { campaignId, targetSegment, recipientCount, bodyPreview, reason? }",
        },
        { status: 400 },
      );
    }

    const { getInngest, isInngestFullyConfigured } = await import(
      "@/lib/inngest/client"
    );

    if (!isInngestFullyConfigured()) {
      return NextResponse.json(
        {
          error: "inngest_not_configured",
          hint: "Inngest keys missing · operator action item per docs/operator/inngest-setup.md",
        },
        { status: 503 },
      );
    }

    const inngest = getInngest();
    await inngest.send({
      name: "bulk-sms/proposed",
      data: {
        campaignId: proposal.campaignId,
        targetSegment: proposal.targetSegment,
        recipientCount: proposal.recipientCount,
        bodyPreview: proposal.bodyPreview,
        audit: { proposedBy: "operator", reason: proposal.reason },
      },
    });

    return NextResponse.json({
      ok: true,
      campaignId: proposal.campaignId,
      hint: "Watch Telegram for the approval request · reply /approve or /reject within 30 minutes",
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    recordError("api:unknown", err, { surface: "outreach/propose" });
    return NextResponse.json(
      {
        error: "propose_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
