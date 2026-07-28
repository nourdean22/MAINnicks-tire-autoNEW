"use client";

/**
 * /system/chat-states — the chat-state gallery (S5, 2026-07-28).
 *
 * The audit asked for Storybook; Storybook means dependency + lockfile
 * churn this repo deliberately avoids. This page is the no-new-deps
 * answer: the REAL components rendered against fixtures, one labeled
 * section per state, inside the authed app shell. Eyeball after UI
 * changes; Playwright can screenshot it when visual regression joins
 * the e2e lane.
 *
 * Rule: only components that take plain props render here — nothing is
 * mocked at module level, so what you see is the shipping code.
 */

import { useState } from "react";
import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";
import { TypedToolCards } from "@/features/chat-v2/components/typed-tool-cards";
import type { UIMessage } from "ai";

const fleetMessage = {
  id: "fx-fleet",
  role: "assistant",
  parts: [
    {
      type: "tool-getFleetTruth",
      state: "output-available",
      output: {
        ok: true,
        allFresh: false,
        generatedAt: "2026-07-28T22:00:00Z",
        statenour: [
          { capability: "daily-brief", state: "fresh", ageH: 3.2 },
          { capability: "outbox-drain", state: "stale", ageH: 41 },
          { capability: "inngest-heartbeat", state: "never_produced", ageH: null },
        ],
        nickstire: [
          { capability: "nickstire:health", state: "fresh", ageH: null },
          { capability: "nickstire:schema-guard", state: "unknown", ageH: null },
        ],
      },
    },
  ],
} as unknown as UIMessage;

const decisionsMessage = {
  id: "fx-decisions",
  role: "assistant",
  parts: [
    {
      type: "tool-getTopDecisions",
      state: "output-available",
      output: {
        ok: true,
        totalLive: 70,
        excludedSnoozed: 3,
        excludedNoConsent: 2,
        decisions: [
          {
            id: "d1",
            urgency: "critical",
            state: "new",
            recommendedAction: "Call Sarah back — she asked for a call about the van",
            valueDollars: 0,
            dataQuality: "verified",
          },
          {
            id: "d2",
            urgency: "today",
            state: "new",
            recommendedAction: "Call Mike about the $940 brake quote",
            valueDollars: 940,
            dataQuality: "inferred",
          },
        ],
      },
    },
  ],
} as unknown as UIMessage;

const unregisteredToolMessage = {
  id: "fx-unregistered",
  role: "assistant",
  parts: [{ type: "tool-someFutureTool", state: "output-available", output: { anything: true } }],
} as unknown as UIMessage;

const SECTIONS = [
  "Evidence panel — fresh recall",
  "Evidence panel — never fetched",
  "Typed card — fleet truth (mixed states)",
  "Typed card — decision inbox",
  "Unregistered tool — must render NOTHING typed",
  "Completion message — receipts sample",
] as const;

export default function ChatStatesPage() {
  const [evidenceOpen, setEvidenceOpen] = useState<"fresh" | "unfetched" | null>(null);

  return (
    <div className="px-4 pb-[var(--bottom-chrome-h)] max-w-2xl mx-auto space-y-4">
      <PageHeader
        eyebrow="SYSTEM"
        title="Chat States"
        description="Real components against fixtures — eyeball after UI changes; nothing here is mocked"
      />

      <Panel>
        <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-2">{SECTIONS[0]} / {SECTIONS[1]}</p>
        <div className="flex gap-2">
          <button
            onClick={() => setEvidenceOpen("fresh")}
            className="rounded-lg border border-glass px-3 py-2 text-[12px] text-fg-secondary hover:text-fg"
          >
            Open — fresh recall
          </button>
          <button
            onClick={() => setEvidenceOpen("unfetched")}
            className="rounded-lg border border-glass px-3 py-2 text-[12px] text-fg-secondary hover:text-fg"
          >
            Open — never fetched
          </button>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">{SECTIONS[2]}</p>
        <TypedToolCards message={fleetMessage} />
      </Panel>

      <Panel>
        <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">{SECTIONS[3]}</p>
        <TypedToolCards message={decisionsMessage} />
      </Panel>

      <Panel>
        <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">{SECTIONS[4]}</p>
        <TypedToolCards message={unregisteredToolMessage} />
        <p className="text-[11px] text-fg-tertiary">
          (Correct result: nothing above this line — unknown shapes fall back to the generic receipt row in real chat.)
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">{SECTIONS[5]}</p>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-fg whitespace-pre-wrap">
          {"**Action receipts**\n✅ telegram.send — receipt verified\n⏸ shop.sendSms — awaiting your approval (ID apr_x1). Approve in System → Actions.\n❌ task.create — failed: validation error\n\n— receipts · trace tr_demo1234"}
        </div>
      </Panel>

      <MemoryInspectorSidebar
        open={evidenceOpen !== null}
        onClose={() => setEvidenceOpen(null)}
        hits={
          evidenceOpen === "fresh"
            ? [
                { id: "m1", content: "Nour prefers evening workouts at Titans", category: "preference", similarity: 0.91 },
                { id: "m2", content: "Shop closes 6 PM Mon–Sat, 4 PM Sunday", category: "business_fact", similarity: 0.84 },
              ]
            : []
        }
        contradictions={
          evidenceOpen === "fresh"
            ? [{ id: "c1", claim: "Review count is ~1,500", reality: "Current count is 1,700+", severity: "medium" }]
            : []
        }
        fetchedAt={evidenceOpen === "fresh" ? new Date(Date.now() - 12_000) : null}
      />
    </div>
  );
}
