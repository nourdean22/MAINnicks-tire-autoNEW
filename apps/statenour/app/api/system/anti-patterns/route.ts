import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { softDelete } from "@/lib/db/soft-delete";

/**
 * Anti-pattern library (W12.4).
 *
 * Explicit log of "I tried X, it failed, reason Y." Surfaced when
 * current intent matches a past failure so Nour (and Nick via tool
 * call) avoid re-treading.
 *
 * Storage: BrainMemory(category="anti_pattern"). Each row is a
 * cohesive entry:
 *   key      = short tag (e.g. "sms-at-9am", "pricing-by-feel")
 *   content  = human-readable lesson text
 *   metadata = { attempt, outcome, domain, severity, firstTriedAt,
 *                lastRevisitedAt, tags }
 *
 * Endpoints:
 *   GET  /api/system/anti-patterns              → list all
 *   POST /api/system/anti-patterns              → create/update entry
 *   POST /api/system/anti-patterns/revisit      → mark revisited
 *   DELETE /api/system/anti-patterns?key=...    → soft-remove
 *
 * Used by:
 *   · /system/anti-patterns UI
 *   · A future Nick tool `checkAntiPattern(intent)` that greps the
 *     library for matching tags and warns before acting.
 */

export type Severity = "info" | "warn" | "critical";
export type Domain = "business" | "personal" | "tech" | "health" | "relationships" | "other";

const CreateSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  attempt: z.string().min(3).max(400),
  outcome: z.string().min(3).max(400),
  lesson: z.string().min(3).max(600),
  severity: z.enum(["info", "warn", "critical"]).default("warn"),
  domain: z.enum(["business", "personal", "tech", "health", "relationships", "other"]).default("other"),
  tags: z.array(z.string().max(40)).default([]),
});
interface AntiPatternMeta {
  attempt: string;
  outcome: string;
  severity: Severity;
  domain: Domain;
  firstTriedAt: string;
  lastRevisitedAt: string | null;
  revisitCount: number;
  tags: string[];
}

export const GET = apiHandler(async () => {
  // v8.27 · soft-delete retrofit · don't resurface deleted patterns.
  const rows = await prisma.brainMemory.findMany({
    where: { category: "anti_pattern", deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  const byDomain: Record<Domain, number> = {
    business: 0, personal: 0, tech: 0, health: 0, relationships: 0, other: 0,
  };
  const bySeverity: Record<Severity, number> = { info: 0, warn: 0, critical: 0 };

  const items = rows.map((r) => {
    const meta = (r.metadata as unknown as AntiPatternMeta) ?? null;
    if (meta) {
      if (meta.domain && byDomain[meta.domain] !== undefined) byDomain[meta.domain]++;
      if (meta.severity && bySeverity[meta.severity] !== undefined) bySeverity[meta.severity]++;
    }
    return {
      key: r.key,
      lesson: r.content,
      attempt: meta?.attempt ?? "",
      outcome: meta?.outcome ?? "",
      severity: meta?.severity ?? "warn",
      domain: meta?.domain ?? "other",
      firstTriedAt: meta?.firstTriedAt ?? r.createdAt.toISOString(),
      lastRevisitedAt: meta?.lastRevisitedAt ?? null,
      revisitCount: meta?.revisitCount ?? 0,
      tags: meta?.tags ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  return {
    items,
    summary: {
      total: items.length,
      byDomain,
      bySeverity,
      oldestAt: items.length > 0 ? items[items.length - 1].firstTriedAt : null,
    },
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts
export const POST = apiHandler(async (req) => {
  const body = CreateSchema.parse(await req.json());
  const now = new Date().toISOString();
  const meta: AntiPatternMeta = {
    attempt: body.attempt,
    outcome: body.outcome,
    severity: body.severity,
    domain: body.domain,
    firstTriedAt: now,
    lastRevisitedAt: null,
    revisitCount: 0,
    tags: body.tags,
  };
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "anti_pattern", key: body.key } },
  });
  if (existing) {
    // Merge — keep original firstTriedAt + revisit history, update lesson text + severity.
    const existingMeta = (existing.metadata as unknown as AntiPatternMeta | null) ?? meta;
    const merged: AntiPatternMeta = {
      ...existingMeta,
      severity: body.severity,
      domain: body.domain,
      tags: body.tags,
      attempt: body.attempt,
      outcome: body.outcome,
    };
    const updated = await prisma.brainMemory.update({
      where: { category_key: { category: "anti_pattern", key: body.key } },
      data: {
        content: body.lesson,
        metadata: merged as unknown as object,
        confidence: 1,
      },
    });
    return { item: { key: updated.key, lesson: updated.content, ...(merged as object) }, action: "updated" };
  }
  const created = await prisma.brainMemory.create({
    data: {
      category: "anti_pattern",
      key: body.key,
      content: body.lesson,
      metadata: meta as unknown as object,
      confidence: 1,
      source: "anti_pattern_library",
    },
  });
  return { item: { key: created.key, lesson: created.content, ...(meta as object) }, action: "created" };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts
export const DELETE = apiHandler(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) {
    throw Object.assign(new Error("key required"), { status: 400, code: "KEY_REQUIRED" });
  }
  // v7.9: soft-delete — anti-patterns are sometimes deleted by mistake
  // (Nour clicked the wrong row in the admin); soft-delete keeps them
  // recoverable from the trash view and preserves their occurrence
  // history for the brain pattern miner.
  const result = await softDelete("brainMemory", {
    category_key: { category: "anti_pattern", key },
  });
  return { key, deleted: result.ok, soft: true, noop: result.noop };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts