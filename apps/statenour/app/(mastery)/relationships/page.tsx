"use client";

/**
 * /relationships — Power Atlas surface (Phase 1 daily-driver).
 *
 * Pre-Phase-1 this was a flat list. Phase 1 extends it into the canonical
 * Power Atlas bento: the existing roll-up + sorted person list still
 * anchors the top (operator's familiar entry point); below it, a
 * selectable detail panel surfaces the dossier · ledger · Greene laws ·
 * power balance · log/blow-up actions.
 *
 * Aesthetic per spec section "Aesthetic · minimalist-UI inside statenour
 * dark/gold": serif page title (via font-serif utility) · monospace
 * amounts · 1px borders rgba(255,255,255,0.06) · 8-12px radii · NO
 * emojis on the new bento components · quiet motion (mount fade via
 * page-fade-in on StandardPage).
 *
 * NOTE: existing list rows preserve their original Lucide-free styling
 * to avoid scope creep · ONLY the new power-atlas components follow the
 * Phosphor/Radix mandate (and those use zero icons in v1, text glyphs
 * only). This matches the executor brief.
 */

import { useState, useMemo } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

import DossierEditor from "@/components/power-atlas/DossierEditor";
import LedgerTimeline from "@/components/power-atlas/LedgerTimeline";
import GreeneLawSidebar from "@/components/power-atlas/GreeneLawSidebar";
import PowerBalanceGauge from "@/components/power-atlas/PowerBalanceGauge";
import BlowUpModal from "@/components/power-atlas/BlowUpModal";
import LogLedgerModal from "@/components/power-atlas/LogLedgerModal";
import AlphaMoments from "@/components/power-atlas/AlphaMoments";
import ArcProjection from "@/components/power-atlas/ArcProjection";
import PowerPlaysModal from "@/components/power-atlas/PowerPlaysModal";
import SocialProof from "@/components/power-atlas/SocialProof";
import ReciprocityCard from "@/components/power-atlas/ReciprocityCard";
import ToneShiftCard from "@/components/power-atlas/ToneShiftCard";
import TopicGoalOverlapCard from "@/components/power-atlas/TopicGoalOverlapCard";
import PowerPlaysHistory from "@/components/power-atlas/PowerPlaysHistory";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  trustScore: number;
  leverageNotes: string | null;
  lastInteraction: string | null;
  interactionCount: number;
  daysSinceInteraction: number | null;
  isNeglected: boolean;
}

interface PeopleResponse {
  people: PersonRow[];
  totals: {
    total: number;
    neglected: number;
    high_trust: number;
    sparse: number;
  };
  generatedAt: string;
}

type SortKey = "recent" | "trust" | "neglect";
const VALID_SORTS = ["recent", "trust", "neglect"] as const;
const VISIBLE_CAP = 10; // ADHD-adaptation · max 10 above the fold

function trustTone(score: number): { bg: string; text: string } {
  if (score >= 0.7)
    return {
      bg: "bg-emerald-500/[0.08] border-emerald-500/30",
      text: "text-emerald-200",
    };
  if (score >= 0.4)
    return {
      bg: "bg-sky-500/[0.08] border-sky-500/30",
      text: "text-sky-200",
    };
  return { bg: "bg-zinc-500/[0.08] border-zinc-500/30", text: "text-zinc-300" };
}

function relativeTime(daysSince: number | null): string {
  if (daysSince === null) return "—";
  if (daysSince === 0) return "today";
  if (daysSince === 1) return "1d ago";
  if (daysSince < 30) return `${daysSince}d ago`;
  if (daysSince < 365) return `${Math.round(daysSince / 30)}mo ago`;
  return `${Math.round(daysSince / 365)}y ago`;
}

