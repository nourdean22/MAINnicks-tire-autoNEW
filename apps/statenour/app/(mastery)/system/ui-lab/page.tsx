"use client";

/**
 * /system/ui-lab — the object grammar's primitives against fixtures
 * (2026-09-15, UI workbench slice 2).
 *
 * Sibling of /system/chat-states, split out on purpose: that page is
 * pinned by full-page screenshot baselines (tests/e2e/chat-states.spec.ts),
 * so every primitive added there would break the visual lane. This page
 * has no baselines yet; it is the place to eyeball the inspector chrome, its
 * four honest non-content states, the metric grammar and the evidence mark
 * after any change to them.
 *
 * Rules, same as chat-states: the REAL components, plain props, nothing
 * mocked at module level. The clock is frozen (FIXTURE_NOW) so every age
 * and expiry reads the same tomorrow — a gallery that drifts is a gallery
 * nobody trusts.
 */

import { useState } from "react";
import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { InspectorFrame, type InspectorMode } from "@/components/inspector/inspector-frame";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EvidenceMark } from "@/components/ui/evidence-mark";
import { Metric } from "@/components/ui/metric";
import { useInspectorStore } from "@/lib/state/inspector-store";
import { useInspector } from "@/hooks/use-inspector";
import type { ProvenanceInput } from "@/lib/brain/evidence-label";

/** Frozen so "recorded 3d ago" / "valid until Oct 1" never drift. */
const FIXTURE_NOW = new Date("2026-09-15T12:00:00Z");

const daysAgo = (n: number) => new Date(FIXTURE_NOW.getTime() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(FIXTURE_NOW.getTime() + n * 86_400_000).toISOString();

/** One row per evidence class on the commit-gateway ladder, best to worst. */
const EVIDENCE_FIXTURES: Array<{ title: string; provenance: ProvenanceInput }> = [
  {
    title: "Operator stated it, seen 4 times",
    provenance: { evidence: "operator_stated", source: "chat", trustTier: "OPERATOR", seenCount: 4, createdAt: daysAgo(3) },
  },
  {
    title: "A receipt — the system did it and logged it",
    provenance: { evidence: "system_receipt", source: "telegram.send", trustTier: "SYSTEM_DERIVED", createdAt: daysAgo(0) },
  },
  {
    title: "Observed (camera / device), ledger grade H1",
    provenance: { evidence: "direct_observation", source: "camera:bay-2", grade: "H1", quality: "observed", createdAt: daysAgo(1) },
  },
  {
    title: "External content — a scraped page",
    provenance: { evidence: "external_source", source: "firecrawl", trustTier: "EXTERNAL_CONTENT", createdAt: daysAgo(12) },
  },
  {
    title: "Inferred, verified last week, still valid",
    provenance: {
      evidence: "supported_inference",
      source: "nightly-reflection",
      trustTier: "AGENT_INFERRED",
      seenCount: 1,
      createdAt: daysAgo(20),
      lastVerifiedAt: daysAgo(6),
      validFrom: daysAgo(20),
      validUntil: daysAhead(16),
    },
  },
  {
    title: "A prediction — zinc, never violet",
    provenance: { evidence: "prediction", source: "tactician", createdAt: daysAgo(2) },
  },
  {
    title: "Weak signal, EXPIRED — the mark says so",
    provenance: { evidence: "weak_inference", source: "chat", createdAt: daysAgo(45), validUntil: daysAgo(5) },
  },
  {
    title: "Superseded by a newer memory",
    provenance: { evidence: "generated_summary", source: "daily-brief", createdAt: daysAgo(30), supersededById: "mem_newer" },
  },
];

/**
 * Fixture rows for the selection grammar. Kind `content` has no renderer, so
 * Enter shows the honest "no inspector for this kind yet" notice and nothing
 * needs a database — which is what lets tests/e2e/selection-grammar.spec.ts
 * exercise j/k · Space · Enter · x · Esc and the route-change reset against
 * the hermetic (empty) CI database.
 */
const FIXTURE_ROWS = [
  { id: "fx-1", label: "Fixture row one · a draft reel about tire rotation" },
  { id: "fx-2", label: "Fixture row two · a draft post about the Euclid Ave shop" },
  { id: "fx-3", label: "Fixture row three · a draft reply to a review" },
  { id: "fx-4", label: "Fixture row four · a draft carousel on brake wear" },
] as const;

/** A fixture body for the frame demo — what a memory inspector renders. */
function FixtureMemoryBody() {
  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-relaxed text-fg">
        Shop closes 6 PM Mon–Sat, 4 PM Sunday. Nour said it directly in chat.
      </p>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">proof</p>
        <EvidenceMark inline now={FIXTURE_NOW} provenance={EVIDENCE_FIXTURES[0].provenance} />
      </div>
      <Metric
        now={FIXTURE_NOW}
        result={{ status: "ok", value: 4, measuredAt: daysAgo(0), source: "brain.memoryById" }}
        spec={{ label: "times seen", higherIsBetter: true }}
      />
    </div>
  );
}

