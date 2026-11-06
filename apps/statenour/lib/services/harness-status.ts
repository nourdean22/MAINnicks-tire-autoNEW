/**
 * The harness picture in NOUR OS (job 2026-11-05-harness-apps-connect): open PRs with CI, sessions,
 * what each site runs, RAM and health for the three PCs. Nour: "i also want both apps/websites
 * especially the chat and the admin connnected to the herness".
 *
 * Read-only by construction. Each PC pushes a snapshot (scripts/agent-os/harness-snapshot.mjs) and
 * nothing here can reach a PC: the snapshot door has no command path and no reply field. The separate
 * control channel (lib/services/harness-control.ts, its own key and table) is only READ here: Nick's
 * node row and the last few allowlisted actions, so the card shows what agents asked the PCs to do.
 *
 * Storage is RunnerNode (nodeKey `harness:<pc>`, snapshot in metadata), so no table and no migration.
 * lastHeartbeatAt is stamped by this server, so a PC with a wrong clock cannot read as fresh.
 * The harness rows are not runners: runner-liveness reads filter them with NOT_HARNESS_NODE.
 *
 * A PC that stops pushing goes UNKNOWN and its numbers are dropped: a pushed value does not expire
 * on its own (the Prometheus Pushgateway page warns of exactly this), so the reader must age it.
 */
import { z } from "zod";
import type { HarnessActionView } from "@/lib/services/harness-control";

export const HARNESS_PCS = [
  { key: "nattynour", label: "NattyNour" },
  { key: "mechanics", label: "MECHANICS" },
  { key: "nicksmax", label: "NicksMax" },
] as const;
export type HarnessPcKey = (typeof HARNESS_PCS)[number]["key"];

/** Three missed 5-minute ticks. */
export const HARNESS_STALE_MS = 15 * 60_000;

const NODE_PREFIX = "harness:";
/** Harness rows are PCs reporting state, not runners: every runner-liveness read must exclude them. */
export const NOT_HARNESS_NODE = { nodeKey: { not: { startsWith: NODE_PREFIX } } };
export const harnessNodeKey = (pc: HarnessPcKey) => `${NODE_PREFIX}${pc}`;
export const harnessPcLabel = (pc: HarnessPcKey) => HARNESS_PCS.find((p) => p.key === pc)!.label;

/** Nick, the agent on bdnick, as a harness node: stamped by the 15-minute device sentinel tick. */
export const NICK_NODE_KEY = `${NODE_PREFIX}nick`;
/** Three missed 15-minute ticks. */
export const NICK_STALE_MS = 45 * 60_000;
export type HarnessAgentView = {
  key: "nick";
  label: "Nick";
  state: "reporting" | "unknown";
  lastSeenAt: string | null;
  reason: string | null;
  /** The deploy commit Nick runs. */
  version: string | null;
  /** Whether bdnick holds a usable HARNESS_CONTROL_KEY, so PCs can claim what Nick queues. Null = not reported. */
  controlKeyReady: boolean | null;
};

/** The repo is public and the PCs are named by role only: no paths, no addresses, whatever the field. */
const LOCAL_DETAIL = /[A-Za-z]:[\\/]|\\Users\\|\/(?:home|Users)\/|\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const safeText = (max: number) =>
  z.string().max(max).refine((v) => !LOCAL_DETAIL.test(v), "no paths or addresses in a harness snapshot");
const count = z.number().int().min(0).nullable();
const sha = z.string().regex(/^[0-9a-f]{7,40}$/).nullable();
const slot = z.enum(["free", "busy"]).nullable();

export const harnessSnapshotSchema = z
  .object({
    pc: z.enum(["nattynour", "mechanics", "nicksmax"]),
    sha,
    ramFreeMb: count,
    heavy: slot,
    chrome: slot,
    sessionsActive: count,
    worktrees: count,
    health: z.object({ ok: z.boolean(), problems: z.array(safeText(60)).max(12) }).strict().nullable(),
    prs: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            title: safeText(200),
            branch: safeText(120),
            checks: z.enum(["SUCCESS", "FAILURE", "PENDING", "NONE"]),
          })
          .strict(),
      )
      .max(60)
      .nullable(),
    merged: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            title: safeText(200),
            mergedAt: z.string().max(40),
            sha,
          })
          .strict(),
      )
      .max(15)
      .nullable(),
    mainSha: sha,
    graph: z.object({ serverUp: z.boolean().nullable(), builtCommit: sha, behind: count }).strict().nullable(),
    vaultGraph: z.object({ exists: z.boolean(), builtAt: z.string().max(40).nullable() }).strict().nullable(),
    sites: z.object({ bdnick: sha, nickstire: sha }).strict(),
    // What this PC could not read, and why: a missing source is null plus a reason here, never a zero.
    unread: z.record(z.string().max(30), safeText(200)).refine((u) => Object.keys(u).length <= 20, "too many unread sources"),
  })
  .strict();
