"use client";

/**
 * Settings — durable operator configuration.
 *
 * 2026-07-02 · split-pane redesign (`SettingsConsole`).
 * 2026-10-02 · full-circle wave 2: the Diagnostics domain and the cron
 * panel left for /system (docs/design/settings-census-2026-10-02.md); this
 * page no longer reads the system pulse. Machine operations are /system's.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { SettingsConsole } from "@/components/settings/settings-console";

export default function SettingsPage() {
  return (
    <StandardPage
      eyebrow="Mastery"
      title="settings"
      description="identity · scoring · ai · flags · notifications"
      rhythm="loose"
    >
      <SettingsConsole />
    </StandardPage>
  );
}
