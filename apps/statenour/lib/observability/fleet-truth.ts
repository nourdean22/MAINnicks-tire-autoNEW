/**
 * Fleet truth (NL-3, 2026-07-28) — ONE cross-app answer to "is
 * everything alive and producing?".
 *
 * Statenour side: the spine-7 capability-artifact checks, extracted
 * here so the worker-fired liveness route and the operator surface read
 * the SAME probes (single source, no drift). Nickstire side: its public
 * /api/health already carries db/criticalSchema/selfHealing verdicts —
 * mapped into the same CapabilityArtifact vocabulary from
 * @nour/utils/contracts.
 *
 * States are honest: fresh / stale / never_produced / unknown — a
 * failed probe or fetch is UNKNOWN, never healthy.
 */
import { prisma } from "@/lib/prisma";
// Type-only relative import (erased at build): the worktree's
// node_modules junction for @nour/utils resolves to the primary
// checkout, so the package specifier can't see a same-PR contracts
// addition until merge. Types-only keeps runtime untouched either way.
import type { CapabilityArtifact, ArtifactState } from "../../../../packages/utils/src/contracts";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("observability/fleet-truth");
const HOUR_MS = 3_600_000;

interface ArtifactProbe {
  capability: string;
  maxAgeH: number;
  probe: () => Promise<Date | null>;
}

/** Spine-7 registry — the artifact IS the loop's own output table. */
export const STATENOUR_ARTIFACT_PROBES: ArtifactProbe[] = [
  {
    capability: "daily-brief",
    maxAgeH: 30,
    probe: async () => {
      const r = await prisma.briefingLog.findFirst({
        where: { briefType: "daily" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return r?.createdAt ?? null;
    },
  },
  {
    capability: "outbox-drain",
    maxAgeH: 30,
    probe: async () => {
      const r = await prisma.cronJobLog.findFirst({
        where: { jobName: "outbox-drain" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return r?.createdAt ?? null;
    },
  },
  {
    capability: "inngest-heartbeat",
    maxAgeH: 26,
    probe: async () => {
      const r = await prisma.cronJobLog.findFirst({
        where: { jobName: "cron-heartbeat", status: "success" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return r?.createdAt ?? null;
    },
  },
];

export async function statenourArtifacts(): Promise<CapabilityArtifact[]> {
  const out: CapabilityArtifact[] = [];
  for (const a of STATENOUR_ARTIFACT_PROBES) {
    try {
      const at = await a.probe();
      if (!at) {
        out.push({ capability: a.capability, state: "never_produced", ageH: null });
      } else {
        const h = (Date.now() - at.getTime()) / HOUR_MS;
        out.push({
          capability: a.capability,
          state: h <= a.maxAgeH ? "fresh" : "stale",
          ageH: Math.round(h * 10) / 10,
        });
      }
    } catch (e) {
      log.warn("artifact_probe_failed", {
        capability: a.capability,
        error: e instanceof Error ? e.message : String(e),
      });
      out.push({ capability: a.capability, state: "unknown", ageH: null });
    }
  }
  return out;
}

/**
 * Map nickstire's public health payload into the shared vocabulary.
 * up → fresh · degraded → stale · anything else / fetch failure →
 * unknown. ageH is null — health is a point-in-time check, not an
 * artifact with an age.
 */
export async function nickstireArtifacts(): Promise<CapabilityArtifact[]> {
  const mapStatus = (s: unknown): ArtifactState =>
    s === "up" || s === "healthy" ? "fresh" : s === "degraded" ? "stale" : "unknown";
  try {
    const res = await fetch("https://nickstire.org/api/health", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return [{ capability: "nickstire:health", state: "unknown", ageH: null }];
    }
    const body = (await res.json()) as {
      status?: string;
      checks?: {
        database?: { status?: string };
        criticalSchema?: { status?: string; missing?: string[] };
      };
      selfHealing?: { state?: string };
    };
    return [
      { capability: "nickstire:health", state: mapStatus(body.status), ageH: null },
      { capability: "nickstire:db", state: mapStatus(body.checks?.database?.status), ageH: null },
      {
        capability: "nickstire:schema-guard",
        state:
          body.checks?.criticalSchema?.status === "up" &&
          (body.checks.criticalSchema.missing ?? []).length === 0
            ? "fresh"
            : body.checks?.criticalSchema
              ? "stale"
              : "unknown",
        ageH: null,
      },
      { capability: "nickstire:self-healing", state: mapStatus(body.selfHealing?.state), ageH: null },
    ];
  } catch (e) {
    log.warn("nickstire_health_unreachable", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [{ capability: "nickstire:health", state: "unknown", ageH: null }];
  }
}

export interface FleetTruth {
  generatedAt: string;
  statenour: CapabilityArtifact[];
  nickstire: CapabilityArtifact[];
  /** true only when every probed capability is fresh — unknown counts as NOT ok. */
  allFresh: boolean;
}

export async function getFleetTruth(): Promise<FleetTruth> {
  const [stn, nick] = await Promise.all([statenourArtifacts(), nickstireArtifacts()]);
  const all = [...stn, ...nick];
  return {
    generatedAt: new Date().toISOString(),
    statenour: stn,
    nickstire: nick,
    allFresh: all.length > 0 && all.every((a) => a.state === "fresh"),
  };
}
