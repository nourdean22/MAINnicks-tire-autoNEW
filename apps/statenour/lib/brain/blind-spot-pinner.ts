/**
 * Blind-spot auto-surfacing · v8.2 · F5 · Apr 29.
 *
 * Wraps `detectBlindSpots()` with a small policy layer that
 * automatically promotes critical / high-severity findings into
 * the `pinned_user` BrainMemory category so they appear at the
 * TOP of every system prompt + on the HQ pinned-context panel.
 *
 * Behavior:
 *   · Run detector → filter to {severity: critical | high}
 *   · For each finding, upsert a pinned_user row keyed by
 *     `auto_blindspot__<domain>` with confidence=1.0 and
 *     metadata.{source,severity,detectedAt,daysSinceAttention,frame}
 *   · When a previously-pinned domain drops off the high/critical
 *     list, soft-delete the pin (lib/db/soft-delete) so it leaves
 *     the hot context but remains restorable from /brain/pinned.
 *
 * Idempotency: the upsert is keyed by (category, key) which is
 * already the schema's existing unique. Running twice in a row
 * with the same input is a true no-op (no new audit row, no
 * embedding re-store).
 */

import { prisma } from "@/lib/prisma";
import { detectBlindSpots, type BlindSpot } from "@/lib/brain/blind-spot-detector";
import { storeMemoryEmbedding } from "@/lib/brain/embedding-utils";
import { softDelete } from "@/lib/db/soft-delete";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";

const PINNED_CATEGORY = "pinned_user";
const AUTO_PIN_PREFIX = "auto_blindspot__";

export interface BlindSpotPinReport {
  ranAt: string;
  spotsFound: number;
  pinsCreated: number;
  pinsRefreshed: number;
  pinsRemoved: number;
  domainsPinned: string[];
}

function autoKey(domain: string): string {
  return `${AUTO_PIN_PREFIX}${domain.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function summarize(spot: BlindSpot): string {
  const sev = spot.severity.toUpperCase();
  const frame = spot.frame ? ` · ${spot.frame}` : "";
  return `[${sev}${frame}] ${spot.domain}: ${spot.description}. Action: ${spot.suggestedAction}`;
}

export async function runBlindSpotPinner(): Promise<BlindSpotPinReport> {
  const ranAt = new Date().toISOString();
  const spots = await detectBlindSpots();
  const high = spots.filter(
    (s) => s.severity === "critical" || s.severity === "high",
  );

  let pinsCreated = 0;
  let pinsRefreshed = 0;

  for (const spot of high) {
    const key = autoKey(spot.domain);
    const existing = await prisma.brainMemory.findUnique({
      where: { category_key: { category: PINNED_CATEGORY, key } },
    });

    const content = summarize(spot);
    const metadata = {
      source: "auto_pin:blindspot",
      severity: spot.severity,
      domain: spot.domain,
      frame: spot.frame ?? null,
      daysSinceAttention: spot.daysSinceAttention,
      detectedAt: ranAt,
    };

    if (existing) {
      // Refresh: bump confidence + content + seenCount + restore if soft-deleted
      const updated = await prisma.brainMemory.update({
        where: { id: existing.id },
        data: {
          content,
          confidence: 1.0,
          seenCount: existing.seenCount + 1,
          deletedAt: null,
          metadata: metadata as unknown as Parameters<typeof prisma.brainMemory.update>[0]["data"]["metadata"],
        },
      });
      pinsRefreshed++;
      void logUpdate(
        "brainMemory",
        updated.id,
        stripNoise(existing as unknown as Record<string, unknown>),
        stripNoise(updated as unknown as Record<string, unknown>),
        { source: "cron:blindspot-pinner", reason: `${spot.severity} blind spot in ${spot.domain}` },
      );
    } else {
      const created = await prisma.brainMemory.create({
        data: {
          category: PINNED_CATEGORY,
          key,
          content,
          confidence: 1.0,
          expiresAt: null,
          source: "auto_pin:blindspot",
          metadata: metadata as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
        },
      });
      pinsCreated++;
      void logCreate("brainMemory", created.id, created as unknown as Record<string, unknown>, {
        source: "cron:blindspot-pinner",
        reason: `${spot.severity} blind spot in ${spot.domain}`,
      });
      // Embedding for semantic recall — fire-and-forget.
      storeMemoryEmbedding(
        created.id,
        `[blind_spot_pin:${spot.domain}] ${content}`,
      ).catch(() => {});
    }
  }

  // Sweep: soft-delete auto-pins for domains that dropped off the
  // high/critical list. They stay restorable via /brain/pinned.
  const currentDomains = new Set(high.map((s) => s.domain));
  const stalePins = await prisma.brainMemory.findMany({
    where: {
      category: PINNED_CATEGORY,
      key: { startsWith: AUTO_PIN_PREFIX },
      deletedAt: null,
    },
    select: { id: true, key: true, metadata: true },
  });

  let pinsRemoved = 0;
  for (const pin of stalePins) {
    const meta = (pin.metadata ?? {}) as { domain?: string };
    const domain = meta.domain ?? pin.key.slice(AUTO_PIN_PREFIX.length);
    if (!currentDomains.has(domain)) {
      const result = await softDelete("brainMemory", { id: pin.id });
      if (result.ok && !result.noop) pinsRemoved++;
    }
  }

  return {
    ranAt,
    spotsFound: spots.length,
    pinsCreated,
    pinsRefreshed,
    pinsRemoved,
    domainsPinned: high.map((s) => s.domain),
  };
}