export default function UiLabPage() {
  const [frameOpen, setFrameOpen] = useState<InspectorMode | null>(null);
  const realityMode = useInspectorStore((s) => s.realityMode);
  const setRealityMode = useInspectorStore((s) => s.setRealityMode);
  const { openInspector } = useInspector();

  return (
    <div className="px-4 pb-[var(--bottom-chrome-h)] max-w-2xl mx-auto space-y-4">
      <PageHeader
        eyebrow="SYSTEM"
        title="UI Lab"
        description="The object grammar's primitives against fixtures — real components, frozen clock, nothing mocked"
      />

      <Panel>
        <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70">
          Inspector — the four non-content states must never look alike
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <InspectorNotice state="loading" kind="memory" />
          <InspectorNotice state="error" kind="memory" code="P2024" />
          <InspectorNotice state="not-found" kind="task" />
          <InspectorNotice state="unknown-kind" kind="device" />
        </div>
      </Panel>

      <Panel>
        <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70">
          Inspector frame — sheet chrome, peek vs inspect
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFrameOpen("peek")}
            className="min-h-[44px] rounded-lg border border-glass px-3 py-2 text-[12px] text-fg-secondary hover:text-fg md:min-h-0"
          >
            Open — peek
          </button>
          <button
            type="button"
            onClick={() => setFrameOpen("inspect")}
            className="min-h-[44px] rounded-lg border border-glass px-3 py-2 text-[12px] text-fg-secondary hover:text-fg md:min-h-0"
          >
            Open — inspect
          </button>
        </div>
        <p className="mt-2 text-[11px] text-fg-tertiary">
          The docked panel (≥1280px) is the same frame with presentation=&quot;panel&quot;; open any row&apos;s eye button
          on a wide screen to see it beside the page.
        </p>
      </Panel>

      <Panel>
        <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70">
          Metric — a number with its &quot;relative to what?&quot;
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Metric
            now={FIXTURE_NOW}
            result={{ status: "ok", value: 8, measuredAt: daysAgo(0), source: "personProfile.lastInteraction" }}
            spec={{
              label: "contact gap",
              unit: "d",
              baseline: { value: 14, label: "cadence" },
              range: { lo: 0, hi: 14 },
              higherIsBetter: false,
            }}
          />
          <Metric
            now={FIXTURE_NOW}
            result={{ status: "ok", value: 4.5, measuredAt: daysAgo(1), source: "health.sleep" }}
            spec={{
              label: "sleep",
              unit: "h",
              window: "last night",
              baseline: { value: 7.2, label: "30-day baseline" },
              range: { lo: 6.5, hi: 8.5, label: "normal band" },
              higherIsBetter: true,
            }}
          />
          <Metric
            now={FIXTURE_NOW}
            result={{
              status: "degraded",
              value: 184,
              measuredAt: daysAgo(9),
              staleSince: daysAgo(9),
              source: "health.weight",
              errorCode: "SYNC_STALE",
            }}
            spec={{ label: "weight", unit: "lb", baseline: { value: 186, label: "30-day baseline" }, higherIsBetter: false }}
          />
          <Metric
            now={FIXTURE_NOW}
            result={{ status: "unavailable", source: "nickstire.revenue", errorCode: "ECONNRESET" }}
            spec={{ label: "revenue today", unit: "$" }}
          />
        </div>
        <p className="mt-3 text-[11px] text-fg-tertiary">
          Unavailable renders &quot;unknown&quot; and the code — never a zero. Out-of-range turns amber; the delta&apos;s colour
          follows the metric&apos;s valence, so a smaller contact gap reads green.
        </p>
      </Panel>

      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70">Evidence mark — chip by default, inline in Reality Mode</p>
          <button
            type="button"
            onClick={() => setRealityMode(!realityMode)}
            aria-pressed={realityMode}
            className="min-h-[44px] rounded-lg border border-glass px-3 py-2 font-mono text-[11px] text-fg-secondary hover:text-fg md:min-h-0"
          >
            reality mode · {realityMode ? "on" : "off"}
          </button>
        </div>
        <ul className="divide-y divide-white/5">
          {EVIDENCE_FIXTURES.map((fx) => (
            <li key={fx.title} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="text-[13px] text-fg-secondary">{fx.title}</span>
              <EvidenceMark now={FIXTURE_NOW} provenance={fx.provenance} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-fg-tertiary">
          Hover a chip for the full provenance. The toggle above is the same persisted flag ⌘K → Modes flips; it
          changes every mark in the app, not just these.
        </p>
      </Panel>

      <Panel>
        <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70">
          Selection grammar — fixture rows · j/k move · Space peeks · Enter opens · x selects · Esc unwinds
        </p>
        <ul className="space-y-1" data-selection-scope="ui-lab-fixtures">
          {FIXTURE_ROWS.map((r) => (
            <li
              key={r.id}
              role="button"
              tabIndex={0}
              data-entity={`content:${r.id}`}
              data-entity-label={r.label}
              onClick={() => openInspector({ kind: "content", id: r.id })}
              className="flex min-h-[44px] cursor-pointer items-center rounded-lg border border-glass px-3 text-[13px] text-fg-secondary transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/50 data-[entity-focused=true]:border-[var(--gold)]/50 data-[entity-selected=true]:bg-[var(--gold)]/[0.06]"
            >
              {r.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-fg-tertiary">
          These are fixtures of a kind with no renderer yet, so opening one shows the honest no-renderer notice. The same
          grammar runs on Brain, Missions, People, alerts, crons and tools rows.
        </p>
      </Panel>

      {frameOpen !== null && (
        <InspectorFrame
          kind="memory"
          mode={frameOpen}
          presentation="sheet"
          onClose={() => setFrameOpen(null)}
          actions={<p className="font-mono text-[11px] text-fg-tertiary">actions slot — open · ask Nick · workset · copy link</p>}
        >
          <FixtureMemoryBody />
        </InspectorFrame>
      )}
    </div>
  );
}
