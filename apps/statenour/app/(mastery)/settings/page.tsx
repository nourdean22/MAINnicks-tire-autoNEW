"use client";

/**
 * Settings — the operator's live ops console.
 *
 * 2026-07-02 · Elite 200 IQ Split-Pane Redesign.
 * Replaced the massive vertical stack with `SettingsConsole`, separating
 * identity, cognitive settings, automations, and diagnostics into distinct domains.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { useSystemPulse } from "@/lib/hooks/use-system-pulse";
import { SettingsConsole } from "@/components/settings/settings-console";

export default function SettingsPage() {
  const pulse = useSystemPulse();

  return (
    <StandardPage
      eyebrow="Mastery"
      title="settings"
      description="system ops · automation · ai · scoring · preferences"
      rhythm="loose"
    >
      <SettingsConsole pulse={pulse} />
    </StandardPage>
  );
}
