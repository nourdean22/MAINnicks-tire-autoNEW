/**
 * Photo check card in the admin Instagram Studio (instagramStudio.checkPhoto / brandedPhoto).
 *
 * The card uploads a photo with the existing evidence-photo mutation, shows one vision model's
 * scorecard, and makes ONE branded picture only after a second tap that shows the prompt.
 * What these tests pin:
 *   - a failed, unreadable, unavailable, offline or thrown check never renders scores;
 *   - the branded render is not called on the first tap, not after Cancel, once after Confirm,
 *     and a double tap on Confirm is still one call (each call spends an image credit);
 *   - nothing posts: the card never touches a post or publish procedure;
 *   - no window.confirm / alert / prompt (suppressed in the iOS standalone PWA).
 * The trpc mock is a small stateful fake of useMutation, so the card sees the same
 * mutateAsync / isPaused surface it gets from react-query.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager, useMutation } from "@tanstack/react-query";
import React from "react";

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  check: vi.fn(),
  brand: vi.fn(),
  forbidden: vi.fn(),
  opts: {} as Record<string, unknown>,
}));

vi.mock("@/lib/trpc", async () => {
  const R = await import("react");
  const fake = (name: string, fn: (input: unknown) => Promise<unknown>) => (opts?: unknown) => {
    h.opts[name] = opts;
    const [isError, setIsError] = R.useState(false);
    return {
      mutateAsync: async (input: unknown) => {
        setIsError(false);
        try {
          return await fn(input);
        } catch (e) {
          setIsError(true);
          throw e;
        }
      },
      isError,
      isPaused: false,
      reset: () => setIsError(false),
    };
  };
  return {
    trpc: {
      instagramStudio: {
        uploadEvidencePhoto: { useMutation: fake("upload", (i) => h.upload(i)) },
        checkPhoto: { useMutation: fake("check", (i) => h.check(i)) },
        brandedPhoto: { useMutation: fake("brand", (i) => h.brand(i)) },
        // A post or publish door the card must never reach.
        stage: { useMutation: () => ({ mutate: h.forbidden, mutateAsync: h.forbidden }) },
        render: { useMutation: () => ({ mutate: h.forbidden, mutateAsync: h.forbidden }) },
      },
    },
  };
});

import { PhotoCheckCard } from "../pages/admin/instagram/PhotoCheckCard";
import { UNBATCHED_SLOW_PROCEDURES } from "@/lib/unbatchedProcedures";

const PROMPT = "A busy Cleveland tire shop at golden hour, gold #FDB913 accent, professional automotive photography, Cleveland independent shop.";
const ANALYSIS = {
  scores: { lighting: 70, framing: 64, brandPresence: 55, cleanliness: 81, professionalPolish: 61, overall: 72 },
  subject: "Storefront with two bays open",
  currentMood: "Busy and working",
  issues: ["Harsh glare on the sign", "Parked trucks block the door"],
  improvements: [
    { type: "lighting", instruction: "Shoot after 4 pm to avoid glare", priority: "high" },
    { type: "crop", instruction: "Crop out the parked trucks", priority: "low" },
  ],
  marketingFit: { instagram: "good", facebook: "ok", gbp: "ok", billboard: "bad", best: "instagram" },
  rebrandPrompt: PROMPT,
};
const CHECK_OK = { ok: true, analysis: ANALYSIS, model: "gemini-test-vision", durationMs: 1800 };
const UPLOADED = { url: "https://cdn.example.test/ig-evidence/1-tire.jpg" };
const BRANDED_OK = { ok: true, imageUrl: "https://cdn.example.test/branded/9.png", model: "gemini-test-image", durationMs: 9000 };

const photo = (over: { name?: string; type?: string; size?: number } = {}) => {
  const f = new File(["abc"], over.name ?? "tire.jpg", { type: over.type ?? "image/jpeg" });
  if (over.size) Object.defineProperty(f, "size", { value: over.size });
  return f;
};
const choose = (file: File = photo()) => fireEvent.change(screen.getByLabelText("Photo file"), { target: { files: [file] } });
const scorecard = () => screen.getByRole("region", { name: "Photo scorecard" });
const row = (label: string) => within(scorecard()).getByText(label).closest("li")!.textContent;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
/** Pick a photo and wait for the scorecard. */
const checked = async () => {
  render(<PhotoCheckCard />);
  choose();
  await screen.findByRole("region", { name: "Photo scorecard" });
};