export default function RelationshipsPage() {
  const [sortKey, setSortKey] = useLocalStorageState<SortKey>(
    "relationships:sortKey",
    "recent",
    VALID_SORTS,
  );
  const [showAll, setShowAll] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalDirection, setLogModalDirection] = useState<
    "deposit" | "withdraw"
  >("deposit");
  const [blowUpOpen, setBlowUpOpen] = useState(false);

  const { data, loading, error, reload } = usePollingFetch<PeopleResponse>(
    `/api/people?sort=${sortKey}&limit=100`,
    { intervalMs: 5 * 60_000 }, // 5min · people change slowly
  );

  const visiblePeople = useMemo(() => {
    if (!data) return [];
    return showAll ? data.people : data.people.slice(0, VISIBLE_CAP);
  }, [data, showAll]);

  // Detail query · fires when a person is selected
  const personDetail = trpc.task.personProfile.useQuery(
    { personId: selectedPersonId ?? "" },
    { enabled: !!selectedPersonId },
  );

  return (
    <StandardPage
      eyebrow="brain · relationships"
      title="people"
      description="Power Atlas · trust scores · neglect detection · Greene laws · ledger · tap a name to open the dossier"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt}
          source="people-intelligence engine"
          onReload={reload}
        />
      }
    >
      {/* Roll-up strip · 4 totals */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="total"
            value={data.totals.total}
            tint="text-[var(--text-primary)]"
          />
          <Stat
            label="neglected"
            value={data.totals.neglected}
            tint={
              data.totals.neglected > 0 ? "text-amber-300" : "text-zinc-500"
            }
          />
          <Stat
            label="high trust"
            value={data.totals.high_trust}
            tint="text-emerald-300"
          />
          <Stat
            label="sparse"
            value={data.totals.sparse}
            tint={data.totals.sparse > 5 ? "text-amber-300" : "text-zinc-500"}
          />
        </div>
      )}

      {/* Sort + show-all */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          {sortKey === "neglect"
            ? "needs attention"
            : sortKey === "trust"
              ? "highest trust"
              : "most recent"}
        </h2>
        <SortDropdown
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          ariaLabel="Sort people"
          options={[
            { value: "recent", label: "most recent first" },
            { value: "trust", label: "trust · highest first" },
            { value: "neglect", label: "neglected first" },
          ]}
        />
      </div>

      {/* People list · tap-to-select for in-page detail (no nav) */}
      {data && data.people.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          No people profiles yet · the people-intelligence engine builds these
          from your chat history. Open a few chat conversations that mention
          specific people, then check back.
        </div>
      )}

      {data && data.people.length > 0 && (
        <div className="grid gap-2">
          {visiblePeople.map((p) => {
            const tone = trustTone(p.trustScore);
            const isSelected = selectedPersonId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setSelectedPersonId(isSelected ? null : p.id)
                }
                className={cn(
                  "block w-full text-left rounded-lg border p-3 transition-all hover:scale-[1.005] active:scale-[0.99]",
                  tone.bg,
                  isSelected && "ring-1 ring-[var(--gold)]/50",
                )}
                aria-expanded={isSelected}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-semibold truncate",
                          tone.text,
                        )}
                      >
                        {p.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                        {p.role}
                      </span>
                      {p.isNeglected && (
                        <Badge className="h-auto rounded px-1.5 py-0.5 bg-transparent border-amber-500/30 text-amber-300 text-[10px] font-normal uppercase tracking-wider">
                          neglected
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                      {p.relationship || "no relationship notes"}
                    </p>
                    {p.leverageNotes && (
                      <p className="mt-1 text-[11px] italic text-[var(--text-tertiary)] line-clamp-1">
                        leverage: {p.leverageNotes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      trust
                    </div>
                    <div
                      className={cn(
                        "text-lg font-mono font-bold tabular-nums",
                        tone.text,
                      )}
                    >
                      {Math.round(p.trustScore * 100)}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                      {relativeTime(p.daysSinceInteraction)} ·{" "}
                      {p.interactionCount}×
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {data.people.length > VISIBLE_CAP && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--gold)] py-2 transition-colors"
            >
              {showAll
                ? `show fewer (cap ${VISIBLE_CAP})`
                : `show ${data.people.length - VISIBLE_CAP} more`}
            </button>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-[var(--text-tertiary)]">
          loading people…
        </div>
      )}
      {error && !data && (
        <div className="text-sm text-rose-300">
          people-intelligence unavailable · tap reload
        </div>
      )}

      {/* ─── Detail panel · bento layout ─── */}
      {selectedPersonId && (
        <div className="pt-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          {personDetail.isLoading && (
            <div className="text-sm text-[var(--text-tertiary)]">
              loading dossier…
            </div>
          )}
          {personDetail.error && (
            <div className="text-sm text-rose-300">
              {personDetail.error.message}
            </div>
          )}
          {personDetail.data && personDetail.data.person && (
            <DetailPanel
              detail={personDetail.data}
              onOpenLog={(direction) => {
                setLogModalDirection(direction);
                setLogModalOpen(true);
              }}
              onOpenBlowUp={() => setBlowUpOpen(true)}
            />
          )}

          {/* Modals */}
          {personDetail.data?.person && (
            <>
              <LogLedgerModal
                personId={personDetail.data.person.id}
                personName={personDetail.data.person.name}
                open={logModalOpen}
                onOpenChange={setLogModalOpen}
                initialDirection={logModalDirection}
              />
              <BlowUpModal
                personId={personDetail.data.person.id}
                personName={personDetail.data.person.name}
                open={blowUpOpen}
                onOpenChange={setBlowUpOpen}
              />
            </>
          )}
        </div>
      )}
    </StandardPage>
  );
}

interface DetailPanelData {
  person: {
    id: string;
    name: string;
    role: string;
    status: string;
    dossierMd: string | null;
    dossierUpdatedAt: Date | string | null;
    powerBalance: number;
    powerBalanceManualLock: boolean;
    blowUpReason: string | null;
    blownUpAt: Date | string | null;
    lastArcPlan: unknown;
    metadata: unknown;
  };
  ledger: Array<{
    id: string;
    createdAt: Date | string;
    amount: number;
    note: string;
    source: string;
  }>;
  plays: Array<{
    id: string;
    createdAt: Date | string;
    kind: string;
    output: unknown;
    outcome: string | null;
    outcomeNote: string | null;
  }>;
  applicableLawTexts: Array<{ key: string; content: string }>;
}

function DetailPanel({
  detail,
  onOpenLog,
  onOpenBlowUp,
}: {
  detail: DetailPanelData;
  onOpenLog: (direction: "deposit" | "withdraw") => void;
  onOpenBlowUp: () => void;
}) {
  const { person, ledger, plays, applicableLawTexts } = detail;
  const blownUp = person.status === "blown_up";
  const utils = trpc.useUtils();
  const updatePowerBalance = trpc.task.updatePowerBalance.useMutation({
    onSuccess: () => {
      void utils.task.personProfile.invalidate({ personId: person.id });
    },
  });

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-serif text-2xl tracking-tight text-[var(--text-primary)]">
          {person.name}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            status
          </span>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border",
              blownUp
                ? "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]"
                : person.status === "active"
                  ? "border-emerald-500/30 text-emerald-200 bg-emerald-500/[0.05]"
                  : "border-zinc-500/30 text-zinc-300 bg-zinc-500/[0.05]",
            )}
          >
            {person.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {blownUp && person.blowUpReason && (
        <div
          className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-xs text-rose-200"
        >
          <span className="uppercase tracking-wider text-[10px] mr-2">
            blow-up reason:
          </span>
          {person.blowUpReason}
        </div>
      )}

      {/* Bento grid · 3-col desktop, 1-col mobile · dossier 2/3 + sidebar 1/3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <DossierEditor
            personId={person.id}
            initialDossier={person.dossierMd}
            dossierUpdatedAt={
              person.dossierUpdatedAt
                ? typeof person.dossierUpdatedAt === "string"
                  ? person.dossierUpdatedAt
                  : person.dossierUpdatedAt.toISOString()
                : null
            }
          />
          <LedgerTimeline
            entries={ledger.map((e) => ({
              id: e.id,
              createdAt: e.createdAt,
              amount: e.amount,
              note: e.note,
              source: e.source,
            }))}
          />
          <TopicGoalOverlapCard metadata={person.metadata} />
          <PowerPlaysHistory plays={plays} personId={person.id} />
          <AlphaMoments personId={person.id} />
          <SocialProof personId={person.id} />
        </div>
        <div className="space-y-4">
          <PowerBalanceGauge
            value={person.powerBalance}
            manualLock={person.powerBalanceManualLock}
            onUpdate={async (next) => {
              await updatePowerBalance.mutateAsync({
                personId: person.id,
                powerBalance: next,
                manualLock: true,
              });
            }}
          />
          <ArcProjection
            personId={person.id}
            initialProjection={person.lastArcPlan}
          />
          <GreeneLawSidebar applicableLawTexts={applicableLawTexts} />
          <ReciprocityCard metadata={person.metadata} />
          <ToneShiftCard metadata={person.metadata} />

          {/* Quick actions */}
          <section
            className="rounded-xl border bg-[var(--bg-raised)] p-4 space-y-2"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            <h3 className="font-serif text-base tracking-tight text-[var(--text-primary)] mb-2">
              Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenLog("deposit")}
                disabled={blownUp}
              >
                + deposit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenLog("withdraw")}
                disabled={blownUp}
              >
                − withdraw
              </Button>
            </div>
            <PowerPlaysModal personId={person.id} personName={person.name} />
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={onOpenBlowUp}
              disabled={blownUp}
            >
              {blownUp ? "blown up" : "blow up"}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 text-center">
      <div className={cn("text-2xl font-bold font-mono tabular-nums", tint)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
    </div>
  );
}
