"use client";

/**
 * SystemHubGrid, the /system landing page's navigation surface.
 *
 * A grid of cards, one per subsurface, each with a live severity
 * chip showing current state. Cards are grouped by domain (Health,
 * Governance, AI, Data) so the list scans as short sections instead
 * of one undifferentiated wall. Only cards that resolve to a live,
 * distinct page are listed: see the CARDS prune note in hub-cards.ts.
 *
 * Any subsurface that is currently degraded (warning/critical) is
 * lifted into a "Needs attention" strip above the groups, so
 * problems hit your eye first without burying the healthy majority.
 *
 * All data from ONE rollup endpoint (/api/system/hub), avoids 15
 * parallel fetches. Auto-refreshes every 60s. Cards are <Link>
 * anchors, Tab-navigable.
 *
 * Wave 52 (2026-05-20): de-duped three cards that each pointed at a
 * route a sibling card already owned, which was also a duplicate
 * <Link key={href}> React collision:
 *   · "OS Health"  → merged into "Diagnostics" (same /system/health
 *     route; Diagnostics adopted OS Health's live degraded chip).
 *   · "Slow Queries" → merged into "Performance" (same
 *     /system/performance route).
 *   · "Command Center" → removed (it self-linked to /system).
 * Added domain grouping + the attention strip.
 *
 * UI v3 W5a (2026-10-18): tiles marked `lab` (real components against
 * fixtures, no live data) fold into ONE closed "Lab" disclosure after the
 * groups. Pinned by tests/components/hub-grid-lab.test.tsx.
 */

import { useId, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import {
  CARDS,
  NOT_READ_CHIP,
  READ_FAILED_CHIP,
  type CardGroup,
  type HubCard,
  type HubPayload,
  type Severity,
} from "@/components/system/hub-cards";

// Re-exported: tests import the tiles from the grid (hub-grid-chips, hub-grid-read-failed).
export { CARDS };

// UI v3 W5c (2026-10-29 sync audit, finding 13): a ruled row with a state word, not a tinted tile.
// Colour lives only on the dot and the word; the status hues are the grammar's five.
const SEVERITY_PALETTE: Record<Severity, { dot: string; text: string }> = {
  healthy: { dot: "bg-emerald-400", text: "text-emerald-300" },
  warning: { dot: "bg-amber-400", text: "text-amber-300" },
  critical: { dot: "bg-rose-400", text: "text-rose-300" },
  info: { dot: "bg-sky-400", text: "text-fg-secondary" },
  unknown: { dot: "bg-fg-tertiary", text: "text-fg-tertiary" },
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  healthy: 3,
  unknown: 4,
};

// Display order of the domain groups. The attention strip always
// renders above these regardless of order.
const GROUP_ORDER: { id: CardGroup; label: string }[] = [
  { id: "health", label: "Health and jobs" },
  { id: "governance", label: "Governance" },
  { id: "ai", label: "AI & Brain" },
  { id: "data", label: "Data and logs" },
];

function GroupHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: "alert";
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3
        className={cn(
          "font-mono text-[11px]",
          tone === "alert" ? "text-amber-300" : "text-(--text-tertiary)",
        )}
      >
        {label}
      </h3>
      <span className="text-[11px] tabular-nums text-fg-tertiary">
        {count}
      </span>
      <span className="h-px flex-1 bg-(--border-default)" />
    </div>
  );
}

function HubCardLink({
  card,
  chip,
}: {
  card: HubCard;
  chip: { label: string; severity: Severity };
}) {
  const pal = SEVERITY_PALETTE[chip.severity];
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className="group flex min-h-[44px] items-center gap-3 border-b border-edge-subtle py-3 transition-colors duration-[var(--motion-state)] hover:bg-surface-hover"
    >
      <Icon className="h-4 w-4 shrink-0 text-fg-tertiary group-hover:text-fg" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] text-fg", card.featured ? "font-semibold" : "font-medium")}>
          {card.title}
        </span>
        <span className="block truncate text-[12px] text-fg-tertiary">{card.description}</span>
      </span>
      <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums", pal.text)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", pal.dot)} aria-hidden />
        {chip.label}
      </span>
    </Link>
  );
}