let natives: MockInstance[];
beforeEach(() => {
  h.upload.mockReset().mockResolvedValue(UPLOADED);
  h.check.mockReset().mockResolvedValue(CHECK_OK);
  h.brand.mockReset().mockResolvedValue(BRANDED_OK);
  h.forbidden.mockReset();
  h.opts = {};
  natives = [vi.spyOn(window, "confirm"), vi.spyOn(window, "alert"), vi.spyOn(window, "prompt")];
});
afterEach(() => {
  for (const n of natives) {
    expect(n).not.toHaveBeenCalled();
    n.mockRestore();
  }
  expect(h.forbidden).not.toHaveBeenCalled();
  cleanup();
});

describe("Photo check card: picking a photo", () => {
  it("idle: one 48 px button, a picker that offers camera and library, and no scores", () => {
    render(<PhotoCheckCard />);
    const btn = screen.getByRole("button", { name: "Choose or take a photo" });
    expect(btn.className).toMatch(/\bmin-h-12\b/);
    const input = screen.getByLabelText("Photo file") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/jpeg,image/png,image/webp,image/heic,image/heif");
    // capture="environment" would force the camera and hide the library on iOS.
    expect(input.hasAttribute("capture")).toBe(false);
    expect(screen.queryByRole("region", { name: "Photo scorecard" })).toBeNull();
    expect(screen.queryByText(/of 100/)).toBeNull();
  });

  it("idle is compact: the title, one short line and the one button, with no scorecard shell or branded controls", () => {
    render(<PhotoCheckCard />);
    expect(screen.getByText("Photo check")).toBeTruthy();
    expect(screen.getByText("Get a plain read on a shop photo.")).toBeTruthy();
    // Privacy: the operator is told before choosing that the photo stays out of the library and posts.
    expect(screen.getByText("The photo is uploaded for this check only. It is not added to your shop photo library or used in posts.")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Make a branded version/)).toBeNull();
  });

  it("uploads score-only, so the photo never joins the shop media library the autopost draws from, then checks the uploaded url", async () => {
    await checked();
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledWith({ base64: "YWJj", filename: "tire.jpg", mimeType: "image/jpeg", scoreOnly: true });
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(h.check).toHaveBeenCalledWith({ photoUrl: UPLOADED.url });
  });

  it("refuses a photo over 7.5 MB and an unsupported type before any call", () => {
    render(<PhotoCheckCard />);
    choose(photo({ size: 8_000_000 }));
    expect(screen.getByRole("status").textContent).toMatch(/7\.5 ?MB/);
    choose(photo({ name: "clip.gif", type: "image/gif" }));
    expect(screen.getByRole("status").textContent).toMatch(/JPEG, PNG, WebP or HEIC/);
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.check).not.toHaveBeenCalled();
  });

  it("an upload that fails says so and never asks the model to score anything", async () => {
    h.upload.mockRejectedValue(new Error("storage down"));
    render(<PhotoCheckCard />);
    choose();
    await screen.findByText("Couldn't upload this photo");
    expect(h.check).not.toHaveBeenCalled();
    expect(screen.queryByText(/of 100/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose or take a photo" })).toBeTruthy();
  });

  it("while the photo uploads and is checked the picker is disabled and a status says which step", async () => {
    const up = deferred<typeof UPLOADED>();
    const chk = deferred<typeof CHECK_OK>();
    h.upload.mockReturnValue(up.promise);
    h.check.mockReturnValue(chk.promise);
    render(<PhotoCheckCard />);
    choose();
    expect(screen.getByRole("status").textContent).toMatch(/Uploading/);
    expect((screen.getByRole("button", { name: "Choose or take a photo" }) as HTMLButtonElement).disabled).toBe(true);
    up.resolve(UPLOADED);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Checking/));
    chk.resolve(CHECK_OK);
    await screen.findByRole("region", { name: "Photo scorecard" });
  });
});

