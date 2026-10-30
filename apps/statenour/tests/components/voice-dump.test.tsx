// @vitest-environment jsdom
/**
 * Voice brain dump review (2026-10-29): a transcript becomes reviewable rows,
 * nothing is saved until the one Save, a drop takes two taps, and a failed
 * split keeps the whole transcript as one editable row instead of losing it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  onTranscript: null as null | ((t: string) => void),
  split: vi.fn(),
  save: vi.fn(),
  saveResult: null as null | { created: number; ids: string[]; failed: number[] },
}));

vi.mock("@/hooks/use-voice-input", () => ({
  useVoiceInput: (onTranscript: (t: string) => void) => {
    h.onTranscript = onTranscript;
    return { isRecording: false, transcribing: false, startRecording: vi.fn(), stopRecording: vi.fn() };
  },
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: {
      dumpSplit: { useMutation: () => ({ mutateAsync: h.split, isPending: false }) },
      dumpSave: {
        useMutation: (opts: { onSuccess?: (res: unknown, vars: unknown) => unknown }) => ({
          mutate: (vars: unknown) => {
            h.save(vars);
            if (h.saveResult) void opts.onSuccess?.(h.saveResult, vars);
          },
          isPending: false,
          isError: false,
          error: null,
        }),
      },
    },
    useUtils: () => ({ task: { invalidate: async () => {} } }),
  },
}));

import { MissionsCapture } from "@/components/missions/voice-dump";

let root: Root;
let host: HTMLDivElement;
const buttons = (text: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.clearAllMocks();
  h.saveResult = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  host.remove();
});

describe("MissionsCapture voice dump", () => {
  it("rows to review, a two-tap drop, then one Save with what is left", async () => {
    // Clock pinned to Wed 12:00 ET (16:00 UTC), when ET and the runner's zone share a date.
    // parseQuickAdd takes the weekday in ET but adds days in local time, so on a UTC runner
    // between 20:00 and 24:00 ET "by friday" lands on Saturday (CI run 40980314567). On the
    // phone (ET) the two agree, which is why voice-dump parses there.
    vi.useFakeTimers({ now: new Date("2026-10-28T16:00:00Z"), toFake: ["Date"] });
    h.split.mockResolvedValue({
      items: [{ title: "Order brake pads by friday" }, { title: "Text the landlord" }],
    });
    await act(async () => root.render(<MissionsCapture onSubmit={() => {}} />));
    await act(async () => h.onTranscript!("order brake pads by friday and text the landlord"));
    const inputs = () => Array.from(host.querySelectorAll('input[aria-label="Task title"]')) as HTMLInputElement[];
    expect(inputs().map((i) => i.value)).toEqual(["Order brake pads", "Text the landlord"]);
    expect(h.save).not.toHaveBeenCalled();

    await act(async () => buttons("drop")[1].click());
    expect(inputs()).toHaveLength(2);
    await act(async () => buttons("tap to drop")[0].click());
    expect(inputs().map((i) => i.value)).toEqual(["Order brake pads"]);

    await act(async () => buttons("Save 1 task")[0].click());
    const saved = h.save.mock.calls[0][0].items;
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Order brake pads");
    // "by friday" read on the client: a Friday, end of the local day.
    const due = new Date(saved[0].dueDate);
    expect(due.getDay()).toBe(5);
    expect(due.getHours()).toBe(23);
  });

  it("a partial save keeps only the rows that failed, so Save again retries just those", async () => {
    h.split.mockResolvedValue({ items: [{ title: "First" }, { title: "Second" }, { title: "Third" }] });
    h.saveResult = { created: 2, ids: ["a", "c"], failed: [1] };
    await act(async () => root.render(<MissionsCapture onSubmit={() => {}} />));
    await act(async () => h.onTranscript!("first second third"));
    await act(async () => buttons("Save 3 tasks")[0].click());
    const left = Array.from(host.querySelectorAll('input[aria-label="Task title"]')) as HTMLInputElement[];
    expect(left.map((i) => i.value)).toEqual(["Second"]);
    expect(host.textContent).toContain("1 not saved");
  });

  it("a failed split keeps the transcript as one editable row and says so", async () => {
    h.split.mockRejectedValue(new Error("The model is unavailable"));
    await act(async () => root.render(<MissionsCapture onSubmit={() => {}} />));
    await act(async () => h.onTranscript!("call the parts counter"));
    const rows = host.querySelectorAll('input[aria-label="Task title"]');
    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLInputElement).value).toBe("call the parts counter");
    expect(host.textContent).toContain("Could not split it");
  });
});
