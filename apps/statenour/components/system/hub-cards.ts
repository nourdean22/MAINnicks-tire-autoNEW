/**
 * The System hub tiles, one source of truth (UI v3 W5a, 2026-10-18).
 *
 * SystemHubGrid (components/system/hub-grid.tsx) renders them; the command palette builds its
 * System rows from them through hubPaletteRows, so a new tile cannot miss the palette. Kept free of
 * React hooks and tRPC on purpose: the palette mounts in the ROOT layout, outside TRPCProvider.
 */
import {
  AlertCircle,
  Archive,
  Bot,
  Brain,
  Clock,
  FlaskConical,
  Inbox,
} from "lucide-react";

export type Severity = "healthy" | "warning" | "critical" | "info" | "unknown";
export type CardGroup = "health" | "governance" | "ai" | "data";

/**
 * `measured` is optional ONLY for the deploy window (an old server payload
 * lacks it). The load-bearing check everywhere below is `=== false`, a
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
// Exported for tests/components/hub-grid-chips.test.ts, the chips are the
// decision layer, and pinning them through a render would need a trpc mock
// for what are already pure functions of the payload.
export const CARDS: HubCard[] = [
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
    // 2026-06-18 · IA reorg Phase 2 · surface the last orphaned system page.
    // /system/inbox (memory-quarantine review) was reachable from neither
    // nav nor cmdK nor a hub tile, only by typing the URL.
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
