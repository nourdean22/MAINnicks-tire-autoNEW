/**
 * Fixtures for the (mastery) shell, which every page mounts: the bottom pulse
 * strip reads operator.personalPulse, operator.ticker and (home-pulse W3) operator.pulseFeed. DEMO data only.
 * Everything else the shell asks for is deliberately NOT stubbed (see index.ts).
 */
import type { PulsePayload } from "@/lib/services/personal-pulse";
import type { TickerPayload } from "@/lib/services/ultron-ticker";
import type { PulseFeed } from "@/lib/home/pulse-feed";

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

/** No signals waiting: the sheet and strip render exactly as before W3, so the v3 visual baselines hold. */
export const SHELL_SIGNALS: PulseFeed = { total: 0, groups: [] };