describe("Photo check card: the scorecard", () => {
  it("reads as the model's opinion: overall first, five scores, words, issues, priorities, best channel", async () => {
    await checked();
    const card = scorecard();
    expect(within(card).getByText("Model's read of this photo")).toBeTruthy();
    expect(within(card).getByText("Model: gemini-test-vision")).toBeTruthy();
    expect(within(card).getByText("72 of 100")).toBeTruthy();
    expect(row("Lighting")).toBe("Lighting70");
    expect(row("Framing")).toBe("Framing64");
    expect(row("Brand presence")).toBe("Brand presence55");
    expect(row("Cleanliness")).toBe("Cleanliness81");
    expect(row("Professional polish")).toBe("Professional polish61");
    expect(within(card).getByText("Storefront with two bays open")).toBeTruthy();
    expect(within(card).getByText("Busy and working")).toBeTruthy();
    expect(within(card).getByText("Harsh glare on the sign")).toBeTruthy();
    expect(within(card).getByText("Parked trucks block the door")).toBeTruthy();
    expect(within(card).getByText("High").closest("li")!.textContent).toMatch(/Shoot after 4 pm to avoid glare/);
    expect(within(card).getByText("Low").closest("li")!.textContent).toMatch(/Crop out the parked trucks/);
    expect(within(card).getByText("Best for: Instagram")).toBeTruthy();
  });

  it("a score of 0 is shown as 0, not hidden and not replaced", async () => {
    h.check.mockResolvedValue({ ...CHECK_OK, analysis: { ...ANALYSIS, scores: { ...ANALYSIS.scores, overall: 0, lighting: 0 } } });
    await checked();
    expect(within(scorecard()).getByText("0 of 100")).toBeTruthy();
    expect(row("Lighting")).toBe("Lighting0");
  });
});

