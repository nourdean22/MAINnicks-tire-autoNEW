"use client";

/**
 * SettingsConsole: durable operator configuration, nothing else. Its one decision is "change one
 * behavior".
 *
 * Ownership test (full-circle wave 2, 2026-10-02 · docs/design/settings-census-2026-10-02.md):
 * a block belongs here when it writes a preference the runtime READS back
 * (identity pins, journal weights, people scoring, AI config, style preferences, feature flags,
 * operating rhythm, push subscription, the ticker's dismissed set). Machine
 * operations (health, errors, crons, deploys, hub navigation) belong to
 * /system and its subpages, where the same data already had a home:
 *
 *   SystemOpsHub        -> duplicate of /system's SystemHubGrid (deleted)
 *   HQErrorsCard        -> /system control tower + /system/logs?view=errors (deleted)
 *   SystemInfoCard      -> /system hub chips carry tools + brain status (deleted)
 *   CommandSpinePulse   -> linked to /system from a page about to be /system (deleted)
 *   SystemHealthCard    -> /system/health (moved)
 *   SystemDataCards     -> /system/health (health trend · error rate · quotas) + /brain (memory of the day)
 *   DeployChip          -> /system header (moved)
 *   CronControlPanel    -> /system/crons already owns the kill switch + run-now (deleted; runbook links ported)
 *   SkillLibraryPanel   -> /brain self-model already mounts it (second mount removed)
 *   IdentityPanel       -> stays HERE (Identity and behavior); /brain links to it (UI v3 W5a)
 *   PreferencesCard     -> HERE since wave E2, in How Nick works (it was parked in the /brain Self-model fold)
 *
 * Wave E2 (2026-10-24, census 3J): the three domains used to sit behind a switcher, a sidebar inside
 * the page on a phone, with an "Elsewhere" link list (the Command sheet's links again) and a generic
 * Cpu / Zap glyph tile over each domain. Now three headed groups in one scroll, every panel mounted
 * at once. Each group is a labelled region (useId + role=region + aria-labelledby), pinned by
 * tests/components/mobile-a11y.test.tsx and tests/components/settings/settings-e2-groups.test.tsx.
 */

import { useId, type ReactNode } from "react";
import { AiSettingsPanel } from "@/components/settings/ai-settings-panel";
import { IntelligenceFlagsPanel } from "@/components/settings/intelligence-flags-panel";
import { PeopleScoringPanel } from "@/components/settings/people-scoring-panel";
import { JournalBrainPanel } from "@/components/settings/journal-brain-panel";
import { NotebookLMContextZone } from "@/components/settings/notebooklm-context-zone";
import { IdentityPanel } from "@/components/settings/identity-panel";
import { OperatingRhythmToggle } from "@/components/settings/operating-rhythm-toggle";
import { PushNotificationToggle } from "@/components/settings/push-notification-toggle";
import { TickerDismissalReset } from "@/components/settings/ticker-dismissal-card";
import { PreferencesCard } from "@/components/ultron/preferences-card";

function SettingsGroup({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section role="region" aria-labelledby={headingId} className="space-y-5 border-t border-edge-subtle pt-6 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        {/* h2: the page's one h1 is StandardPage's "Settings" (audit 09-F18). */}
        <h2 id={headingId} className="text-[17px] font-semibold text-fg">
          {label}
        </h2>
        <p className="text-[14px] text-fg-secondary">{description}</p>
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function SettingsConsole() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-10">
      <SettingsGroup label="Identity and behavior" description="Who you are, how you score the world, and your behavioral baselines.">
        <IdentityPanel />
        <JournalBrainPanel />
        <NotebookLMContextZone />
        <PeopleScoringPanel />
      </SettingsGroup>
      <SettingsGroup label="How Nick works" description="Reasoning depth and tool access, the style dials Nick reads, feature flags, and his operating rhythm.">
        <AiSettingsPanel />
        <PreferencesCard />
        <IntelligenceFlagsPanel />
        <OperatingRhythmToggle />
      </SettingsGroup>
      <SettingsGroup label="Notifications" description="Push notifications and the ticker's dismissed items. Crons live on /system/crons.">
        <PushNotificationToggle />
        <TickerDismissalReset />
      </SettingsGroup>
    </div>
  );
}
