// Mutation receipt (2026-09-15): person-inspector.tsx contactGapMetric(null) -> `{ status: "ok", value: 0, ... }` (a confident zero over no data):
// 2 failed | 4 passed; red: expected { status: 'ok', value: +0, ...(2) } to match object { status: 'unavailable', ...(1) }, and expected markup to contain 'data-metric-status="unavailable"'. Restored byte-for-byte (sha256 786ad2e0).
/**
 * PersonInspector: usual cadence vs current gap, as a Metric with a
 * baseline, never a colour and never a fabricated zero (2026-09-15,
 * flagship slice 3).
 *
 * `contactGapMetric` is the pure core: no interaction on record is
 * `unavailable` (NO_INTERACTION), an unparseable date is `unavailable`
 * (BAD_DATE), and only a real date measures a day count. The panel renders
 * that through <Metric />, whose `unavailable` branch prints "unknown"
 * where the number would be. Both halves are asserted here: the function
 * by its result shape, the panel by RENDERED MARKUP (Node env,
 * `renderToStaticMarkup`, tRPC stubbed through a mutable query object as
 * in tests/components/pinned-context-panel.test.tsx).
 *
 * The measured profile is the positive control: a panel that always said
 * "unknown" would pass the no-interaction case and fail it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

const stubs = vi.hoisted(() => {
  const blank = (): QueryStub => ({ data: undefined, isLoading: false, isError: false, error: null });
  return { query: blank(), blank };
});

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: { personProfile: { useQuery: () => stubs.query } },
  },
}));

// useInspector() and EntityActionRow both read the app router, which
// renderToStaticMarkup has no context for.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { PersonInspector, contactGapMetric } from "@/components/inspector/panels/person-inspector";

const DAY = 86_400_000;
const ENTITY = { kind: "person", id: "p1" } as const;

interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  lastInteraction: string | null;
  cadenceDays: number | null;
}

/**
 * The component measures against its own `new Date()`, so the fixture sits
 * 29.5 days back: floor() reads 29 whichever millisecond the render lands
 * on, and the assertion cannot flake across a day boundary.
 */
function profile(person: Partial<PersonRow> = {}) {
  return {
    person: {
      id: "p1",
      name: "Mumu",
      role: "close_friend",
      relationship: "brother",
      lastInteraction: new Date(Date.now() - 29.5 * DAY).toISOString(),
      cadenceDays: 10,
      ...person,
    },
    ledger: [],
    plays: [],
    openTasks: [],
    applicableLawTexts: [],
    xp: 0,
  };
}

function render(state: Partial<QueryStub>): string {
  stubs.query = { ...stubs.blank(), ...state };
  return renderToStaticMarkup(<PersonInspector entity={ENTITY} mode="inspect" />);
}

/** HTML entities get in the way of plain-string assertions. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  stubs.query = stubs.blank();
});

describe("contactGapMetric / pure", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  it("no interaction on record is unavailable, not a zero-day gap", () => {
    expect(contactGapMetric(null, now)).toMatchObject({ status: "unavailable", errorCode: "NO_INTERACTION" });
    expect(contactGapMetric(undefined, now)).toMatchObject({ status: "unavailable", errorCode: "NO_INTERACTION" });
  });

  it("a date 29 days before now measures 29", () => {
    const last = new Date(now.getTime() - 29 * DAY).toISOString();
    expect(contactGapMetric(last, now)).toMatchObject({ status: "ok", value: 29 });
  });

  it("an unparseable date is unavailable with BAD_DATE", () => {
    expect(contactGapMetric("not a date", now)).toMatchObject({ status: "unavailable", errorCode: "BAD_DATE" });
  });
});

describe("PersonInspector / cadence vs gap", () => {
  it("POSITIVE CONTROL: a measured gap renders the number and its delta vs usual cadence", () => {
    const html = render({ data: profile() });
    expect(html).toContain('data-person-inspector="p1"');
    expect(html).toContain('data-metric-status="measured"');
    expect(html).toMatch(/tabular-nums[^"]*">29<\/span>/);
    const body = text(html);
    expect(body).toContain("Mumu");
    expect(body).toContain("brother");
    expect(body).toContain("+19 (+190%) vs usual cadence 10d");
    expect(body).toContain("none open");
    expect(body).not.toContain("unknown");
  });

  it("no interaction on record renders 'unknown' where the number would be - never a 0", () => {
    const html = render({ data: profile({ lastInteraction: null }) });
    expect(html).toContain('data-person-inspector="p1"');
    expect(html).toContain('data-metric-status="unavailable"');
    expect(html).toMatch(/tabular-nums[^"]*">unknown<\/span>/);
    expect(html).not.toMatch(/tabular-nums[^"]*">0<\/span>/);
    const body = text(html);
    expect(body).toContain("Mumu");
    expect(body).toContain("read failed (NO_INTERACTION)");
    expect(body).not.toContain("vs usual cadence");
    expect(body).toContain("no interaction recorded");
  });

  it("a FAILED profile read is the error notice with a compact code, not an empty person", () => {
    const html = render({
      isError: true,
      error: { code: "INTERNAL", name: "TRPCClientError", message: "boom" },
    });
    expect(html).toContain('data-inspector-state="error"');
    expect(html).toContain("INTERNAL");
    expect(html).not.toContain("boom");
    expect(html).not.toContain("data-person-inspector");
    expect(html).not.toContain("data-metric-status");
  });
});