export function SystemHubGrid() {
  // Phase VV (2026-05-22) · REST→tRPC · system.hub. The legacy route
  // wrapped its rollup in `{ data }`; the procedure returns it
  // unwrapped. The page polled on a 60s setInterval, refetchInterval
  // now drives that. With no payload every live card returns NOT_READ_CHIP;
  // when the read FAILED that becomes the word "unknown" (2026-10-10 ·
  // audit 09-F7), so a failure never looks like a load in flight.
  const hubQuery = trpc.system.hub.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const data: HubPayload | null = hubQuery.data ?? null;

  const [labOpen, setLabOpen] = useState(false);
  const labId = useId();

  const all = CARDS.map((c) => {
    const chip = c.chip(data);
    return { c, chip: chip === NOT_READ_CHIP && hubQuery.isError ? READ_FAILED_CHIP : chip };
  });
  // Lab tiles read no payload, so they can never need attention; they leave the groups.
  const lab = all.filter((x) => x.c.lab);
  const decorated = all.filter((x) => !x.c.lab);

  // Degraded surfaces (warning/critical) lift into a "Needs attention"
  // strip above the groups, problems hit the eye first. Critical
  // sorts before warning within the strip.
  const attention = decorated
    .filter(
      (x) => x.chip.severity === "critical" || x.chip.severity === "warning",
    )
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.chip.severity] - SEVERITY_ORDER[b.chip.severity],
    );
  const attentionHrefs = new Set(attention.map((x) => x.c.href));

  // Remaining (healthy / info / unknown) cards bucket into their
  // domain group. Featured cards float to the top of each group;
  // the rest hold declared order (Array.prototype.sort is stable).
  const grouped: Record<CardGroup, typeof decorated> = {
    health: [],
    governance: [],
    ai: [],
    data: [],
  };
  for (const x of decorated) {
    if (attentionHrefs.has(x.c.href)) continue;
    grouped[x.c.group].push(x);
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) =>
      a.c.featured === b.c.featured ? 0 : a.c.featured ? -1 : 1,
    );
  }

  return (
    <div className="space-y-5">
      {attention.length > 0 && (
        <section>
          <GroupHeader
            label="Needs attention"
            count={attention.length}
            tone="alert"
          />
          <div className="lg:grid lg:grid-cols-2 lg:gap-x-8">
            {attention.map(({ c, chip }) => (
              <HubCardLink key={c.href} card={c} chip={chip} />
            ))}
          </div>
        </section>
      )}

      {GROUP_ORDER.map(({ id, label }) => {
        const members = grouped[id];
        if (members.length === 0) return null;
        return (
          <section key={id}>
            <GroupHeader label={label} count={members.length} />
            <div className="lg:grid lg:grid-cols-2 lg:gap-x-8">
              {members.map(({ c, chip }) => (
                <HubCardLink key={c.href} card={c} chip={chip} />
              ))}
            </div>
          </section>
        );
      })}

      {lab.length > 0 && (
        <section aria-label="Lab">
          <button
            type="button"
            aria-expanded={labOpen}
            aria-controls={labId}
            onClick={() => setLabOpen((o) => !o)}
            className="flex min-h-[44px] w-full items-center gap-3 border-y border-(--border-default) text-left hover:bg-surface-hover"
          >
            <span className="text-sm font-semibold text-(--text-primary)">
              Lab, {lab.length} {lab.length === 1 ? "tool" : "tools"}
            </span>
            <span className="hidden text-[11px] text-fg-tertiary sm:inline">fixture galleries, no live data</span>
            <span className="ml-auto font-mono text-[11px] text-fg-tertiary">{labOpen ? "open" : "closed"}</span>
          </button>
          <div id={labId} hidden={!labOpen} className="mt-1 lg:grid lg:grid-cols-2 lg:gap-x-8">
            {lab.map(({ c, chip }) => (
              <HubCardLink key={c.href} card={c} chip={chip} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
