"use client";

import { useState, useId } from "react";
import { cn } from "@/lib/utils";
import { User, Cpu, Zap, Activity, type LucideIcon } from "lucide-react";
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

type DomainId = "identity" | "cognitive" | "automation" | "diagnostics";

interface DomainConfig {
  id: DomainId;
  label: string;
  icon: LucideIcon;
  description: string;
}

const DOMAINS: DomainConfig[] = [
  {
    id: "identity",
    label: "Identity & Behavior",
    icon: User,
    description: "Who you are, how you score the world, and behavioral baselines.",
  },
  {
    id: "cognitive",
    label: "Cognitive Engine",
    icon: Cpu,
    description: "AI reasoning depth, tool access, and agent operating rhythm.",
  },
  {
    id: "automation",
    label: "Automations",
    icon: Zap,
    description: "Background crons, push notifications, and ticker cache.",
  },
  {
    id: "diagnostics",
    label: "System Diagnostics",
    icon: Activity,
    description: "Hardware telemetry, live errors, and build status.",
  },
];

export function SettingsConsole({ pulse }: { pulse: any }) {
  const [activeDomain, setActiveDomain] = useState<DomainId>("identity");
  const headingId = useId();

  const activeConfig = DOMAINS.find((d) => d.id === activeDomain);

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start w-full relative">
      {/* LEFT PANE: Navigation Matrix */}
      <aside className="w-full lg:w-64 shrink-0 flex flex-col gap-2 sticky top-6">
        <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/70 px-2 pb-2">
          Domains
        </h2>
        <nav className="flex flex-col gap-1">
          {DOMAINS.map((domain) => {
            const isActive = activeDomain === domain.id;
            const Icon = domain.icon;
            return (
              <button
                key={domain.id}
                onClick={() => setActiveDomain(domain.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-all",
                  isActive
                    ? "bg-[var(--gold)]/10 text-[var(--gold)] font-medium border border-[var(--gold)]/20"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] border border-transparent"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-[var(--gold)]" : "opacity-70")} />
                {domain.label}
              </button>
            );
          })}
        </nav>

        {/* Pointer for Habits */}
        <div className="mt-8 px-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-2">
            Links
          </p>
          <Link
            href="/missions"
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] transition-colors py-1"
          >
            Manage Habits ↗
          </Link>
        </div>
      </aside>

      {/* RIGHT PANE: Execution Console */}
      <div 
        className="flex-1 w-full flex flex-col gap-6 lg:border-l lg:border-[var(--border-default)] lg:pl-8 lg:min-h-[600px]"
        role="region" 
        aria-labelledby={headingId}
      >
        {/* Domain Header (AI Context Zone) */}
        {activeConfig && (
          <div className="mb-2 pb-6 border-b border-[var(--border-default)]">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-[var(--gold)]/10 text-[var(--gold)]" aria-hidden="true">
                <activeConfig.icon className="w-5 h-5" />
              </div>
              <h1 id={headingId} className="text-xl font-bold text-[var(--text-primary)]">
                {activeConfig.label}
              </h1>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {activeConfig.description}
            </p>
          </div>
        )}

        {/* Dynamic Content */}
        <div className="flex flex-col gap-6 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeDomain === "identity" && (
            <>
              <IdentityPanel />
              <JournalBrainPanel />
              <PeopleScoringPanel />
              <SkillLibraryPanel />
            </>
          )}

          {activeDomain === "cognitive" && (
            <>
              <AiSettingsPanel />
              <IntelligenceFlagsPanel />
              <OperatingRhythmToggle />
            </>
          )}

          {activeDomain === "automation" && (
            <>
              <CronControlPanel />
              <PushNotificationToggle />
              <TickerDismissalReset />
            </>
          )}

          {activeDomain === "diagnostics" && (
            <>
              <SystemOpsHub pulse={pulse} />
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
              <SystemInfoCard />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