export type HarnessSnapshot = z.infer<typeof harnessSnapshotSchema>;

export type HarnessRow = { nodeKey: string; lastHeartbeatAt: Date | null; metadata: unknown; version?: string | null };

export type HarnessPcView = {
  key: HarnessPcKey;
  label: string;
  state: "reporting" | "unknown";
  lastSeenAt: string | null;
  reason: string | null;
  sha: string | null;
  ramFreeMb: number | null;
  heavy: "free" | "busy" | null;
  chrome: "free" | "busy" | null;
  sessionsActive: number | null;
  worktrees: number | null;
  health: { ok: boolean; problems: string[] } | null;
  unread: Record<string, string>;
};

/** The vault facts bdnick holds itself. Status and counts only: never note text, names or paths. */
export type HarnessVaultDb = {
  lastExportAt: string | null;
  exportedCount: number | null;
  liveCount: number | null;
  unread: Record<string, string>;
};
const VAULT_UNREAD: HarnessVaultDb = { lastExportAt: null, exportedCount: null, liveCount: null, unread: {} };

type Sourced<T> = { items: T; from: string; asOf: string };
export type HarnessStatus = {
  generatedAt: string;
  reporting: number;
  pcs: HarnessPcView[];
  prs: Sourced<NonNullable<HarnessSnapshot["prs"]>> | null;
  prsReason: string | null;
  merged: Sourced<NonNullable<HarnessSnapshot["merged"]>> | null;
  mainSha: string | null;
  graph: (NonNullable<HarnessSnapshot["graph"]> & { from: string; asOf: string }) | null;
  graphReason: string | null;
  vault: HarnessVaultDb & { graph: HarnessSnapshot["vaultGraph"] };
  sites: Record<"bdnick" | "nickstire", { commit: string; asOf: string } | null>;
  nick: HarnessAgentView;
  /** The newest allowlisted actions, newest first. Null when they could not be read; see actionsReason. */
  actions: HarnessActionView[] | null;
  actionsReason: string | null;
};

export type HarnessActionsRead = { items: HarnessActionView[] } | { items: null; reason: string };
const ACTIONS_UNREAD: HarnessActionsRead = { items: null, reason: "The action list was not read" };

/** Pure: Nick's node row aged by the server clock, like a PC's. */
export function nickViewFromRow(row: HarnessRow | undefined, now: Date): HarnessAgentView {
  const base = { key: "nick" as const, label: "Nick" as const, version: row?.version ?? null, controlKeyReady: null };
  const seenAt = row?.lastHeartbeatAt ?? null;
  if (!seenAt) return { ...base, state: "unknown", lastSeenAt: null, reason: "Never reported" };
  const ageMs = now.getTime() - seenAt.getTime();
  const agent = (row?.metadata as { harnessAgent?: { controlKeyReady?: unknown } } | null)?.harnessAgent;
  const controlKeyReady = typeof agent?.controlKeyReady === "boolean" ? agent.controlKeyReady : null;
  if (ageMs > NICK_STALE_MS) {
    return { ...base, controlKeyReady, state: "unknown", lastSeenAt: seenAt.toISOString(), reason: `Silent ${Math.floor(ageMs / 60_000)} min` };
  }
  return { ...base, controlKeyReady, state: "reporting", lastSeenAt: seenAt.toISOString(), reason: null };
}

const unknownPc = (key: HarnessPcKey, lastSeenAt: string | null, reason: string): HarnessPcView => ({
  key,
  label: harnessPcLabel(key),
  state: "unknown",
  lastSeenAt,
  reason,
  sha: null,
  ramFreeMb: null,
  heavy: null,
  chrome: null,
  sessionsActive: null,
  worktrees: null,
  health: null,
  unread: {},
});

