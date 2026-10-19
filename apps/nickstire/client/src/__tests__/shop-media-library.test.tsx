/**
 * Shop media library, client side (job 2026-10-18-shop-media-library).
 *
 * Three surfaces over the shopMedia contract (shared/shopMedia.ts):
 *  - ShopMediaSection: review quarantined media on a phone, two-tap approve/reject in the DOM,
 *    skipped reasons in words, a failed or paused read never renders an empty grid.
 *  - StudioV2 real-shop grid: Photos / Videos toggle and Load more (cursor + 100).
 *  - RealClipPicker: a reel beat binds an approved vertical clip (source real + realAssetId).
 *
 * "@/lib/trpc" is a proxy that records every hook input by dotted path, so a test asserts what
 * was ASKED of the server, not only what rendered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import React from "react";
import type { ShopMediaItem, ShopMediaReviewResult, ShopMediaStats } from "@shared/shopMedia";

const h = vi.hoisted(() => ({
  queries: new Map<string, Record<string, unknown>>(),
  inputs: new Map<string, unknown[]>(),
  reviewCalls: [] as unknown[],
  reviewResult: null as unknown,
  reviewError: null as Error | null,
  refetch: { list: vi.fn(), stats: vi.fn() },
  fetchNextPage: vi.fn(),
  Null: () => null,
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown) => {
    h.inputs.set(path, [...(h.inputs.get(path) ?? []), input]);
    return {
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      fetchStatus: "idle",
      refetch: () => {},
      isFetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: h.fetchNextPage,
      ...h.queries.get(path),
    };
  };
  const mutation = (path: string) => (opts: any) => {
    if (path !== "shopMedia.review") return { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, reset: () => {} };
    return {
      isPending: false,
      mutate: (input: unknown) => {
        h.reviewCalls.push(input);
        if (h.reviewError) opts?.onError?.(h.reviewError, input);
        else opts?.onSuccess?.(h.reviewResult, input);
      },
    };
  };
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation(path);
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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
vi.mock("@/components/admin/CampaignPackageCard", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Studio", () => ({ default: h.Null }));

import ShopMediaSection from "@/pages/admin/ShopMediaSection";
import RealClipPicker from "@/pages/admin/instagram/RealClipPicker";
import StudioV2 from "@/pages/admin/instagram/StudioV2";

// editRecipe is the contract field the server lane is adding (PR 3177 review); the intersection compiles before and after it lands.
type Item = ShopMediaItem & { editRecipe: string | null };
const item = (over: Partial<Item>): Item => ({
  assetId: "a1",
  url: "https://cdn.test/a1.jpg",
  kind: "photo",
  width: 1080,
  height: 1350,
  durationMs: null,
  capturedAt: "2026-10-01T12:00:00Z",
  subject: "Brake rotor on the lift",
  tags: ["brakes"],
  faces: 0,
  moe: false,
  people: "none",
  plate: false,
  quality: 4,
  rightsStatus: "real_shop",
  lifecycleState: "quarantined",
  reuseAllowed: false,
  editRecipe: null,
  ...over,
});

const QUARANTINED_PHOTO = item({ assetId: "q-photo" });
const QUARANTINED_VIDEO = item({
  assetId: "q-video", kind: "video", url: "https://cdn.test/q.mp4", width: 1080, height: 1920,
  durationMs: 12_400, subject: "Tire mount and balance", tags: ["tires"], faces: 1, moe: true, plate: true, people: "staff",
});
const APPROVED_HORIZONTAL = item({
  assetId: "ok-wide", kind: "video", url: "https://cdn.test/w.mp4", width: 1920, height: 1080, durationMs: 8_000,
  subject: "Bay overview", lifecycleState: "available", reuseAllowed: true,
});
const APPROVED_VERTICAL = item({
  assetId: "ok-tall", kind: "video", url: "https://cdn.test/t.mp4", width: 1080, height: 1920, durationMs: 65_000,
  subject: "Lug nuts torqued", lifecycleState: "available", reuseAllowed: true,
});
const REJECTED = item({ assetId: "no-1", subject: "Blurry lot shot", lifecycleState: "rejected" });

const STATS: ShopMediaStats = {
  quarantined: { photo: 3, video: 2 },
  approved: { photo: 1, video: 4 },
  rejected: { photo: 1, video: 0 },
  other: { photo: 0, video: 0 },
};

const listPage = (items: ShopMediaItem[], nextCursor: number | null = null) => ({
  data: { pages: [{ items, nextCursor }], pageParams: [0] },
  refetch: h.refetch.list,
});

const lastInput = (path: string) => (h.inputs.get(path) ?? []).at(-1);

beforeEach(() => {
  h.queries.clear();
  h.inputs.clear();
  h.reviewCalls.length = 0;
  h.reviewError = null;
  vi.mocked(toast.error).mockClear();
  h.reviewResult = { changed: [], skipped: [] } satisfies ShopMediaReviewResult;
  h.refetch.list.mockClear();
  h.refetch.stats.mockClear();
  h.fetchNextPage.mockClear();
  h.queries.set("shopMedia.stats", { data: STATS, refetch: h.refetch.stats });
});

describe("ShopMediaSection: review on a phone", () => {
  it("shows the three tabs with counts from shopMedia.stats", () => {
    h.queries.set("shopMedia.list", listPage([QUARANTINED_PHOTO]));
    render(<ShopMediaSection />);
    const tabs = screen.getByRole("tablist", { name: /review state/i });
    expect(within(tabs).getByRole("tab", { name: /quarantined 5/i })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /approved 5/i })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /rejected 1/i })).toBeTruthy();
    expect(lastInput("shopMedia.list")).toMatchObject({ state: "quarantined" });
  });

  it("a failed stats read shows the count as unknown, never 0", () => {
    h.queries.set("shopMedia.stats", { data: undefined, isError: true, refetch: h.refetch.stats });
    h.queries.set("shopMedia.list", listPage([QUARANTINED_PHOTO]));
    render(<ShopMediaSection />);
    const tab = screen.getByRole("tab", { name: /quarantined/i });
    expect(tab.textContent).not.toMatch(/\b0\b/);
    expect(within(tab).getByLabelText(/count unknown/i)).toBeTruthy();
  });

  it("approve is two taps in the DOM and sends decision approve for the selected ids", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    h.queries.set("shopMedia.list", listPage([QUARANTINED_PHOTO, QUARANTINED_VIDEO]));
    h.reviewResult = { changed: ["q-photo"], skipped: [] };
    render(<ShopMediaSection />);
    const grid = screen.getByRole("region", { name: /shop media items/i });
    fireEvent.click(within(grid).getByRole("button", { name: /brake rotor on the lift/i }));
    const bar = screen.getByRole("region", { name: /selection/i });
    expect(within(bar).getByText(/1 selected/i)).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: /^approve$/i }));
    expect(h.reviewCalls).toEqual([]);
    fireEvent.click(within(bar).getByRole("button", { name: /confirm approve/i }));
    expect(h.reviewCalls).toEqual([{ assetIds: ["q-photo"], decision: "approve" }]);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("reject is two taps and sends decision reject", () => {
    h.queries.set("shopMedia.list", listPage([QUARANTINED_PHOTO, QUARANTINED_VIDEO]));
    render(<ShopMediaSection />);
    const grid = screen.getByRole("region", { name: /shop media items/i });
    fireEvent.click(within(grid).getByRole("button", { name: /tire mount and balance/i }));
    const bar = screen.getByRole("region", { name: /selection/i });
    fireEvent.click(within(bar).getByRole("button", { name: /^reject$/i }));
    expect(h.reviewCalls).toEqual([]);
    fireEvent.click(within(bar).getByRole("button", { name: /keep/i }));
    expect(h.reviewCalls).toEqual([]);
    fireEvent.click(within(bar).getByRole("button", { name: /^reject$/i }));
    fireEvent.click(within(bar).getByRole("button", { name: /confirm reject/i }));
    expect(h.reviewCalls).toEqual([{ assetIds: ["q-video"], decision: "reject" }]);
  });

  it("after review, skipped reasons are shown in words and the list and counts refetch", () => {
    h.queries.set("shopMedia.list", listPage([QUARANTINED_PHOTO, QUARANTINED_VIDEO]));
    h.reviewResult = { changed: ["q-photo"], skipped: [{ assetId: "q-video", reason: "changed_concurrently:approved" }] };
    render(<ShopMediaSection />);
    const grid = screen.getByRole("region", { name: /shop media items/i });
    fireEvent.click(within(grid).getByRole("button", { name: /brake rotor on the lift/i }));
    fireEvent.click(within(grid).getByRole("button", { name: /tire mount and balance/i }));
    const bar = screen.getByRole("region", { name: /selection/i });
    fireEvent.click(within(bar).getByRole("button", { name: /^approve$/i }));
    fireEvent.click(within(bar).getByRole("button", { name: /confirm approve/i }));
    const result = screen.getByRole("status", { name: /review result/i });
    expect(within(result).getByText(/1 approved/i)).toBeTruthy();
    expect(within(result).getByText(/1 skipped/i)).toBeTruthy();
    expect(within(result).getByText(/tire mount and balance/i)).toBeTruthy();
    expect(within(result).getByText(/changed by someone else, now approved/i)).toBeTruthy();
    expect(h.refetch.list).toHaveBeenCalled();
    expect(h.refetch.stats).toHaveBeenCalled();
  });

  it("a failed list read renders could not load with a retry, never an empty grid", () => {
    h.queries.set("shopMedia.list", { data: undefined, isError: true, error: new Error("db down"), refetch: h.refetch.list });
    render(<ShopMediaSection />);
    expect(screen.getByText(/could not load shop media/i)).toBeTruthy();
    expect(screen.queryByText(/nothing (is )?(quarantined|here)/i)).toBeNull();
    expect(screen.queryByRole("region", { name: /shop media items/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.refetch.list).toHaveBeenCalled();
  });

  it("a paused (offline) read with no data says so and is not an empty grid", () => {
    h.queries.set("shopMedia.list", { data: undefined, isPending: true, fetchStatus: "paused", refetch: h.refetch.list });
    render(<ShopMediaSection />);
    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(screen.queryByText(/nothing (is )?(quarantined|here)/i)).toBeNull();
  });

  it("an empty successful read says so in words", () => {
    h.queries.set("shopMedia.list", listPage([]));
    render(<ShopMediaSection />);
    expect(screen.getByText(/nothing is quarantined/i)).toBeTruthy();
  });

  it("filters reach the list input, and Load more asks for the next page", () => {
    h.queries.set("shopMedia.list", { ...listPage([QUARANTINED_PHOTO], 48), hasNextPage: true });
    render(<ShopMediaSection />);
    fireEvent.click(screen.getByRole("button", { name: /^videos$/i }));
    fireEvent.change(screen.getByLabelText(/orientation/i), { target: { value: "vertical" } });
    fireEvent.change(screen.getByLabelText(/people/i), { target: { value: "staff" } });
    expect(lastInput("shopMedia.list")).toMatchObject({ state: "quarantined", kind: "video", orientation: "vertical", people: "staff" });
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(h.fetchNextPage).toHaveBeenCalled();
  });

  it("the rejected tab offers no approve verb", () => {
    h.queries.set("shopMedia.list", listPage([REJECTED]));
    render(<ShopMediaSection />);
    fireEvent.click(screen.getByRole("tab", { name: /rejected/i }));
    expect(lastInput("shopMedia.list")).toMatchObject({ state: "rejected" });
    fireEvent.click(within(screen.getByRole("region", { name: /shop media items/i })).getByRole("button", { name: /blurry lot shot/i }));
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
  });

  it("an AI-edited item carries an explicit badge and its edit recipe; a captured one does not", () => {
    h.queries.set("shopMedia.list", listPage([
      item({ assetId: "ai-1", subject: "Repainted sign", rightsStatus: "ai_generated", editRecipe: "repaint: Moe sign to Nick's" }),
      QUARANTINED_PHOTO,
    ]));
    render(<ShopMediaSection />);
    const grid = screen.getByRole("region", { name: /shop media items/i });
    const ai = within(grid).getByRole("button", { name: /repainted sign/i });
    expect(within(ai).getByText("AI edited")).toBeTruthy();
    expect(within(ai).getByText(/repaint: moe sign to nick's/i)).toBeTruthy();
    expect(ai.getAttribute("aria-label")).toMatch(/ai edited/i);
    const real = within(grid).getByRole("button", { name: /brake rotor on the lift/i });
    expect(within(real).queryByText("AI edited")).toBeNull();
  });

  it("a rights status other than real_shop or AI is named as itself", () => {
    h.queries.set("shopMedia.list", listPage([item({ assetId: "odd", subject: "Stock wheel", rightsStatus: "licensed_stock" })]));
    render(<ShopMediaSection />);
    expect(within(screen.getByRole("button", { name: /stock wheel/i })).getByText("licensed_stock")).toBeTruthy();
  });

  it("a failed review refetches list and counts and says the list was refreshed", () => {
    h.queries.set("shopMedia.list", listPage([QUARANTINED_PHOTO]));
    h.reviewError = new Error("conflict");
    render(<ShopMediaSection />);
    fireEvent.click(within(screen.getByRole("region", { name: /shop media items/i })).getByRole("button", { name: /brake rotor on the lift/i }));
    const bar = screen.getByRole("region", { name: /selection/i });
    fireEvent.click(within(bar).getByRole("button", { name: /^approve$/i }));
    fireEvent.click(within(bar).getByRole("button", { name: /confirm approve/i }));
    expect(h.refetch.list).toHaveBeenCalled();
    expect(h.refetch.stats).toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/some items may have changed, list refreshed/i);
  });

  it("a video card shows its duration as m:ss", () => {
    h.queries.set("shopMedia.list", listPage([QUARANTINED_VIDEO]));
    render(<ShopMediaSection />);
    expect(screen.getByText("0:12")).toBeTruthy();
  });
});

describe("StudioV2 real-shop grid: Photos / Videos and Load more", () => {
  it("the default call is unchanged, Videos asks for format video, Load more passes cursor 100", () => {
    h.queries.set("instagramStudio.listRealShopMedia", {
      data: [{ id: "m1", logicalKey: "k1", url: "https://cdn.test/m1.jpg", originalFilename: "m1.jpg" }],
    });
    render(<StudioV2 />);
    const inputs = () => h.inputs.get("instagramStudio.listRealShopMedia") ?? [];
    expect(inputs()[0]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /^videos$/i }));
    expect(inputs().at(-1)).toEqual({ format: "video" });
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(inputs()).toContainEqual({ format: "video", cursor: 100 });
  });
});

describe("RealClipPicker: a reel beat binds an approved vertical clip", () => {
  it("lists approved vertical videos only and sets source real + realAssetId on pick", () => {
    h.queries.set("shopMedia.list", listPage([APPROVED_VERTICAL]));
    const onChange = vi.fn();
    render(<RealClipPicker beat={{ beatNumber: 2, visual: "torque the lug nuts" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /use real clip/i }));
    expect(lastInput("shopMedia.list")).toMatchObject({ state: "approved", kind: "video", orientation: "vertical", bindable: true });
    fireEvent.click(screen.getByRole("button", { name: /lug nuts torqued/i }));
    expect(onChange).toHaveBeenCalledWith({ source: "real", realAssetId: "ok-tall", sourceBeforeRealClip: null });
  });

  it("select then remove on a deterministic beat restores deterministic", () => {
    h.queries.set("shopMedia.list", listPage([APPROVED_VERTICAL]));
    const onChange = vi.fn();
    const start = { beatNumber: 4, visual: "price card", source: "deterministic" as const };
    const { rerender } = render(<RealClipPicker beat={start} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /use real clip/i }));
    fireEvent.click(screen.getByRole("button", { name: /lug nuts torqued/i }));
    const picked = onChange.mock.calls.at(-1)![0];
    expect(picked).toEqual({ source: "real", realAssetId: "ok-tall", sourceBeforeRealClip: "deterministic" });
    rerender(<RealClipPicker beat={{ ...start, ...picked }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove clip/i }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ source: "deterministic", realAssetId: undefined, sourceBeforeRealClip: undefined });
  });

  it("select then remove on a beat with no source goes back to no source", () => {
    h.queries.set("shopMedia.list", listPage([APPROVED_VERTICAL]));
    const onChange = vi.fn();
    const start = { beatNumber: 5, visual: "x" };
    const { rerender } = render(<RealClipPicker beat={start} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /use real clip/i }));
    fireEvent.click(screen.getByRole("button", { name: /lug nuts torqued/i }));
    rerender(<RealClipPicker beat={{ ...start, ...onChange.mock.calls.at(-1)![0] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove clip/i }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ source: undefined, realAssetId: undefined, sourceBeforeRealClip: undefined });
  });

  it("a bound beat shows the chosen clip's duration", () => {
    h.queries.set("shopMedia.list", listPage([APPROVED_VERTICAL]));
    const onChange = vi.fn();
    const { rerender } = render(<RealClipPicker beat={{ beatNumber: 2, visual: "x" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /use real clip/i }));
    fireEvent.click(screen.getByRole("button", { name: /lug nuts torqued/i }));
    rerender(<RealClipPicker beat={{ beatNumber: 2, visual: "x", source: "real", realAssetId: "ok-tall" }} onChange={onChange} />);
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.queryByText(/needs real footage/i)).toBeNull();
  });

  it("a beat declared real with no clip says it needs real footage", () => {
    render(<RealClipPicker beat={{ beatNumber: 3, visual: "x", source: "real" }} onChange={vi.fn()} />);
    expect(screen.getByText(/needs real footage/i)).toBeTruthy();
  });

  it("a failed clip read is unknown with a retry, not an empty list", () => {
    h.queries.set("shopMedia.list", { data: undefined, isError: true, refetch: h.refetch.list });
    render(<RealClipPicker beat={{ beatNumber: 1, visual: "x" }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /use real clip/i }));
    expect(screen.getByText(/could not load clips/i)).toBeTruthy();
    expect(screen.queryByText(/no approved vertical clips/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.refetch.list).toHaveBeenCalled();
  });
});
