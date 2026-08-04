/**
 * The observability tiles must not render $0.00 spend from a read that failed.
 *
 * `classify` had exactly three outcomes — loading, empty, ready — and never
 * constructed `{ kind: "error" }`. So `TileState`'s error variant and the
 * `ErrorTile` branch in all four tiles were unreachable dead code, and an
 * outage produced one of two lies, neither of them red:
 *
 *  1. a transport failure fell through `data === undefined` into "empty", so
 *     the tile said "no spend recorded yet · endpoint quiet";
 *  2. a SERVER-side read failure returned 200 with `readFailed: true` that
 *     nobody consumed — and because `sparkline7d` is padded with seven
 *     zero-days the emptiness test was FALSE, so the tile classified READY and
 *     drew $0.00, "0% of cap" and a flat emerald band during an outage.
 *
 * WHY THIS WENT UNNOTICED, and why this file exists rather than an addition to
 * tests/components/observability-tiles.test.tsx: that suite's error case
 * hand-constructs `{ kind: "error", message: "500 Internal Server Error" }` and
 * asserts the copy renders. It pins the RENDERER against a literal no producer
 * could emit, so it was green the entire time the channel was dead. These pins
 * are on the PRODUCER.
 */
import { describe, it, expect } from "vitest";
import { classify } from "@/hooks/use-observability";

/** The exact payload buildCostSloSnapshot returns when the burn read fails. */
function outagePayload() {
  return {
    today: { burnCents: 0 },
    budget: { dailyCents: 500 },
    // Seven zero-days, because the per-day catch pushes costCents: 0 rather
    // than skipping. This is what made the emptiness test false.
    sparkline7d: Array.from({ length: 7 }, () => ({ costCents: 0 })),
    forecast: null,
    topConversations: [],
    readFailed: true,
  };
}

const isEmpty = (d: { today?: { burnCents?: number }; sparkline7d?: unknown[] }) =>
  (d.today?.burnCents ?? 0) === 0 && (d.sparkline7d?.length ?? 0) === 0;

describe("classify — the error channel", () => {
  it("reports a TRANSPORT failure as error, not as a quiet endpoint", () => {
    const out = classify(
      { data: undefined, isLoading: false, isError: true, refetch: () => {} },
      isEmpty,
    );
    expect(out.kind).toBe("error");
  });

  it("reports a SERVER read failure as error, not as a ready $0.00", () => {
    // The load-bearing case. Before the fix this returned "ready" and the tile
    // drew a green zero. The 4th argument is the predicate the real cost slice
    // supplies — `(d) => d.readFailed === true`.
    const out = classify(
      { data: outagePayload(), isLoading: false, isError: false, refetch: () => {} },
      isEmpty,
      undefined,
      (d) => (d as { readFailed?: boolean }).readFailed === true,
    );
    expect(out.kind).toBe("error");
    expect(out.kind === "error" && out.message).toMatch(/unknown, not \$0/);
  });

  it("checks the failure flag BEFORE emptiness — the padded sparkline must not mask it", () => {
    // Same payload but genuinely empty-looking; ordering is the whole fix, so
    // it gets its own pin rather than riding on the case above.
    const out = classify(
      {
        data: { today: { burnCents: 0 }, sparkline7d: [], readFailed: true },
        isLoading: false,
        isError: false,
        refetch: () => {},
      },
      isEmpty,
      undefined,
      (d) => (d as { readFailed?: boolean }).readFailed === true,
    );
    expect(out.kind).toBe("error");
  });

  it("still reports READY when the read succeeded — a real zero-spend day", () => {
    // Both directions. A guard that always errors would satisfy the cases
    // above while blanking a healthy tile.
    const out = classify(
      { data: { ...outagePayload(), readFailed: false }, isLoading: false, isError: false, refetch: () => {} },
      isEmpty,
      undefined,
      (d) => (d as { readFailed?: boolean }).readFailed === true,
    );
    expect(out.kind).toBe("ready");
  });

  it("still reports EMPTY when there is genuinely no signal yet", () => {
    const out = classify(
      { data: { today: { burnCents: 0 }, sparkline7d: [] }, isLoading: false, isError: false, refetch: () => {} },
      isEmpty,
    );
    expect(out.kind).toBe("empty");
  });

  it("still reports LOADING on the first fetch", () => {
    const out = classify(
      { data: undefined, isLoading: true, isError: false, refetch: () => {} },
      isEmpty,
    );
    expect(out.kind).toBe("loading");
  });

  it("treats an ABSENT isError as not-an-error, so nothing regresses on shape", () => {
    const out = classify(
      { data: { today: { burnCents: 5 }, sparkline7d: [{ costCents: 5 }] }, isLoading: false, refetch: () => {} },
      isEmpty,
    );
    expect(out.kind).toBe("ready");
  });
});
