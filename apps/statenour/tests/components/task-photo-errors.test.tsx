// @vitest-environment jsdom
/**
 * Task photos say what went wrong in plain words (2026-10-30, PR 3360's parked follow-up). A failed upload or
 * delete used to print the server's raw error text ("Not added: upload failed (500)", "Not deleted: <prisma
 * message>"). Now the words come from the cause: the upload's HTTP status, the delete's tRPC code, or no
 * connection at all. The resize step's own messages were already written for Nour and pass through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  del: { mutate: () => {}, isPending: false, isError: false, error: null as unknown },
  delOpts: null as unknown as { onError?: (err: unknown) => void },
  invalidate: vi.fn(async (_: unknown) => {}),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: {
      attachments: { useQuery: () => ({ data: [{ id: "a1" }], isLoading: false, isError: false, refetch: async () => {} }) },
      attachmentDelete: {
        useMutation: (opts: { onError?: (err: unknown) => void }) => {
          h.delOpts = opts;
          return h.del;
        },
      },
    },
    useUtils: () => ({ task: { attachments: { invalidate: h.invalidate } } }),
  },
}));
vi.mock("@/lib/ui/resize-photo", () => ({
  resizePhoto: async () => ({ blob: new Blob(["x"], { type: "image/jpeg" }), width: 10, height: 10 }),
}));

import { TaskPhotos, deleteErrorText, uploadErrorText } from "@/components/inspector/panels/task-photos";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  h.del = { mutate: () => {}, isPending: false, isError: false, error: null };
  h.invalidate.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function pickPhoto() {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["x"], "p.jpg", { type: "image/jpeg" })], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("upload errors", () => {
  it("names the cause by HTTP status, never the server's raw text", () => {
    expect(uploadErrorText(401)).toMatch(/session ended/i);
    expect(uploadErrorText(404)).toMatch(/task no longer exists/i);
    expect(uploadErrorText(413)).toMatch(/too large/i);
    expect(uploadErrorText(415)).toMatch(/JPEG or WebP/);
    // 503 also means auth unavailable or the database out of quota, so it never claims demo data.
    expect(uploadErrorText(503)).toBe("Photo storage is not available right now. Try again in a few minutes.");
    expect(uploadErrorText(500)).toBe("The photo was not saved. Try again.");
  });

  it("a failed upload shows the plain sentence, not the body's error text", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "PrismaClientKnownRequestError: P2003 foreign key" }), { status: 500 }));
    act(() => root.render(<TaskPhotos taskId="t1" />));
    await pickPhoto();
    expect(host.textContent).toContain("The photo was not saved. Try again.");
    expect(host.textContent).not.toContain("Prisma");
    expect(host.textContent).not.toContain("upload failed (500)");
  });

  it("no connection says so", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    act(() => root.render(<TaskPhotos taskId="t1" />));
    await pickPhoto();
    expect(host.textContent).toContain("No connection. The photo was not added.");
    expect(host.textContent).not.toContain("Failed to fetch");
  });
});

describe("delete errors", () => {
  it("names the cause by tRPC code, never the raw message", () => {
    expect(deleteErrorText({ data: { code: "NOT_FOUND" }, message: "Photo not found." })).toBe("Already deleted. The list is refreshing.");
    expect(deleteErrorText({ data: { code: "UNAUTHORIZED" } })).toMatch(/session ended/i);
    expect(deleteErrorText({ data: { code: "FORBIDDEN" }, message: "Mutations are currently locked by NICK_MUTATION_LOCK." })).toMatch(/locked/i);
    const unknown = deleteErrorText({ data: { code: "INTERNAL_SERVER_ERROR" }, message: "PrismaClientKnownRequestError" });
    expect(unknown).toBe("Not deleted. Try again.");
  });

  it("the viewer shows the plain sentence, not the raw message", async () => {
    h.del = { mutate: () => {}, isPending: false, isError: true, error: { data: { code: "INTERNAL_SERVER_ERROR" }, message: "PrismaClientKnownRequestError" } };
    act(() => root.render(<TaskPhotos taskId="t1" />));
    const thumb = host.querySelector("button[aria-label=\"Open photo\"]") as HTMLButtonElement;
    await act(async () => {
      thumb.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Not deleted. Try again.");
    expect(document.body.textContent).not.toContain("Prisma");
  });

  it("an already-deleted photo refreshes the list, so its stale tile goes away", async () => {
    act(() => root.render(<TaskPhotos taskId="t1" />));
    await act(async () => {
      (host.querySelector('button[aria-label="Open photo"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await act(async () => {
      h.delOpts.onError?.({ data: { code: "NOT_FOUND" }, message: "Photo not found." });
      await Promise.resolve();
    });
    expect(h.invalidate).toHaveBeenCalledWith({ taskId: "t1" });
    h.invalidate.mockClear();
    await act(async () => {
      h.delOpts.onError?.({ data: { code: "INTERNAL_SERVER_ERROR" }, message: "boom" });
      await Promise.resolve();
    });
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});
