/**
 * The System hub tiles, one source of truth (UI v3 W5a, 2026-10-18).
 *
 * SystemHubGrid (components/system/hub-grid.tsx) renders them; the command palette builds its
 * System rows from them through hubPaletteRows, so a new tile cannot miss the palette. Kept free of
 * React hooks and tRPC on purpose: the palette mounts in the ROOT layout, outside TRPCProvider.
 */
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Bot,
  Brain,
  Camera,
  Clock,
  DollarSign,
  FileText,
  FlaskConical,
  Inbox,
  MessageSquare,
  Radio,
  Search,
  Stethoscope,
  Target,
} from "lucide-react";

export type Severity = "healthy" | "warning" | "critical" | "info" | "unknown";
export type CardGroup = "health" | "governance" | "ai" | "data";

/**
 * `measured` is optional ONLY for the deploy window (an old server payload
 * lacks it). The load-bearing check everywhere below is `=== false` — a
 * section the server explicitly marked unmeasured must never render as a
 * count, a "healthy", or a "no devices". Its zeros are shape filler from
 * a crashed scan or the open quota circuit, not observations.
 */
export interface HubPayload {
  crons: {
    declared: number;
    silent: number;
    logRows48h: number;
    killed: number;
    measured?: boolean;
  };
  errors: { count24h: number; fatal24h: number; measured?: boolean };
  stale: { totalRows: number; categories: number; measured?: boolean };
  brain: {
    totalMemories: number;
    permanent: number;
    avgConfidence: number;
    measured?: boolean;
  };
  devices: { online: number; offline: number; total: number; measured?: boolean };
  pulse: { priorityCount: number; measured?: boolean };
  ai: { calls24h: number; costCents7d: number; measured?: boolean };
  generatedAt: string;
}

const UNMEASURED_CHIP = { label: "unmeasured", severity: "unknown" as Severity };
/** No payload: still loading, or the read failed (SystemHubGrid swaps in READ_FAILED_CHIP). */
export const NOT_READ_CHIP = { label: "n/a", severity: "unknown" as Severity };
export const READ_FAILED_CHIP = { label: "unknown", severity: "unknown" as Severity };

export interface HubCard {
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  group: CardGroup;
  description: string;
  /** The palette row id (kept stable: Recently Used remembers ids) and its search words. */
  paletteId: string;
  keywords: string[];
  chip: (d: HubPayload | null) => { label: string; severity: Severity };
  featured?: boolean; // edge-strong ring + floats to the top of its group
  /** A gallery of real components against fixtures, not a reading of the system: folds into the closed Lab (UI v3 W5a). */
  lab?: true;
}

