/**
 * lib/trpc/routers/system/devices.ts
 *
 * Per-domain slice of the system router (mechanical split · 2026-05-31).
 * Exports a plain procedure-object that system.ts spreads back into
 * `systemRouter` — the client paths stay FLAT as `trpc.system.<proc>`.
 * Procedures moved VERBATIM · no behavior / input-schema / middleware
 * change. See system.ts for the recomposition.
 */

import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { prisma } from "@/lib/prisma";
import { buildDeviceFleet } from "@/lib/services/system-pages";
import { tailEvents } from "@/lib/db/brain-bus-tail";
import { buildReposOverview } from "@/lib/services/system-pages-b";
import { getEcosystemDigest } from "@/lib/system/repo-briefing";
import { cached } from "@/lib/utils/cache";
interface BrainBusTailView {
  generatedAt: string;
  cursor: string | null;
  windowCounts: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    dead: number;
  };
  events: Array<{
    id: string;
    topic: string;
    eventType: string;
    status: string;
    attempts: number;
    payloadPreview: string | null;
    lastError: string | null;
    createdAt: string;
    processedAt: string | null;
    availableAt: string;
  }>;
}

export const devicesProcedures = {
  /**
   * Phase B.7a · owner-only · the fleet-level device health feed —
   * SmartDevice + DeviceCommand + DeviceEvent composite + agent
   * liveness. Replaces GET /api/system/devices · delegates to the
   * shared `system-pages.buildDeviceFleet` service. DevicesPage polls
   * this on a 30s interval.
   */
  deviceFleet: operatorProcedure.query(async () => buildDeviceFleet()),

  /**
   * Phase B.7a · owner-only · retire every stale SmartDevice (status in
   * the filter set + lastSeenAt older than `olderThanDays`). Replaces
   * POST /api/devices/retire-stale · delegates to the same prisma
   * cleanup the route runs (FK-cascade DeviceCommand + DeviceEvent, then
   * delete the rows). `dryRun` returns the candidate list without
   * deleting — the DevicesPage retire button fires a dryRun first to
   * populate its confirm dialog count, then the real call.
   *
   * The route's `RetireBody` shape ({ olderThanDays?, statuses?,
   * dryRun? }) is mirrored as a strict typed input. Kept inline (small,
   * route-local · YAGNI · no other caller).
   */
  retireStaleDevices: operatorProcedure
    .input(
      z
        .object({
          olderThanDays: z.number().int().min(1).max(365).optional(),
          statuses: z.array(z.string().min(1).max(40)).max(10).optional(),
          dryRun: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const olderThanDays = input?.olderThanDays ?? 7;
      const statuses = input?.statuses ?? ["OFFLINE", "UNKNOWN", "ERROR"];
      const cutoff = new Date(
        Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
      );

      const candidates = await prisma.smartDevice.findMany({
        where: {
          status: { in: statuses },
          OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null }],
        },
        select: {
          id: true,
          name: true,
          platform: true,
          lastSeenAt: true,
          status: true,
        },
      });

      if (input?.dryRun) {
        return {
          ok: true as const,
          dryRun: true as const,
          count: candidates.length,
          candidates,
        };
      }

      if (candidates.length === 0) {
        return { ok: true as const, retired: 0, candidates: [] };
      }

      const ids = candidates.map((c) => c.id);
      await prisma.deviceCommand
        .deleteMany({ where: { deviceId: { in: ids } } })
        .catch(() => ({ count: 0 }));
      await prisma.deviceEvent
        .deleteMany({ where: { deviceId: { in: ids } } })
        .catch(() => ({ count: 0 }));
      const deleted = await prisma.smartDevice.deleteMany({
        where: { id: { in: ids } },
      });

      return {
        ok: true as const,
        retired: deleted.count,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
      };
    }),

  /**
   * Phase B.7a · owner-only · the durable brain-bus event tail · cursor-
   * based incremental fetch + 24h status counts. Replaces GET
   * /api/system/brain-bus-events · delegates to the shared
   * `brain-bus-tail.tailEvents` service the legacy route also calls.
   * The legacy `?sinceId` / `?limit` / `?topic` query params are
   * mirrored as typed inputs. The procedure stringifies the service's
   * `Date` fields (mirroring the route's map) so the public type
   * matches the page's `TailEvent` interface. BrainBusPage polls this
   * on a 3s cursor loop.
   */
  brainBusEvents: operatorProcedure
    .input(
      z
        .object({
          sinceId: z.string().max(128).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          topic: z.string().max(120).optional(),
        })
        .optional(),
    )
    .query(async ({ input }): Promise<BrainBusTailView> => {
      const result = await tailEvents({
        sinceId: input?.sinceId,
        limit: input?.limit,
        topic: input?.topic,
      });
      return {
        generatedAt: new Date().toISOString(),
        cursor: result.cursor,
        windowCounts: result.windowCounts,
        events: result.events.map((e) => ({
          id: e.id,
          topic: e.topic,
          eventType: e.eventType,
          status: e.status,
          attempts: e.attempts,
          payloadPreview: e.payloadPreview,
          lastError: e.lastError,
          createdAt: e.createdAt.toISOString(),
          processedAt: e.processedAt?.toISOString() ?? null,
          availableAt: e.availableAt.toISOString(),
        })),
      };
    }),

  /**
   * Phase B.7b · owner-only · the live REPO-MAP · every repo grouped
   * by ring with health color + last-commit age + deploy target.
   * Replaces GET /api/system/repos · delegates to the shared
   * `system-pages-b.buildReposOverview` service (60s-cached · reads
   * config/repos.ts + augments monitored repos with live GitHub
   * state). No input. ReposPage polls this on a 5-min interval.
   */
  reposOverview: operatorProcedure.query(async () => buildReposOverview()),

  /**
   * Phase B.7b · owner-only · the ecosystem briefing · week/month
   * commit totals + Nick-readable narrative + flag list. Replaces GET
   * /api/system/repo-briefing · delegates to the same
   * `getEcosystemDigest` the legacy route calls, 5-min-cached exactly
   * as the route did. No input. ReposPage fetches this alongside
   * `reposOverview`; a failure here must never blank the dashboard,
   * so the page treats this query's error as non-fatal.
   */
  repoBriefing: operatorProcedure.query(async () =>
    cached("system_repo_briefing", 300, getEcosystemDigest),
  ),

};
