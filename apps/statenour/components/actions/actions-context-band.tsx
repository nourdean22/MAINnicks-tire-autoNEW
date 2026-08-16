"use client";

/**
 * ActionsContextBand · Wave 19 (v10.0.529.73) · the daily-context strip
 * that sits above the work surface on /tasks.
 *
 * What it is now (smarter than Wave 18):
 *   · Brain card fetches /api/brain/maturity once on mount and shows the
 *     live maturity score (0-100) + open-contradiction count. So the
 *     card is not a static link — it's a status reading.
 *   · Life cards are a 5-spot quick router (mastery · body · money ·
 *     knowledge · learn). Vocab simplified · plain English.
 *
 * Visual contract:
 *   · ONE accent direction (gold-on-hover) across all 6 cards
 *   · Same editorial-minimalist primitive: tight border · raised bg ·
 *     font-mono labels · lowercase
 *   · Zero render cost when /api/brain/maturity fails (no data → no
 *     badge · card is still a working link)
 *
 * Why this lives on /tasks:
 *   The execution surface (where you act) is the right place for
 *   context (what you stand for · where you're growing · what nick
 *   noticed). Pre-Wave-18 these were 3 separate QUICK NAV rows
 *   (BRAIN · LIFE · OPS) — the operator collapsed them here so the
 *   day's flow has context inline.
 *
 * Skills applied:
 *   · frontend-design (DFII ≥ 8 · ONE direction · editorial minimalism)
 *   · ux-copy + avoid-ai-writing (plain English · no jargon)
 *   · ux-flow (context BEFORE execution · Nielsen heuristic)
 *   · senior-frontend (single fetch · graceful 404 · no waterfalls)
 *   · fixing-accessibility (focus-visible · aria-labels · keyboard nav)
 *   · ELON delete-first (the band is a router · destinations keep depth)
 */

import Link from "next/link";
import {
  Brain as BrainIcon,
  Target,
  BookOpen,
  Activity,
  DollarSign,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { TipChip } from "@/components/ui/tip-chip";
import { LEARN_TIPS } from "@/lib/learn/tips";

interface LifeSurface {
  href: string;
  label: string;
  icon: typeof Target;
}

// v10.0.529.75 · Wave 20.1 · the operator called out the previous 2×3
// blurb-card grid as "big-ass cards" eating context-band real estate.
// Collapsed to a single horizontal chip row · icon + label only · the
// destination routes carry their own depth so blurbs were redundant.
// Total height went from ~170px → ~32px.
const LIFE: LifeSurface[] = [
  { href: "/stats",     label: "growth",    icon: Target },
  { href: "/stats#body", label: "body",      icon: Activity },
  { href: "/business?tab=money", label: "money",     icon: DollarSign },
  { href: "/learn",     label: "learn",     icon: BookOpen },
];

interface MaturitySummary {
  score: number;
  openContradictions: number;
}

export function ActionsContextBand() {
  // actions-surface slice · migrated off `authedFetch("/api/brain/
  // maturity")` onto `trpc.brain.maturity`. The procedure returns the
  // `BrainMaturityView` unwrapped (the legacy route wrapped it in
  // `{ maturity }`). A transport error leaves `data` undefined → the
  // band stays calm (no badge), matching the legacy `null` fallback.
  const maturityQuery = trpc.brain.maturity.useQuery(undefined, {
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const summary: MaturitySummary | null = maturityQuery.data
    ? {
        score:
          typeof maturityQuery.data.score === "number"
            ? maturityQuery.data.score
            : 0,
        openContradictions:
          typeof maturityQuery.data.components?.contradictions?.open ===
          "number"
            ? maturityQuery.data.components.contradictions.open
            : 0,
      }
    : null;

  // Compact alert badge · only renders when there's signal worth seeing.
  // 0 contradictions = silent (the band stays calm).
  const alertChip =
    summary && summary.openContradictions > 0 ? (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-400 px-1.5 py-[1px] text-[9px] font-mono tabular-nums"
        title={`${summary.openContradictions} unresolved contradiction${summary.openContradictions === 1 ? "" : "s"}`}
      >
        ⚠ {summary.openContradictions}
      </span>
    ) : null;

  // Score chip · gold when present · zinc-tinted "—" while loading.
  const scoreChip = (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--gold)]/10 text-[var(--gold)] px-1.5 py-[1px] text-[9px] font-mono tabular-nums"
      title="brain maturity score · 0-100"
    >
      {summary ? `${summary.score}` : "—"}/100
    </span>
  );

  return (
    <section
      aria-label="brain and life context"
      className="space-y-2.5"
    >
      {/* Brain · the self-model entry · live maturity + alert badges +
          TipChip explaining what the brain surface IS. v10.0.529.74 */}
      <div className="flex items-center gap-1">
        <Link
          href="/brain"
          className="group flex items-center gap-3 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] px-3 py-2.5 transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.04] focus-visible:outline-none focus-visible:border-[var(--gold)]/60 focus-visible:bg-[var(--gold)]/[0.06]"
          aria-label="open brain · self-model · alerts · skills · identity"
        >
          <BrainIcon
            size={14}
            strokeWidth={1.75}
            className="text-[var(--text-tertiary)] group-hover:text-[var(--gold)] transition-colors shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono lowercase tracking-[0.18em] text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors">
                brain
              </span>
              {scoreChip}
              {alertChip}
            </div>
            <p className="text-[10px] leading-snug text-[var(--text-secondary)] truncate mt-0.5">
              who you are · what you stand for · what Nick noticed
            </p>
          </div>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)] group-hover:text-[var(--gold)] transition-colors shrink-0">
            open →
          </span>
        </Link>
        <TipChip tip={LEARN_TIPS.brain_card} title="brain" size="sm" />
      </div>

      {/* Life · 5 chips in ONE horizontal row · icon + label only ·
          ~32px total vs the pre-fix 170px feature-card grid. The
          destination routes carry the depth · the band is a router. */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] shrink-0">
          life ·
        </span>
        {LIFE.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              className="group inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] px-2 py-0.5 transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.04] focus-visible:outline-none focus-visible:border-[var(--gold)]/60 focus-visible:bg-[var(--gold)]/[0.06]"
              aria-label={`open ${s.label}`}
            >
              <Icon
                size={10}
                strokeWidth={1.75}
                className="text-[var(--text-tertiary)] group-hover:text-[var(--gold)] transition-colors shrink-0"
              />
              <span className="text-[10px] font-mono lowercase tracking-[0.12em] text-[var(--text-secondary)] group-hover:text-[var(--gold)] transition-colors">
                {s.label}
              </span>
            </Link>
          );
        })}
        <TipChip tip={LEARN_TIPS.life_band} title="life" size="xs" />
      </div>
    </section>
  );
}
