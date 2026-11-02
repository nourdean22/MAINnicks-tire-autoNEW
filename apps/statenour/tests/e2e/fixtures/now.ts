/**
 * Fixtures for /now, the W6 intent surface (components/now/intent-surface.tsx). DEMO data only.
 * The page asks nothing on load; a tapped starter intent POSTs /api/intent/compose, answered here
 * in the route's envelope with three cards drawn through the one registry.
 */
import type { ComposeResult } from "@/lib/intent/compose";

import { NOW_ISO } from "./time";

export const NOW_CARD_TITLE = "Order brake pads for the demo sedan";

export const NOW_COMPOSE: { ok: true; data: ComposeResult } = {
  ok: true,
  data: {
    refused: 0,
    failed: 0,
    skipped: 0,
    parts: [
      {
        type: "tool-getTasks",
        state: "output-available",
        output: [
          { id: "demo-t1", title: NOW_CARD_TITLE, status: "READY", dueDate: NOW_ISO, mission: { title: "Demo shop", domain: "BUSINESS" } },
          { id: "demo-t2", title: "Call the demo tire supplier", status: "DOING", dueDate: null, mission: null },
        ],
      },
      {
        type: "tool-getRelationshipPicks",
        state: "output-available",
        output: { picks: [{ personId: "demo-p1", name: "Demo person", why: "Quiet for 12 days", daysQuiet: 12, openPromises: 1, seeingOn: null, maxim: null }], source: "engine", calendar: "ok" },
      },
      {
        type: "tool-getFleetTruth",
        state: "output-available",
        output: {
          ok: true,
          generatedAt: NOW_ISO,
          statenour: [{ capability: "outbox-drain", state: "fresh", ageH: 0.2 }],
          nickstire: [{ capability: "nickstire:health", state: "fresh", ageH: null }],
          allFresh: true,
          queuesClean: true,
        },
      },
    ],
  },
};
