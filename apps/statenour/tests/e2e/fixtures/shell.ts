/**
 * Fixtures for the (mastery) shell, which every page mounts: the bottom pulse
 * strip reads operator.personalPulse and operator.ticker. DEMO data only.
 * Everything else the shell asks for is deliberately NOT stubbed (see index.ts).
 */
import type { PulsePayload } from "@/lib/services/personal-pulse";
import type { TickerPayload } from "@/lib/services/ultron-ticker";

import { NOW_ISO } from "./time";

export const SHELL_PULSE: PulsePayload = {
  items: [
    {
      id: "demo-pulse-mit",
      kind: "mit",
      glyph: "◆",
      label: "MIT",
      text: "Demo MIT: send the demo supplier quote",
      tone: "info",
      href: "/missions",
    },
  ],
  generatedAt: NOW_ISO,
};

/** Healthy and empty: no market or shop feed in the demo world, and no softError. */
export const SHELL_TICKER: TickerPayload = { items: [], generatedAt: NOW_ISO };
