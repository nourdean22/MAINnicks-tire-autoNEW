"use client";

/**
 * Settings — the operator's live ops console.
 *
 * 2026-06-02 · evidence-based redesign. This page is now a thin
 * composition shell: every section is a self-contained, self-heading
 * panel in components/settings/* (or components/ultron/* for the
 * diagnostics chips). The shell only orders them into IA groups and
 * draws the group dividers; it owns no large inline component.
 *
 * What changed in the redesign (behavior-preserving except the dead
 * removals): the 13-toggle `AutoPilotControls` grid was replaced by the
 * single `OperatingRhythmToggle` — only `adhd_operating_rhythm` was ever
 * read by a worker (operating-rhythm.ts); the other 12 flags + shadow-
 * mode + mood-dimming + proof-of-life badges had zero consumers
 * (grep-verified). `SystemInfo` (10 hardcoded faux-telemetry rows) was
 * rebuilt as `SystemInfoCard` showing only live tools/memories/DB/arsenal
 * values. The duplicate legacy REST route /api/settings/autopilot (a 3rd
 * divergent defaults map, no fetch callers) was deleted. The real
 * automation control is `CronControlPanel`.
 *
 * v11 retirement · habits config + DEFAULT_HABITS seed deleted in
 * v10.0.529.69 audit. Habits live as DAILY Tasks on /tasks; the
 * /api/habits surface still serves backward-compat reads (zero importers
 * of the seed list · grep-verified).
 */

import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { AiSettingsPanel } from "@/components/settings/ai-settings-panel";
import { IntelligenceFlagsPanel } from "@/components/settings/intelligence-flags-panel";
import { PeopleScoringPanel } from "@/components/settings/people-scoring-panel";
import { JournalBrainPanel } from "@/components/settings/journal-brain-panel";
import { CronControlPanel } from "@/components/settings/cron-control-panel";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { IdentityPanel } from "@/components/settings/identity-panel";
import { SystemDataCards } from "@/components/settings/system-data-cards";
import { SystemOpsHub } from "@/components/settings/system-ops-hub";
import { OperatingRhythmToggle } from "@/components/settings/operating-rhythm-toggle";
import { SystemInfoCard } from "@/components/settings/system-info-card";
import { PushNotificationToggle } from "@/components/settings/push-notification-toggle";
import { TickerDismissalReset } from "@/components/settings/ticker-dismissal-card";
import { HQErrorsCard } from "@/components/ultron/hq-errors-card";
import { SystemHealthCard } from "@/components/ultron/system-health-card";
import { CommandSpinePulse } from "@/components/ultron/command-spine-pulse";
import { DeployChip } from "@/components/ultron/deploy-chip";
import { StandardPage } from "@/components/layout/standard-page";
import { useSystemPulse } from "@/lib/hooks/use-system-pulse";

/** Obsidian+gold group divider — labels an IA cluster of panels. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 mb-1 flex items-center gap-3">
      <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/70">
        {children}
      </span>
      <span className="h-px flex-1 bg-[var(--border-default)]" />
    </div>
  );
}

export default function SettingsPage() {
  const pulse = useSystemPulse();

  return (
    <StandardPage
      eyebrow="Mastery"
      title="settings"
      description="system ops · automation · ai · scoring · preferences"
      rhythm="loose"
    >
      {/* ═══ SYSTEM OPS — live counts linking to every /system/* surface ═══ */}
      <SystemOpsHub pulse={pulse} />

      {/* ═══ AUTOMATION — kill switches + the one live autopilot flag ═══
          CronControlPanel (cron_control) is the REAL automation control.
          OperatingRhythmToggle owns the single worker-read flag. */}
      <GroupHeading>Automation</GroupHeading>
      <CronControlPanel />
      <OperatingRhythmToggle />

      {/* ═══ AI — live-mutable config + cold memory + tool blocklist ═══ */}
      <GroupHeading>AI</GroupHeading>
      <AiSettingsPanel />
      <IntelligenceFlagsPanel />

      {/* ═══ SCORING — operator-tunable XP weights ═══
          JournalBrain (baseline XP · anti-gaming floor · grounded bonus ·
          auto-confirm · cadence · creative intensity) + People scoring
          (relationship-XP weights). Same live-mutation pattern. */}
      <GroupHeading>Scoring</GroupHeading>
      <JournalBrainPanel />
      <PeopleScoringPanel />

      {/* ═══ SELF-MODEL — 8-axis identity snapshot ═══ */}
      <GroupHeading>Self-model</GroupHeading>
      <IdentityPanel />

      {/* ═══ SKILLS — behavioral pattern curation ═══ */}
      <GroupHeading>Skills</GroupHeading>
      <SkillLibraryPanel />

      {/* ═══ DIAGNOSTICS — admin-tier signal · each self-hides when clean ═══
          HQErrorsCard (top error fingerprints 24h) + SystemHealthCard
          (nightly probe · hidden when overall=healthy) + SystemDataCards
          (sparkline · error-rate · quotas · each empty-hides) + Build
          status (DeployChip SHA/age + CommandSpinePulse). Nothing here
          renders unless there's something worth the operator's attention. */}
      <GroupHeading>Diagnostics</GroupHeading>
      <HQErrorsCard />
      <SystemHealthCard />
      <SystemDataCards />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label">Build status</p>
          <DeployChip />
        </div>
        <CommandSpinePulse />
      </div>

      {/* ═══ PREFERENCES — devices · ticker cache · habits pointer · system info ═══ */}
      <GroupHeading>Preferences</GroupHeading>
      <PushNotificationToggle />
      <TickerDismissalReset />

      {/* Habits · retired v11 — MasteryHabit table dropped Apr 19; habits
          now live as Task rows with loopKind=DAILY. This is a pointer to
          the live surface, not a habit editor. */}
      <GlassCard>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="section-label mb-1">habits</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Habits live as <span className="font-mono text-[var(--gold)]">loopKind=DAILY</span> tasks on the Actions page.
              Add, edit, and check them off there.
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
              Streaks auto-track via <code className="text-[var(--text-secondary)]">streakCount</code>.
              Completion shows up on your daily score + Ultron pulse chips.
            </p>
          </div>
          <Link
            href="/missions"
            className="shrink-0 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-colors"
          >
            manage habits →
          </Link>
        </div>
      </GlassCard>

      <SystemInfoCard />
    </StandardPage>
  );
}
