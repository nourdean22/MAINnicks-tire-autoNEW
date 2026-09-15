// Mutation receipt (2026-09-15): memory-inspector.tsx isError branch -> `<InspectorNotice state="not-found" kind="memory" />` (a failed read rendered as empty):
// 1 failed | 5 passed; red: "a FAILED read is the error notice" expected '<div data-inspector-state="not-found"...' to contain 'data-inspector-state="error"'. Restored byte-for-byte (sha256 82ee87cf).
/**
 * MemoryInspector: the one view of a memory, honest in every state
 * (2026-09-15, flagship slice 1).
 *
 * The panel reads `trpc.brain.memoryById` and must render four different
 * things for four different facts: in flight, the read FAILED (compact code
 * only, never the raw message, which is a user-visible sink), the read
 * succeeded and found nothing, and the record itself. The TIME slot is the
 * quiet half: validity interval and supersession are code-live but
 * data-empty today (docs/CURRENT-TRUTH.md BDN-310), so when absent it must
 * say so instead of inventing a date.
 *
 * Asserted on RENDERED MARKUP, Node env, `renderToStaticMarkup`, with the
 * tRPC client stubbed through a mutable query object (the pattern from
 * tests/components/pinned-context-panel.test.tsx). The loaded record is the
 * positive control: a panel that always rendered a notice would pass the
 * three failure cases and fail it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemoryDetail } from "@/lib/services/brain/memory-detail";

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
    brain: { memoryById: { useQuery: () => stubs.query } },
  },
}));

// useInspector() and EntityActionRow both read the app router, which
// renderToStaticMarkup has no context for.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/brain",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { MemoryInspector } from "@/components/inspector/panels/memory-inspector";

const ENTITY = { kind: "memory", id: "mem-1" } as const;
const ISO = "2026-09-01T00:00:00.000Z";

const MEMORY: MemoryDetail = {
  id: "mem-1",
  category: "identity",
  key: "communication_dna",
  content: "Direct, terse, action-first.",
  source: "chat",
  evidence: "operator_stated",
  trustTier: "OPERATOR",
  confidence: 0.9,
  seenCount: 4,
  createdBy: null,
  createdAt: ISO,
  updatedAt: ISO,
  lastSeen: ISO,
  expiresAt: null,
  validFrom: null,
  validUntil: null,
  lastVerifiedAt: null,
  supersededBy: null,
  supersedes: [],
  discoveryVerdict: null,
};

function render(state: Partial<QueryStub>): string {
  stubs.query = { ...stubs.blank(), ...state };
  return renderToStaticMarkup(<MemoryInspector entity={ENTITY} mode="inspect" />);
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
  // Reality Mode is off here by construction: a static render reads the
  // store's creation-time state (zustand v5 serves getInitialState() as the
  // server snapshot; see evidence-mark-modes.test.tsx), so the header chip
  // and the inline PROOF section are asserted on text both forms carry.
});

describe("MemoryInspector / honest non-content states", () => {
  it("a read in flight is the loading notice, not an empty record", () => {
    const html = render({ isLoading: true });
    expect(html).toContain('data-inspector-state="loading"');
    expect(html).not.toContain("data-memory-inspector");
  });

  it("a FAILED read is the error notice with the compact code, never the raw message", () => {
    const html = render({
      isError: true,
      error: { code: "INTERNAL", name: "TRPCClientError", message: "boom" },
    });
    expect(html).toContain('data-inspector-state="error"');
    expect(html).toContain("INTERNAL");
    expect(html).not.toContain("boom");
    expect(html).not.toContain('data-inspector-state="not-found"');
    expect(html).not.toContain("data-memory-inspector");
  });

  it("a read that succeeded and found nothing is not-found, with the action row still offered", () => {
    const html = render({ data: null });
    expect(html).toContain('data-inspector-state="not-found"');
    expect(html).not.toContain('data-inspector-state="error"');
    expect(html).toContain('data-entity-actions="1"');
    expect(html).not.toContain("data-memory-inspector");
  });
});

describe("MemoryInspector / a loaded memory", () => {
  it("POSITIVE CONTROL: renders the record, its evidence chip and its attention facts", () => {
    const html = render({ data: MEMORY });
    expect(html).toContain('data-memory-inspector="mem-1"');
    expect(html).not.toContain("data-inspector-state");
    const body = text(html);
    expect(body).toContain("Direct, terse, action-first.");
    expect(body).toContain("identity");
    expect(body).toContain("you stated");
    expect(body).toContain("seen");
    expect(body).toContain("4\u00d7");
  });

  it("with no interval and no supersession the TIME slot says so instead of inventing a date", () => {
    const html = render({ data: MEMORY });
    expect(html).toContain('data-memory-time="absent"');
    const body = text(html);
    expect(body).toContain("no validity interval or supersession recorded");
    expect(body).not.toContain("believed since");
    expect(body).not.toContain("superseded by");
  });

  it("with a validity start and a successor the TIME slot is present and names the newer memory", () => {
    const html = render({
      data: { ...MEMORY, validFrom: ISO, supersededBy: { id: "m2", content: "newer", createdAt: ISO } },
    });
    expect(html).toContain('data-memory-time="present"');
    expect(html).toMatch(/superseded by\s*<button[^>]*>newer<\/button>/);
    const body = text(html);
    expect(body).toContain("believed since");
    expect(body).toContain("superseded by");
    expect(body).toContain("newer");
    expect(body).not.toContain("no validity interval or supersession recorded");
  });
});