describe("Photo check card: a check that did not produce a scorecard", () => {
  const FAILS: Array<[string, () => void, RegExp]> = [
    ["vision unavailable", () => h.check.mockResolvedValue({ ok: false, reason: "vision_unavailable", message: "x" }), /Photo checking isn't available right now/],
    ["unreadable", () => h.check.mockResolvedValue({ ok: false, reason: "unreadable", message: "x" }), /Couldn't read the result, try again/],
    ["invalid url", () => h.check.mockResolvedValue({ ok: false, reason: "invalid_url", message: "x" }), /photo link couldn't be opened/],
    ["a rejected request (offline fails fast, see the network mode test)", () => h.check.mockRejectedValue(new Error("Failed to fetch")), /request didn't finish/],
  ];

  for (const [name, arrange, line] of FAILS) {
    it(`${name}: says it could not check, names the cause, shows no scores, and offers a 48 px way forward`, async () => {
      arrange();
      render(<PhotoCheckCard />);
      choose();
      await screen.findByText("Couldn't check this photo");
      expect(screen.getByText(line)).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Photo scorecard" })).toBeNull();
      expect(screen.queryByText(/of 100/)).toBeNull();
      expect(screen.queryByText(/Best for/)).toBeNull();
      // Retry re-sends the same URL, which only helps when the URL was fine: an invalid link needs another photo.
      const next = name === "invalid url" ? "Choose another photo" : "Retry";
      expect(screen.getByRole("button", { name: next }).className).toMatch(/\bmin-h-12\b/);
      expect(screen.queryByRole("button", { name: name === "invalid url" ? "Retry" : "Choose another photo" })).toBeNull();
    });
  }

  it("Choose another photo opens the file picker", async () => {
    h.check.mockResolvedValue({ ok: false, reason: "invalid_url", message: "x" });
    render(<PhotoCheckCard />);
    choose();
    const button = await screen.findByRole("button", { name: "Choose another photo" });
    const pickerClick = vi.spyOn(screen.getByLabelText("Photo file") as HTMLInputElement, "click");
    fireEvent.click(button);
    expect(pickerClick).toHaveBeenCalledTimes(1);
  });

  it("Retry checks the same uploaded photo again without uploading twice", async () => {
    h.check.mockResolvedValueOnce({ ok: false, reason: "unreadable", message: "x" });
    render(<PhotoCheckCard />);
    choose();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByRole("region", { name: "Photo scorecard" });
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.check).toHaveBeenCalledTimes(2);
    expect(h.check).toHaveBeenLastCalledWith({ photoUrl: UPLOADED.url });
    expect(screen.queryByText("Couldn't check this photo")).toBeNull();
  });
});

describe("Photo check card: the branded version", () => {
  const first = () => fireEvent.click(screen.getByRole("button", { name: "Make a branded version" }));
  const confirmPanel = () => screen.getByRole("group", { name: "Confirm branded picture" });

  it("no render is called by showing the scorecard", async () => {
    await checked();
    expect(h.brand).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm branded picture" })).toBeNull();
  });

  it("the first tap only opens a confirm that says what it is, what it costs, and shows the prompt", async () => {
    await checked();
    first();
    const panel = confirmPanel();
    expect(within(panel).getByText("Creates one new branded picture of a similar scene. It is not your photo edited. Uses image credit: normally one, a second if the first image service is down.")).toBeTruthy();
    expect(panel.textContent).not.toMatch(/Uses one image credit/);
    expect(within(panel).getByText(PROMPT)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Make the picture" }).className).toMatch(/\bmin-h-12\b/);
    expect(within(panel).getByRole("button", { name: "Cancel" }).className).toMatch(/\bmin-h-12\b/);
    expect(h.brand).not.toHaveBeenCalled();
  });

  it("Cancel closes the confirm and never renders; a later confirm still works", async () => {
    await checked();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm branded picture" })).toBeNull();
    expect(h.brand).not.toHaveBeenCalled();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Make the picture" }));
    await screen.findByRole("img", { name: "Branded picture" });
    expect(h.brand).toHaveBeenCalledTimes(1);
  });

  it("Cancel returns focus to the Make a branded version button", async () => {
    await checked();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Make a branded version" }));
  });

  it("Confirm renders exactly once with the scorecard's prompt, then shows the picture, its model and a full-size link", async () => {
    await checked();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Make the picture" }));
    const img = (await screen.findByRole("img", { name: "Branded picture" })) as HTMLImageElement;
    expect(h.brand).toHaveBeenCalledTimes(1);
    expect(h.brand).toHaveBeenCalledWith({ prompt: PROMPT });
    expect(img.src).toBe(BRANDED_OK.imageUrl);
    const link = screen.getByRole("link", { name: "Open full size" }) as HTMLAnchorElement;
    expect(link.href).toBe(BRANDED_OK.imageUrl);
    expect(link.target).toBe("_blank");
    expect(link.rel).toMatch(/noopener/);
    expect(screen.getByText("Model: gemini-test-image")).toBeTruthy();
    expect(screen.getByText(/Preview only/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Confirm branded picture" })).toBeNull();
  });

  it("a double tap on Confirm is one render, because each render spends an image credit", async () => {
    const pending = deferred<typeof BRANDED_OK>();
    h.brand.mockReturnValue(pending.promise);
    await checked();
    first();
    const confirm = within(confirmPanel()).getByRole("button", { name: "Make the picture" });
    // Both taps land before React re-renders (one act batch), so only the ref lock can stop the second.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(h.brand).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toMatch(/Making the picture/);
    expect(screen.queryByRole("button", { name: "Make a branded version" })).toBeNull();
    pending.resolve(BRANDED_OK);
    await screen.findByRole("img", { name: "Branded picture" });
    expect(h.brand).toHaveBeenCalledTimes(1);
  });

  it("shows the first 300 characters of a long prompt and the whole prompt on request", async () => {
    const long = `${"Wide shot of a tire shop front. ".repeat(20)}END-OF-PROMPT`;
    h.check.mockResolvedValue({ ...CHECK_OK, analysis: { ...ANALYSIS, rebrandPrompt: long } });
    await checked();
    first();
    const panel = confirmPanel();
    expect(within(panel).queryByText(/END-OF-PROMPT/)).toBeNull();
    expect(panel.textContent).toContain(long.slice(0, 300));
    fireEvent.click(within(panel).getByRole("button", { name: "Show full prompt" }));
    expect(within(panel).getByText(long)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Show less" }));
    expect(within(panel).queryByText(/END-OF-PROMPT/)).toBeNull();
  });

  it("a render that comes back unavailable says so, shows no picture, and needs a fresh confirm to try again", async () => {
    h.brand.mockResolvedValue({ ok: false, reason: "image_unavailable", message: "x" });
    await checked();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Make the picture" }));
    await screen.findByText("Couldn't make the picture");
    expect(screen.getByText(/couldn't be made right now/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Branded picture" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Confirm branded picture" })).toBeNull();
    first();
    expect(h.brand).toHaveBeenCalledTimes(1);
    expect(confirmPanel()).toBeTruthy();
  });

  it("a render request that throws says it may have used a credit and does not claim a picture", async () => {
    h.brand.mockRejectedValue(new Error("Failed to fetch"));
    await checked();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Make the picture" }));
    await screen.findByText("Couldn't make the picture");
    expect(screen.getByText(/may have used an image credit/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Branded picture" })).toBeNull();
  });

  it("choosing another photo clears the old scorecard and the old picture", async () => {
    await checked();
    first();
    fireEvent.click(within(confirmPanel()).getByRole("button", { name: "Make the picture" }));
    await screen.findByRole("img", { name: "Branded picture" });
    const next = deferred<typeof CHECK_OK>();
    h.check.mockReturnValue(next.promise);
    choose(photo({ name: "bay.jpg" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Photo scorecard" })).toBeNull());
    expect(screen.queryByRole("img", { name: "Branded picture" })).toBeNull();
    next.resolve(CHECK_OK);
    await screen.findByRole("region", { name: "Photo scorecard" });
    expect(screen.queryByRole("img", { name: "Branded picture" })).toBeNull();
  });
});

describe("Photo check card: offline and focus", () => {
  it("upload, check and render all pass networkMode always, so an offline tap fails fast instead of queueing a paused request that fires later", () => {
    render(<PhotoCheckCard />);
    expect(h.opts.upload).toEqual({ networkMode: "always" });
    expect(h.opts.check).toEqual({ networkMode: "always" });
    expect(h.opts.brand).toEqual({ networkMode: "always" });
  });

  it("positive control on the real react-query: offline, networkMode always runs the request (and fails), the default one pauses unsent", async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const ran = vi.fn().mockRejectedValue(new Error("offline"));
    onlineManager.setOnline(false);
    try {
      const always = renderHook(() => useMutation({ mutationFn: ran, networkMode: "always" }), { wrapper });
      await act(async () => { await always.result.current.mutateAsync(1).catch(() => {}); });
      expect(ran).toHaveBeenCalledTimes(1);
      expect(always.result.current.isPaused).toBe(false);

      ran.mockClear();
      const normal = renderHook(() => useMutation({ mutationFn: ran }), { wrapper });
      act(() => { void normal.result.current.mutateAsync(1).catch(() => {}); });
      await waitFor(() => expect(normal.result.current.isPaused).toBe(true));
      expect(ran).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
      client.clear();
    }
  });

  it("the card shows no offline or paused state of its own: an unreachable network is the same Couldn't check this photo with Retry", async () => {
    h.check.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<PhotoCheckCard />);
    choose();
    await screen.findByText("Couldn't check this photo");
    expect(screen.queryByText(/appear to be offline/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("opening the confirm moves focus into it, so a keyboard or screen reader user is not left on a removed button", async () => {
    await checked();
    fireEvent.click(screen.getByRole("button", { name: "Make a branded version" }));
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Confirm branded picture" }));
  });

  it("two identical issues from the model render twice without a duplicate-key warning", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      h.check.mockResolvedValue({ ...CHECK_OK, analysis: { ...ANALYSIS, issues: ["Glare", "Glare"] } });
      await checked();
      expect(within(scorecard()).getAllByText("Glare")).toHaveLength(2);
      expect(err.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    } finally {
      err.mockRestore();
    }
  });
});

describe("Photo check card: announcements", () => {
  const region = () => screen.getByRole("status");

  it("the result area is one polite live region, present before anything happens", () => {
    render(<PhotoCheckCard />);
    expect(region().getAttribute("aria-live")).toBe("polite");
  });

  it("a finished scorecard, a failure and a finished render land inside the live region; nothing uses role alert, so nothing is announced twice", async () => {
    h.check.mockResolvedValueOnce({ ok: false, reason: "unreadable", message: "x" });
    render(<PhotoCheckCard />);
    choose();
    await screen.findByText("Couldn't check this photo");
    expect(within(region()).getByText("Couldn't check this photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("region", { name: "Photo scorecard" });
    expect(region().contains(scorecard())).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Make a branded version" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm branded picture" })).getByRole("button", { name: "Make the picture" }));
    const img = await screen.findByRole("img", { name: "Branded picture" });
    expect(region().contains(img)).toBe(true);
    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("the progress line is announced from the same region", () => {
    h.upload.mockReturnValue(new Promise(() => {}));
    render(<PhotoCheckCard />);
    choose();
    expect(region().textContent).toMatch(/Uploading/);
  });
});

describe("Photo check card: which model answered", () => {
  it("shows the model the server says answered, and 'Model: unknown' when it could not say", async () => {
    h.brand.mockResolvedValue({ ...BRANDED_OK, model: "unknown" });
    await checked();
    fireEvent.click(screen.getByRole("button", { name: "Make a branded version" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm branded picture" })).getByRole("button", { name: "Make the picture" }));
    await screen.findByRole("img", { name: "Branded picture" });
    expect(screen.getByText("Model: unknown")).toBeTruthy();
    expect(screen.queryByText("Model: gemini-test-image")).toBeNull();
  });
});

describe("Photo check card: contract with the rest of the client", () => {
  it("both procedures are read on their own request, so a slow model never holds the batched reads", () => {
    expect(UNBATCHED_SLOW_PROCEDURES.has("instagramStudio.checkPhoto")).toBe(true);
    expect(UNBATCHED_SLOW_PROCEDURES.has("instagramStudio.brandedPhoto")).toBe(true);
  });
});
