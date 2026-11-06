/**
 * The harness picture for the admin card, read from bdnick (job 2026-11-05-harness-apps-connect).
 * bdnick holds the PCs' snapshots and ages them (apps/statenour/lib/services/harness-status.ts); this
 * only asks, over the existing bridge query and key. Read-only: it sends no command anywhere.
 * Every failure throws, so the card says "could not be read" rather than drawing an empty picture.
 */
type PcSlot = "free" | "busy" | null;

export interface HarnessPcView {
  key: string;
  label: string;
  state: "reporting" | "unknown";
  lastSeenAt: string | null;
  reason: string | null;
  sha: string | null;
  ramFreeMb: number | null;
  heavy: PcSlot;
  chrome: PcSlot;
  sessionsActive: number | null;
  worktrees: number | null;
  health: { ok: boolean; problems: string[] } | null;
  unread: Record<string, string>;
}

export interface HarnessStatus {
  generatedAt: string;
  reporting: number;
  pcs: HarnessPcView[];
  prs: {
    items: Array<{ number: number; title: string; branch: string; checks: "SUCCESS" | "FAILURE" | "PENDING" | "NONE" }>;
    from: string;
    asOf: string;
  } | null;
  prsReason: string | null;
  mainSha: string | null;
  graph: { serverUp: boolean | null; builtCommit: string | null; behind: number | null; from: string; asOf: string } | null;
  graphReason: string | null;
  vault: {
    lastExportAt: string | null;
    exportedCount: number | null;
    liveCount: number | null;
    graph: { exists: boolean; builtAt: string | null } | null;
    unread: Record<string, string>;
  };
  sites: Record<"bdnick" | "nickstire", { commit: string; asOf: string } | null>;
  /** Nick, the agent on bdnick, as a harness node. Absent from a bdnick deploy older than 2026-11-06. */
  nick?: {
    state: "reporting" | "unknown";
    lastSeenAt: string | null;
    reason: string | null;
    version: string | null;
    controlKeyReady: boolean | null;
  };
}

export async function readHarnessFromBdnick(): Promise<HarnessStatus> {
  const key = process.env.STATENOUR_SYNC_KEY;
  if (!key) throw new Error("Bridge key is not configured");
  const url = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
  const res = await fetch(`${url}/api/nour-os/query`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": key },
    body: JSON.stringify({ query: "harness_status" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`bdnick refused the harness read: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: HarnessStatus };
  if (!body.data) throw new Error("bdnick returned no data for the harness read");
  return body.data;
}
