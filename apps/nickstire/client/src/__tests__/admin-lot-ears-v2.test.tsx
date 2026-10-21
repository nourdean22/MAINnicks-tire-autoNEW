/**
 * Shop ears v2 (job 2026-10-21-shop-ears-v2, contract ears-v2), owner-only UI on Admin > Lot.
 *
 * "Worth knowing today" sits at the top of Office intelligence with the exact words each flag rests
 * on; flagged conversations sort first and carry plain-words labels; guessed parts of an account
 * ("(inferred: ...)") look different from heard parts; a manager sees no flag, account or digest.
 * A failed read is never "Nothing flagged". Same trpc proxy as admin-lot-eyes-ears.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isPending: boolean; isError: boolean; error: unknown; fetchStatus: string };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  calls: new Map<string, { input: unknown; opts: unknown }>(),
  Null: () => null,
}));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown, opts: unknown) => {
    h.calls.set(path, { input, opts });
    return {
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      fetchStatus: "idle",
      refetch: async () => {},
      isFetching: false,
      dataUpdatedAt: Date.now(),
      ...h.queries.get(path),
    };
  };
  const mutation = () => () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery") return query(path);
        if (key === "useMutation") return mutation();
        if (key === "invalidate") return async () => {};
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});
vi.mock("@/pages/admin/CommissioningPanel", () => ({ default: h.Null }));
import LotSection from "@/pages/admin/LotSection";

const REFUSED = { data: { ok: false, reason: "Only the owner can see this." } };
const T0 = Date.UTC(2026, 9, 21, 18, 5); // 2:05 PM in Cleveland

function convo(id: string, startedAtMs: number, extra: Record<string, unknown> = {}) {
  return {
    episodeId: id, source: "office", cameraSerial: null, captureHost: null, triggerType: null, triggeredAtMs: null,
    startedAtMs, durationSeconds: 40, meanVolumeDb: null, transcriptStatus: "DONE", transcriptError: null,
    sttEngine: null, sttModel: null, sttLatencyMs: null, speakerCount: null, coverage: 0.9, factCount: 0, summary: null,
    candidateVehicleVisitId: null, candidateWorkOrderId: null, linkConfidence: null, gist: `Account ${id}.`, visual: null,
    segmentCount: 0, flagKinds: [], facts: [], ...extra,
  };
}

const ITEMS = [
  { episodeId: "e-2", source: "office", cameraLabel: "Office", startedAtMs: T0, kind: "CUSTOMER_COMPLAINT", quote: "this is the second time it came back", account: "A customer says a repair failed again. (inferred: likely the same tire)" },
  { episodeId: "e-1", source: "office", cameraLabel: "Office", startedAtMs: T0 - 3_600_000, kind: "LEAVING_OR_COMPETITOR", quote: "the place down the street is cheaper", account: null },
];

function setOffice({ worth = { data: { ok: true, day: "2026-10-21", items: ITEMS } } as Partial<Q>, rows = [convo("c-1", T0)] as unknown[], digest = { data: { ok: true, generatedAtMs: T0, hours: [] } } as Partial<Q>, wordsVisible = true } = {}) {
  h.queries.set("lot.worthKnowing", worth);
  h.queries.set("lot.officeDigest", digest);
  h.queries.set("lot.conversations", { data: { ok: true, conversations: rows, visualAvailable: false, wordsVisible } });
}

afterEach(() => {
  h.queries.clear();
  h.calls.clear();
});

const block = () => screen.queryByRole("region", { name: "Worth knowing today" });

describe("Worth knowing today", () => {
  it("sits above the hourly digest; each item is a 48 px row with the plain kind, camera, shop time and the quote", () => {
    setOffice();
    render(<LotSection />);
    const b = block()!;
    expect(Boolean(b.compareDocumentPosition(screen.getByRole("region", { name: "Last 6 hours" })) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    const rows = within(b).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("min-h-12");
    expect(rows[0].textContent).toContain("Customer complaint");
    expect(rows[0].textContent).toContain("Office");
    expect(rows[0].textContent).toContain("2:05 PM");
    expect(rows[0].querySelector("q")!.textContent).toBe("this is the second time it came back");
    expect(rows[0].textContent).toContain("A customer says a repair failed again.");
    expect(rows[1].textContent).toContain("Leaving or a competitor");
    expect(rows[1].querySelector("q")!.textContent).toBe("the place down the street is cheaper");
    expect(b.textContent).not.toMatch(/CUSTOMER_COMPLAINT|LEAVING_OR_COMPETITOR/);
  });

  it("polls with the panel's interval", () => {
    setOffice();
    render(<LotSection />);
    expect((h.calls.get("lot.worthKnowing")?.opts as { refetchInterval?: number }).refetchInterval).toBe(15_000);
  });

  it("an empty day says Nothing flagged today", () => {
    setOffice({ worth: { data: { ok: true, day: "2026-10-21", items: [] } } });
    render(<LotSection />);
    expect(within(block()!).getByText("Nothing flagged today.")).toBeTruthy();
  });

  const broken: Array<[string, Partial<Q>, string]> = [
    ["an ok:false failure", { data: { ok: false, reason: "could not compute the shop day's bounds" } }, "could not compute the shop day's bounds"],
    ["a failed read", { data: undefined, isError: true, error: { message: "timeout" } }, "timeout"],
    ["a paused (offline) read", { data: undefined, isPending: true, fetchStatus: "paused" }, "Offline, not checked"],
  ];
  for (const [name, worth, reason] of broken) {
    it(`${name} shows the reason, never Nothing flagged`, () => {
      setOffice({ worth });
      render(<LotSection />);
      expect(block()!.textContent).toContain(reason);
      expect(block()!.textContent).toContain("could not be read");
      expect(screen.queryByText("Nothing flagged today.")).toBeNull();
    });
  }

  it("says loading while the first read is in flight", () => {
    setOffice({ worth: { data: undefined, isPending: true, fetchStatus: "fetching" } });
    render(<LotSection />);
    expect(within(block()!).getByText(/Loading what is worth knowing today/)).toBeTruthy();
  });

  it("a manager sees no block at all", () => {
    setOffice({ worth: REFUSED, wordsVisible: false });
    render(<LotSection />);
    expect(block()).toBeNull();
    expect(screen.queryByText(/Worth knowing/)).toBeNull();
    expect(screen.queryByText("Only the owner can see this.")).toBeNull();
  });
});

describe("flagged conversation cards", () => {
  const cards = () => screen.getAllByText(/^Account c-/).map((el) => el.textContent);

  it("flagged rows sort first, each group keeps its order", () => {
    setOffice({
      rows: [
        convo("c-1", T0),
        convo("c-2", T0 - 60_000, { flagKinds: ["SAFETY"] }),
        convo("c-3", T0 - 120_000),
        convo("c-4", T0 - 180_000, { flagKinds: ["NEGATIVE_TALK", "STAFF_CONFLICT"] }),
      ],
    });
    render(<LotSection />);
    expect(cards()).toEqual(["Heard: Account c-2.", "Heard: Account c-4.", "Heard: Account c-1.", "Heard: Account c-3."]);
  });

  it("shows one plain-words label per kind above the Heard line", () => {
    setOffice({ rows: [convo("c-4", T0, { flagKinds: ["NEGATIVE_TALK", "MONEY_OR_DISCOUNT"] })] });
    render(<LotSection />);
    const negative = screen.getByText("Negative talk");
    expect(negative.className).toContain("text-amber-300");
    expect(screen.getByText("Money or discount")).toBeTruthy();
    expect(Boolean(negative.compareDocumentPosition(screen.getByText("Heard:", { exact: false })) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("flag facts list under their plain-words label with the quote", () => {
    setOffice({
      rows: [convo("c-1", T0, {
        flagKinds: ["LEAVING_OR_COMPETITOR"], factCount: 1,
        facts: [{ kind: "LEAVING_OR_COMPETITOR", value: "the place down the street is cheaper", evidenceText: "honestly the place down the street is cheaper", confidence: 0.9 }],
      })],
    });
    render(<LotSection />);
    const item = within(screen.getByRole("list", { name: "Facts heard" })).getByRole("listitem");
    expect(item.textContent).toContain("Leaving or a competitor: the place down the street is cheaper");
    expect(item.querySelector("q")!.textContent).toBe("honestly the place down the street is cheaper");
  });

  it("a manager's rows (no flagKinds, no gist) show no label", () => {
    setOffice({ worth: REFUSED, wordsVisible: false, rows: [convo("c-1", T0, { gist: null, flagKinds: [] })] });
    render(<LotSection />);
    for (const label of ["Negative talk", "Customer complaint", "Staff conflict", "Safety", "Leaving or a competitor", "Money or discount"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

describe("the account: guesses look like guesses", () => {
  const heard = () => screen.getByText("Heard:", { exact: false }).parentElement!;

  it("an (inferred: ...) span is muted and italic and keeps its exact words", () => {
    setOffice({ rows: [convo("c-1", T0, { gist: "A customer asked about a noise (inferred: likely about a battery) and left." })] });
    render(<LotSection />);
    const span = heard().querySelector("span.italic") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.className).toContain("text-foreground/50");
    const visible = [...span.childNodes].filter((n) => !(n as HTMLElement).classList?.contains("sr-only")).map((n) => n.textContent).join("");
    expect(visible).toBe("(inferred: likely about a battery)");
    expect(span.querySelector(".sr-only")!.textContent).toBe("inferred: ");
    expect(heard().textContent).toContain("A customer asked about a noise ");
    expect(heard().textContent).toContain(" and left.");
  });

  it("an [inaudible: ...] span is muted", () => {
    setOffice({ rows: [convo("c-1", T0, { gist: "They talked [inaudible: about 10 seconds] then paid." })] });
    render(<LotSection />);
    const span = [...heard().querySelectorAll("span")].find((s) => s.textContent === "[inaudible: about 10 seconds]")!;
    expect(span.className).toContain("text-foreground/50");
  });

  it("an unbalanced (inferred: ... renders as plain text", () => {
    setOffice({ rows: [convo("c-1", T0, { gist: "A customer (inferred: likely angry and left." })] });
    render(<LotSection />);
    expect(heard().querySelector("span.italic")).toBeNull();
    expect(heard().textContent).toContain("A customer (inferred: likely angry and left.");
  });

  it("the noise line renders muted, as written", () => {
    setOffice({ rows: [convo("c-1", T0, { gist: "Only shop noise, no speech." })] });
    render(<LotSection />);
    const el = screen.getByText("Only shop noise, no speech.");
    expect(el.className).toContain("text-foreground/50");
  });

  it("markup in an account stays text", () => {
    setOffice({ rows: [convo("c-1", T0, { gist: "<b>loud</b> (inferred: <i>x</i>)" })] });
    render(<LotSection />);
    expect(heard().querySelector("b")).toBeNull();
    expect(heard().textContent).toContain("<b>loud</b>");
  });
});

describe("the hourly digest is the owner's", () => {
  it("a manager gets nothing, not an error card", () => {
    setOffice({ worth: REFUSED, digest: REFUSED, wordsVisible: false });
    render(<LotSection />);
    expect(screen.queryByRole("region", { name: "Last 6 hours" })).toBeNull();
    expect(screen.queryByText("Hourly summary unavailable")).toBeNull();
  });

  it("an owner's real failure still shows the failure (control)", () => {
    setOffice({ digest: { data: { ok: false, reason: "digest table missing" } } });
    render(<LotSection />);
    expect(screen.getByText("Hourly summary unavailable")).toBeTruthy();
    expect(screen.getByText("digest table missing")).toBeTruthy();
  });
});
