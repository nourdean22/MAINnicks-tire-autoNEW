"use client";

import { StandardPage } from "@/components/layout/standard-page";
import { CockpitObservabilityView } from "@/components/system/cockpit-observability-view";

export default function CockpitObservabilityPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS · AI & Brain"
      title="cockpit observability"
      description="Live metrics, execution traces, semantic memory decay, and prompt versioning manager for the Nick agent."
      width="2xl"
      rhythm="loose"
    >
      <CockpitObservabilityView />
    </StandardPage>
  );
}
