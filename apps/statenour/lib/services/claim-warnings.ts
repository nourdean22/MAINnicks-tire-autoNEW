/**
 * Claim-warnings service · Phase MM (2026-05-18 PM).
 *
 * Single source of truth for the action-claim warning read path. Called
 * by BOTH the legacy REST handler (`/api/ai/chat/claim-warnings`) AND
 * the new `trpc.chat.claimWarnings` procedure. Drift between consumers
 * structurally impossible.
 *
 * Why this exists · the chat ActionClaimWarning chip needs to know
 * whether the last assistant turn fabricated a side effect (claimed
 * "added the tasks" but no tool fired). The detector writes a
 * BrainMemory row with category="chat_claim_warn" + metadata blob ·
 * this service reads + filters by conversationId.
 *
 * Note · we pull a small over-sample (50 rows) then JS-filter by
 * metadata.conversationId because that field isn't indexed. At
 * the typical write volume (<5/day · only fabricated claims write)
 * this is cheap. If volume grows we can add an index on the
 * conversationId-extracted column.
 */

import { prisma } from "@/lib/prisma";

export interface ClaimWarning {
  id: string;
  traceId: string | null;
  createdAt: string;
  claims: Array<{ verb: string; snippet: string; expectedTool: string }>;
  toolsActuallyFired: string[];
  textPreview: string;
}

interface LegacyClaimOffender {
  toolName: string;
  status?: string;
  label?: string;
  errorSafeMessage?: string;
}

interface ClaimWarningMetadata {
  conversationId?: string;
  traceId?: string;
  claims?: Array<{ verb: string; snippet: string; expectedTool: string }>;
  offenders?: LegacyClaimOffender[];
  toolsActuallyFired?: string[];
  textPreview?: string;
}

function normalizeClaims(md: ClaimWarningMetadata): Array<{ verb: string; snippet: string; expectedTool: string }> {
  if (md.claims?.length) return md.claims;

  return (md.offenders ?? []).map((o) => ({
    verb: o.label ?? o.toolName,
    snippet: o.errorSafeMessage ?? "",
    expectedTool: o.toolName,
  }));
}

export async function readClaimWarnings(args: {
  conversationId: string;
  limit?: number;
}): Promise<{ warnings: ClaimWarning[] }> {
  const limit = Math.max(1, Math.min(args.limit ?? 1, 10));

  const rows = await prisma.brainMemory.findMany({
    where: { category: "chat_claim_warn", deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50, // over-sample · filter conversationId in JS (not indexed)
  });

  const matches: ClaimWarning[] = [];
  for (const r of rows) {
    const md = r.metadata as ClaimWarningMetadata | null;
    if (md?.conversationId !== args.conversationId) continue;
    matches.push({
      id: r.id,
      traceId: md?.traceId ?? null,
      createdAt: r.createdAt.toISOString(),
      claims: md ? normalizeClaims(md) : [],
      toolsActuallyFired: md?.toolsActuallyFired ?? [],
      textPreview: md?.textPreview ?? "",
    });
    if (matches.length >= limit) break;
  }

  return { warnings: matches };
}