/** Pure, so the stale and failed-read rules are pinned without a database. */
export function harnessStatusFromRows(
  rows: HarnessRow[],
  now: Date = new Date(),
  vaultDb: HarnessVaultDb = VAULT_UNREAD,
  actions: HarnessActionsRead = ACTIONS_UNREAD,
): HarnessStatus {
  const fresh: Array<{ label: string; seenAt: Date; snapshot: HarnessSnapshot }> = [];

  const pcs = HARNESS_PCS.map(({ key, label }): HarnessPcView => {
    const row = rows.find((r) => r.nodeKey === harnessNodeKey(key));
    const seenAt = row?.lastHeartbeatAt ?? null;
    if (!seenAt) return unknownPc(key, null, "Never reported");
    const lastSeenAt = seenAt.toISOString();
    const ageMs = now.getTime() - seenAt.getTime();
    if (ageMs > HARNESS_STALE_MS) return unknownPc(key, lastSeenAt, `Silent ${Math.floor(ageMs / 60_000)} min`);
    const parsed = harnessSnapshotSchema.safeParse((row?.metadata as { harnessSnapshot?: unknown } | null)?.harnessSnapshot);
    if (!parsed.success) return unknownPc(key, lastSeenAt, "Its last snapshot could not be read");
    const s = parsed.data;
    fresh.push({ label, seenAt, snapshot: s });
    return {
      key,
      label,
      state: "reporting",
      lastSeenAt,
      reason: null,
      sha: s.sha,
      ramFreeMb: s.ramFreeMb,
      heavy: s.heavy,
      chrome: s.chrome,
      sessionsActive: s.sessionsActive,
      worktrees: s.worktrees,
      health: s.health,
      unread: s.unread,
    };
  });

  fresh.sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime());
  const prsFrom = fresh.find((f) => f.snapshot.prs !== null);
  const mergedFrom = fresh.find((f) => f.snapshot.merged !== null);
  const graphFrom = fresh.find((f) => f.snapshot.graph !== null);
  const site = (name: "bdnick" | "nickstire") => {
    const from = fresh.find((f) => f.snapshot.sites[name] !== null);
    return from ? { commit: from.snapshot.sites[name]!, asOf: from.seenAt.toISOString() } : null;
  };

  return {
    generatedAt: now.toISOString(),
    reporting: fresh.length,
    pcs,
    prs: prsFrom ? { items: prsFrom.snapshot.prs!, from: prsFrom.label, asOf: prsFrom.seenAt.toISOString() } : null,
    prsReason: prsFrom ? null : "No reporting PC could read GitHub",
    merged: mergedFrom
      ? { items: mergedFrom.snapshot.merged!, from: mergedFrom.label, asOf: mergedFrom.seenAt.toISOString() }
      : null,
    mainSha: fresh.find((f) => f.snapshot.mainSha !== null)?.snapshot.mainSha ?? null,
    graph: graphFrom ? { ...graphFrom.snapshot.graph!, from: graphFrom.label, asOf: graphFrom.seenAt.toISOString() } : null,
    graphReason: graphFrom ? null : "No reporting PC has the code graph",
    vault: { ...vaultDb, graph: fresh.find((f) => f.snapshot.vaultGraph !== null)?.snapshot.vaultGraph ?? null },
    sites: { bdnick: site("bdnick"), nickstire: site("nickstire") },
    nick: nickViewFromRow(rows.find((r) => r.nodeKey === NICK_NODE_KEY), now),
    actions: actions.items,
    actionsReason: actions.items ? null : actions.reason,
  };
}

/** Throws on a failed read: the caller renders "could not load", never three blank PCs. */
export async function readHarnessStatus(): Promise<HarnessStatus> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.runnerNode.findMany({
    where: { nodeKey: { in: [...HARNESS_PCS.map((p) => harnessNodeKey(p.key)), NICK_NODE_KEY] } },
    select: { nodeKey: true, lastHeartbeatAt: true, metadata: true, version: true },
  });
  return harnessStatusFromRows(rows, new Date(), await readVaultDb(), await readActions());
}

/** Its own failure, its own reason: a missing table or a failed read never costs the PC rows. */
async function readActions(): Promise<HarnessActionsRead> {
  try {
    const { listRecentHarnessActions } = await import("@/lib/services/harness-control");
    return { items: await listRecentHarnessActions(8) };
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    return { items: null, reason: status === 503 ? "Harness control is not migrated yet" : "The action list could not be read" };
  }
}

/** Each read stands alone: one failing leaves that field unknown and the rest of the card intact. */
async function readVaultDb(): Promise<HarnessVaultDb> {
  const { prisma } = await import("@/lib/prisma");
  const out: HarnessVaultDb = { ...VAULT_UNREAD, unread: {} };
  try {
    const log = await prisma.localSyncLog.findFirst({
      where: { module: "obsidian_engine", action: "status" },
      select: { details: true },
    });
    const status = log?.details ? (JSON.parse(log.details) as { lastExportRunAt?: unknown; lastExportCount?: unknown }) : null;
    if (typeof status?.lastExportRunAt === "string") out.lastExportAt = status.lastExportRunAt;
    else out.unread.lastExportAt = "No export has been recorded";
    if (typeof status?.lastExportCount === "number") out.exportedCount = status.lastExportCount;
    else out.unread.exportedCount = "The export does not record a count yet";
  } catch {
    out.unread.lastExportAt = "The export status could not be read";
    out.unread.exportedCount = "The export status could not be read";
  }
  try {
    // Close to the export's population: it skips deleted rows and keeps superseded ones. It also skips a few categories, so the two will not match exactly.
    out.liveCount = await prisma.brainMemory.count({ where: { deletedAt: null } });
  } catch {
    out.unread.liveCount = "The memory count could not be read";
  }
  return out;
}
