// @vitest-environment jsdom
/**
 * MaximLine on Home: shows the line, its source and the reason; sends tags, never the headline text; Next asks
 * for the next step; Keep and Skip send the shown maxim's id and say what happened in plain words; a failed
 * Next keeps the shown maxim; a failed first read says so; every verb is a 44 px target.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MutationOpts = { onSuccess: (res: { ok: boolean }, vars: { id: string }) => void; onError: (err: unknown) => void };

const h = vi.hoisted(() => ({
  query: {} as { data: unknown; isFetching: boolean; isError: boolean; isPlaceholderData: boolean },
  inputs: [] as Array<{ step: number; tags: string[] }>,
  queryOpts: [] as Array<{ enabled: boolean }>,
  keep: vi.fn(),
  skip: vi.fn(),
  keepOpts: null as unknown as MutationOpts,
  skipOpts: null as unknown as MutationOpts,
  invalidate: vi.fn(async () => {}),
  toastOk: vi.fn(),
  toastErr: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ operator: { maxim: { invalidate: h.invalidate } } }),
    operator: {
      maxim: {
        useQuery: (input: { step: number; tags: string[] }, opts: { enabled: boolean }) => {
          h.inputs.push(input);
          h.queryOpts.push(opts);
          return h.query;
        },
      },
      maximKeep: {
        useMutation: (opts: MutationOpts) => {
          h.keepOpts = opts;
          return { mutate: h.keep, isPending: false };
        },
      },
      maximSkip: {
        useMutation: (opts: MutationOpts) => {
          h.skipOpts = opts;
          return { mutate: h.skip, isPending: false };
        },
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastErr } }));

import { DecisionMaxim, MaximLine, maximErrorText } from "@/components/home/maxim-line";

const ID = "greene-maxims:law_1";
const MAXIM = { id: ID, text: "Let a big customer feel smart.", source: "Greene · 48 Laws", topic: "customers", position: 3, total: 40 };
const HEADLINE = "Send the Smith estimate follow-up";

let root: Root;
let host: HTMLDivElement;
const button = (name: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name)!;

function mount(ready = true) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<MaximLine context={HEADLINE} ready={ready} />));
}

beforeEach(() => {
  h.inputs = [];
  h.queryOpts = [];
  for (const f of [h.keep, h.skip, h.invalidate, h.toastOk, h.toastErr]) f.mockClear();
  h.query = { data: MAXIM, isFetching: false, isError: false, isPlaceholderData: false };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MaximLine", () => {
  it("shows the maxim, its source and the reason, and sends only tags read off the headline", () => {
    mount();
    expect(host.textContent).toContain("Let a big customer feel smart.");
    expect(host.textContent).toContain("Greene · 48 Laws · for today: customers");
    expect(h.inputs[0]).toEqual({ step: 0, tags: ["customers"] });
    expect(JSON.stringify(h.inputs)).not.toContain("Smith");
  });

  it("does not read until the brief is in (ready=false disables the query)", () => {
    mount(false);
    expect(h.queryOpts[0]!.enabled).toBe(false);
  });

  it("Next asks for the next step", () => {
    mount();
    act(() => button("Next").click());
    expect(h.inputs.at(-1)).toEqual({ step: 1, tags: ["customers"] });
  });

  it("Keep sends the id; on success the button reads Kept, pressed and disabled", () => {
    mount();
    act(() => button("Keep").click());
    expect(h.keep).toHaveBeenCalledWith({ id: ID });
    act(() => h.keepOpts.onSuccess({ ok: true }, { id: ID }));
    const kept = button("Kept");
    expect(kept.getAttribute("aria-pressed")).toBe("true");
    expect(kept.disabled).toBe(true);
    expect(h.toastOk).toHaveBeenCalledWith("Kept. Nick can use it in chat.");
  });

  it("a failed Keep leaves the button on Keep and says why in plain words", () => {
    mount();
    act(() => h.keepOpts.onError({ message: "Mutations are currently locked by NICK_MUTATION_LOCK.", data: { code: "FORBIDDEN" } }));
    expect(button("Keep").getAttribute("aria-pressed")).toBe("false");
    expect(button("Keep").disabled).toBe(false);
    expect(h.toastErr).toHaveBeenCalledWith("Changes are locked right now (the mutation lock is on). Nothing was saved.");
  });

  it("a Skip that succeeds hides the maxim at once and refetches; a failed Skip does neither", () => {
    mount();
    act(() => h.skipOpts.onError({ data: { code: "UNAUTHORIZED" } }));
    expect(h.invalidate).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Let a big customer feel smart.");
    expect(h.toastErr).toHaveBeenCalledWith("Your session ended. Sign in again, then try once more.");
    act(() => button("Skip").click());
    expect(h.skip).toHaveBeenCalledWith({ id: ID });
    act(() => h.skipOpts.onSuccess({ ok: true }, { id: ID }));
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    // The refetch has not answered (or failed): the skipped maxim must not stay on screen.
    expect(host.textContent).not.toContain("Let a big customer feel smart.");
  });

  it("while Next loads, the old maxim stays with Keep and Skip disabled", () => {
    h.query = { ...h.query, isPlaceholderData: true, isFetching: true };
    mount();
    expect(host.textContent).toContain("Let a big customer feel smart.");
    expect(button("Keep").disabled).toBe(true);
    expect(button("Skip").disabled).toBe(true);
  });

  it("a failed Next keeps the shown maxim and says the next one did not load", () => {
    h.query = { ...h.query, isPlaceholderData: true, isError: true };
    mount();
    expect(host.textContent).toContain("Let a big customer feel smart.");
    expect(host.textContent).toContain("The next maxim did not load. This one stays.");
  });

  it("a failed first read says so; loading or all-skipped renders nothing", () => {
    h.query = { data: undefined, isFetching: false, isError: true, isPlaceholderData: false };
    mount();
    expect(host.textContent).toBe("The maxim could not load. It will try again in a few minutes.");
    act(() => root.unmount());
    host.remove();
    h.query = { data: undefined, isFetching: true, isError: false, isPlaceholderData: false };
    mount();
    expect(host.innerHTML).toBe("");
  });

  it("every verb is a 44 px target", () => {
    mount();
    for (const name of ["Next", "Keep", "Skip"]) {
      expect(button(name).className).toContain("min-h-[44px]");
      expect(button(name).className).toContain("min-w-[44px]");
    }
  });
});

describe("DecisionMaxim (the decision page and the top pending approval)", () => {
  function mountDecision(text: string, label: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<DecisionMaxim text={text} label={label} />));
  }

  it("always asks for decisions maxims, adds the text's own tags, and still sends no text", () => {
    // No decision word in the text: only the surface can supply "decisions".
    mountDecision("Refund customer Mrs Smith", "for this approval");
    expect(h.inputs[0]).toEqual({ step: 0, tags: ["conflict", "customers", "decisions"] });
    expect(JSON.stringify(h.inputs)).not.toContain("Smith");
    expect(h.queryOpts[0]!.enabled).toBe(true);
  });

  it("words the topic for its own surface and sits compact inside the card", () => {
    mountDecision("Lease the second bay", "for this decision");
    expect(host.textContent).toContain("Greene · 48 Laws · for this decision: customers");
    expect(host.querySelector("section")!.className).not.toContain("mt-10");
    for (const name of ["Next", "Keep", "Skip"]) expect(button(name).className).toContain("min-h-[44px]");
  });
});

describe("maximErrorText", () => {
  it("names the known causes and never echoes raw error text", () => {
    expect(maximErrorText({ data: { code: "UNAUTHORIZED" } })).toMatch(/session ended/);
    expect(maximErrorText({ message: "Mutations are locked: NICK_MUTATION_LOCK could not be resolved (fail-closed).", data: { code: "FORBIDDEN" } })).toMatch(/mutation lock/);
    expect(maximErrorText({ data: { code: "FORBIDDEN" } })).toMatch(/owner sign-in/);
    const unknown = maximErrorText(new Error("ECONNRESET socket hang up"));
    expect(unknown).toBe("That did not save. Check the connection and try again.");
    expect(unknown).not.toContain("ECONNRESET");
  });
});