// Wave AD-honesty (2026-06-03): the prior "mega-delete" removed ~30
// /system subpages (eval/coverage/quality/devops/governance sprawl);
// next.config.ts now redirects those paths to the bare /system hub or
// to /system/calibration. Cards pointing at them landed the operator
// on the hub or a collision, not the titled surface. Pruned to the
// cards that map 1:1 to a live, distinct destination. Removed:
// cron-diagnostics, performance, chat-health (redirect/collide into
// crons/ai-cost/health), policies + power (→ bare hub), the whole
// deploy group (deployment-truth/repos/schema-history/migrations/
// coverage → hub/calibration), agent-traces/brain-bus/tools/skills
// (→ hub), the whole quality group (prompt/judge-eval/quality/
// ghost-nour/coverage → hub/calibration), Devices (→ hub). Stale Data
// is now a real in-page System section, so its live card is restored below.
// "Brain Categories" repointed /brain/categories (404) → /brain.
// Hardcoded "114 tools"/"1,423 skills" count chips went with their
// (now-dead) cards.
// Exported for tests/components/hub-grid-chips.test.ts — the chips are the
// decision layer, and pinning them through a render would need a trpc mock
// for what are already pure functions of the payload.
export const CARDS: HubCard[] = [
  {
    href: "/system/fleet",
    paletteId: "sys-fleet",
    keywords: ["fleet", "truth", "capability", "artifact", "probe", "both apps", "nickstire"],
    title: "Fleet Truth",
    icon: Stethoscope,
    group: "health",
    description:
      "Cross-app capability artifacts: statenour probes + nickstire health, produced not just invoked",
    // Static chip — this card links to the live view; claiming health
    // here without probing would be the exact lie the page exists to end.
    chip: () => ({ label: "both apps", severity: "unknown" }),
  },
  {
    href: "/system/health",
    paletteId: "sys-health",
    keywords: ["health", "diagnostics", "probe", "env", "vectors", "backlog", "push", "pull", "oauth", "pulse", "stale", "cron", "rescan", "diagnose", "all"],
    title: "Diagnostics",
    icon: Stethoscope,
    group: "health",
    description:
      "Unified probe hub: env · crons · errors · backlog · vectors · pulse",
    featured: true,
    // Live chip merged in from the former "OS Health" card. "healthy" is a
    // claim about BOTH sources — if either scan did not run, the claim is
    // not available (2026-08-04: the quota circuit fed this chip fabricated
    // zeros and it printed "healthy" in green on a live page).
    // The old `fatal24h > 0` half was a dead branch (no writer ever emits
    // 'fatal'); degraded now keys on warning-level error volume instead.
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.errors.measured === false || d.crons.measured === false)
        return UNMEASURED_CHIP;
      const bad = d.errors.count24h > 20 || d.crons.silent > 2;
      return bad
        ? { label: "degraded", severity: "warning" }
        : { label: "healthy", severity: "healthy" };
    },
  },
  {
    href: "/system/camera",
    paletteId: "sys-camera",
    keywords: ["camera", "arrival", "vehicle", "plate", "event", "lot"],
    title: "Arrival Intel",
    icon: Camera,
    group: "health",
    // Demoted 2026-10-08 (camera audit N4): no longer featured. The lot view is the Lot section
    // of Nick's Admin; this is the raw event log the arrival alerts link to.
    description:
      "Raw vehicle-event log: arrival alerts and plate corrections (the lot view is Nick's Admin, Lot)",
    // 2026-07-25 honest-health: was a hardcoded `() => "live"/healthy` that
    // ignored the rollup entirely — a fabricated status. Now derived from
    // the measured smartDevice fleet (the cameras this surface runs on).
    // Guard is `online < total`, NOT `offline > 0`: SmartDevice.status also
    // takes ERROR and UNKNOWN (the column default), which inflate `total`
    // while counting as neither online nor offline — an all-UNKNOWN fleet
    // must warn, never render "0 online" in green.
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      // Before the total===0 check: "no devices" off an UNREAD fleet is a
      // claim about the shop's cameras made by a query that never ran.
      if (d.devices.measured === false) return UNMEASURED_CHIP;
      if (d.devices.total === 0) return { label: "no devices", severity: "unknown" };
      return d.devices.online < d.devices.total
        ? { label: `${d.devices.online}/${d.devices.total} online`, severity: "warning" }
        : { label: `${d.devices.online} online`, severity: "healthy" };
    },
  },
  {
    href: "/system/crons",
    paletteId: "sys-crons",
    keywords: ["cron", "schedule", "job", "kill", "manual", "silent", "slow", "diagnose"],
    title: "Cron Deck",
    icon: Clock,
    group: "health",
    description: "Live cron control surface: enable/disable per job + run now",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.crons.measured === false) return UNMEASURED_CHIP;
      if (d.crons.killed > 0)
        return { label: `${d.crons.killed} killed`, severity: "warning" };
      // A declared count is not a health verdict; silent jobs are the signal (09-F24).
      if (d.crons.silent > 0) return { label: `${d.crons.silent} silent`, severity: "warning" };
      return { label: `${d.crons.declared} jobs`, severity: "info" };
    },
  },
  {
    // v10.0.306 · /system/errors absorbed into /system/logs as a
    // GROUPED view-mode tab. Fingerprint deck + per-row open-as-task
    // still here, just one fewer page route.
    href: "/system/logs?view=errors",
    paletteId: "sys-errors",
    keywords: ["error", "log", "stack", "fingerprint"],
    title: "Errors",
    icon: AlertTriangle,
    group: "health",
    description: "Fingerprinted error log with frequency + stack grouping",
    // fatal24h counts level='error' (no writer ever emits 'fatal' — the old
    // >0-critical branch could never fire). Thresholds from the live
    // 2026-08-04 baseline (~12.6 errors/day): >=40/24h (~3x mean) critical,
    // >20/24h warning. Bare >0 would flag most ordinary days.
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.errors.measured === false) return UNMEASURED_CHIP;
      if (d.errors.fatal24h >= 40)
        return { label: `${d.errors.fatal24h} errors 24h`, severity: "critical" };
      if (d.errors.count24h > 20)
        return { label: `${d.errors.count24h} errs 24h`, severity: "warning" };
      return { label: `${d.errors.count24h} 24h`, severity: "healthy" };
    },
  },
  {
    href: "/system/alerts",
    paletteId: "sys-alerts",
    keywords: ["alert", "inspect", "category", "coach"],
    title: "Alerts Inspector",
    icon: AlertCircle,
    group: "health",
    description: "Cross-category alerts inspector · filter by category",
    chip: () => ({ label: "browse", severity: "info" }),
  },
  {
    href: "/system/actions",
    paletteId: "sys-actions",
    keywords: ["action", "autonomous", "rule", "audit", "approval"],
    title: "Autonomous Actions",
    icon: Bot,
    group: "governance",
    description: "Nick's autonomous action audit: rules · approvals · history",
    chip: () => ({ label: "audit", severity: "info" }),
  },
  {
    href: "/system/tools",
    paletteId: "sys-tools",
    keywords: ["tool", "registry", "govern", "permission", "capability"],
    title: "Tools Registry",
    icon: Search,
    group: "governance",
    description: "Inspect and govern agent tool access and permission policies",
    chip: () => ({ label: "inspect", severity: "info" }),
  },
  {
    href: "/system/ai-cost",
    paletteId: "sys-ai-cost",
    keywords: ["cost", "nick", "tokens", "budget", "burn"],
    title: "AI Cost",
    icon: DollarSign,
    group: "ai",
    description: "Per-model + per-feature burn rate with daily budget",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      // A fabricated "$0.00 7d" reads as a spend observation; it is not.
      if (d.ai.measured === false) return UNMEASURED_CHIP;
      const usd = (d.ai.costCents7d / 100).toFixed(2);
      return { label: `$${usd} 7d`, severity: "info" };
    },
  },
  {
    // /brain/categories was deleted in the brain consolidation (no
    // redirect → 404). Bare /brain opens the Map tab, so this lands on
    // the Memory tab; /brain shows no people intelligence (audit 02-F18).
    href: "/brain?tab=memory",
    paletteId: "sys-brain-memory",
    keywords: ["brain", "memory", "recall", "belief", "contradiction"],
    title: "Brain Categories",
    icon: Brain,
    group: "ai",
    description: "Memory tab: saved memories, recall, beliefs and contradictions",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.brain.measured === false) return UNMEASURED_CHIP;
      return {
        label: `${d.brain.totalMemories.toLocaleString()} rows`,
        severity: "info",
      };
    },
  },
  {
    href: "/system#stale-data",
    paletteId: "diag-stale",
    keywords: ["stale", "purge", "clean", "orphan", "dismissed"],
    title: "Stale Data",
    icon: Archive,
    group: "data",
    description: "Looks-live-but-old rows · exact category policy + targeted cleanup",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.stale.measured === false) return UNMEASURED_CHIP;
      if (d.stale.totalRows === 0) return { label: "clean", severity: "healthy" };
      return {
        label: `${d.stale.totalRows} stale`,
        severity: d.stale.totalRows > 50 ? "critical" : "warning",
      };
    },
  },
  {
    href: "/system/logs",
    paletteId: "sys-logs",
    keywords: ["log", "request", "stream", "api", "generation"],
    title: "Logs",
    icon: FileText,
    group: "data",
    description: "Recent request log + AI generation stream",
    chip: () => ({ label: "view", severity: "info" }),
  },
  {
    // 2026-07-28 blueprint: documented as canonical in ARCHITECTURE.md,
    // README and DB-MIGRATION-POLICY — yet reachable only by typed URL
    // since the Wave-AD card prune. Restored (same precedent as the
    // Calibration card below).
    href: "/system/schema-history",
    paletteId: "sys-schema-history",
    keywords: ["schema", "migration", "ledger", "ddl", "destructive", "approver"],
    title: "Schema History",
    icon: FileText,
    group: "data",
    description: "Schema-change ledger: every migration with method, destructive flag + approver",
    chip: () => ({ label: "audit trail", severity: "info" }),
  },
  {
    // 2026-07-28 · S5 gallery shipped nav-orphaned the same night it was
    // built — the exact /system/inbox orphan class this grid fixed in June.
    href: "/system/chat-states",
    paletteId: "sys-chat-states",
    keywords: ["chat", "states", "gallery", "fixture", "ui", "screenshot"],
    title: "Chat States",
    icon: MessageSquare,
    group: "data",
    description: "Real chat components against fixtures, eyeball after UI changes",
    chip: () => ({ label: "gallery", severity: "info" }),
    lab: true,
  },
  {
    // 2026-09-15 · UI workbench. The inspector chrome, its four honest
    // non-content states, the metric grammar and the evidence mark against
    // fixtures. Split from Chat States because that page is pinned by
    // full-page screenshot baselines (tests/e2e/chat-states.spec.ts).
    href: "/system/ui-lab",
    paletteId: "sys-ui-lab",
    keywords: ["ui", "lab", "gallery", "inspector", "fixture", "metric", "evidence", "reality mode"],
    title: "UI Lab",
    icon: FlaskConical,
    group: "data",
    description: "Inspector, metric + evidence primitives against fixtures, frozen clock, nothing mocked",
    chip: () => ({ label: "gallery", severity: "info" }),
    lab: true,
  },
  {
    // 2026-07-28 blueprint: the daily 10:15 brief push was the ONLY path
    // to /intelligence/brief — miss the push, lose the surface. The ledger
    // (outcome tracking) hangs off the brief page.
    href: "/intelligence/brief",
    paletteId: "sys-intelligence",
    keywords: ["intelligence", "brief", "executive", "opportunity", "ledger", "outcome"],
    title: "Intelligence",
    icon: Radio,
    group: "ai",
    description: "Daily executive brief + opportunity scoring + outcome ledger",
    chip: () => ({ label: "briefs", severity: "info" }),
  },
  {
    // v-truth · calibration is a LIVE page but the prune left it with no
    // hub card (the quality/eval cards that redirected here were removed).
    // Restore one honest, direct card so it stays reachable.
    href: "/system/calibration",
    paletteId: "sys-calibration",
    keywords: ["calibration", "quality", "state", "mood", "hit rate", "suggestion", "judge", "eval", "operator state"],
    title: "State Calibration",
    icon: Target,
    group: "ai",
    // Prediction accuracy (Brier) lives on /stats?tab=calibration; this page is the mood x kind grid (10-X3).
    description: "Suggestion hit rate by mood, LLM judge agreement",
    chip: () => ({ label: "eval", severity: "info" }),
  },
  {
    href: "/system/proactive-preview",
    paletteId: "sys-proactive",
    keywords: ["proactive", "push", "preview", "dry run", "telemetry"],
    title: "Proactive Preview",
    icon: Bot,
    group: "ai",
    description: "Preview morning/afternoon/evening proactive pushes and risk telemetry",
    chip: () => ({ label: "preview", severity: "info" }),
  },
  {
    href: "/system/cockpit-observability",
    paletteId: "sys-cockpit",
    keywords: ["cockpit", "observability", "trace", "metric", "decay", "prompt version"],
    title: "Cockpit Observability",
    icon: Brain,
    group: "ai",
    description: "Live metrics, execution traces, memory decay, and prompt versions for Nick",
    // 2026-07-25 honest-health: was a hardcoded `() => "observing"/healthy`
    // that ignored the rollup — a fabricated status. Now shows the measured
    // 24h AI-call count as telemetry ("info"), never an unearned "healthy".
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.ai.measured === false) return UNMEASURED_CHIP;
      return { label: `${d.ai.calls24h} calls · 24h`, severity: "info" };
    },
  },
  {
    // 2026-06-18 · IA reorg Phase 2 · surface the last orphaned system page.
    // /system/inbox (memory-quarantine review) was reachable from neither
    // nav nor cmdK nor a hub tile — only by typing the URL.
    href: "/system/inbox",
    paletteId: "sys-inbox",
    keywords: ["inbox", "quarantine", "memory", "contradiction", "review"],
    title: "Memory Inbox",
    icon: Inbox,
    group: "ai",
    description: "Quarantined memory ingestion: review claims + contradictions before they land",
    chip: () => ({ label: "review", severity: "info" }),
  },
];

/** One System row in the command palette, derived from a hub tile. */
export interface HubPaletteRow {
  id: string;
  label: string;
  href: string;
  keywords: string[];
  lab: boolean;
  icon: HubCard["icon"];
}

/**
 * The palette's System rows: one per hub tile, minus the tiles whose href a Navigate row already
 * reaches (one destination, one door; audit 10-U10). Lab tiles are labelled "Lab" so a search for
 * a fixture gallery never reads as a live surface.
 */
export function hubPaletteRows(
  ownedElsewhere: ReadonlySet<string>,
  cards: readonly HubCard[] = CARDS,
): HubPaletteRow[] {
  return cards
    .filter((c) => !ownedElsewhere.has(c.href))
    .map((c) => ({
      id: c.paletteId,
      label: c.lab ? `Lab · ${c.title}` : c.title,
      href: c.href,
      keywords: c.lab ? [...c.keywords, "lab"] : c.keywords,
      lab: Boolean(c.lab),
      icon: c.icon,
    }));
}
