/**
 * The server now refuses to close a real customer text as "no reply needed"
 * without a reason (audit 2026-11-07, smsConversations.markNoReplyNeeded).
 * The admin needs somewhere to type that reason on an iPhone home-screen PWA,
 * where window.prompt is silently suppressed. promptDialog is that surface:
 * the existing confirm modal with a text box.
 *
 * Asserts behaviour, not presence: the box is in the DOM, confirm stays
 * disabled under 4 characters, a typed reason resolves to the text, cancel
 * and Escape resolve to null, and window.prompt is never called.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

import ConfirmDialog, { promptDialog } from "../components/admin/ConfirmDialog";

afterEach(() => cleanup());

async function open() {
  render(<ConfirmDialog />);
  let promise!: Promise<string | null>;
  await act(async () => {
    promise = promptDialog({
      title: "Why does this text need no reply?",
      message: "This customer asked for something.",
      input: { label: "Reason", placeholder: "Spoke on the phone, came in, wrong number" },
      confirmLabel: "Close without replying",
    });
  });
  const box = await screen.findByLabelText(/reason/i);
  const confirm = screen.getByRole("button", { name: /close without replying/i }) as HTMLButtonElement;
  return { promise, box, confirm };
}

describe("promptDialog (no-reply reason)", () => {
  it("never reaches window.prompt and shows an in-DOM text box", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => null);
    const { box } = await open();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(box.tagName).toBe("TEXTAREA");
    promptSpy.mockRestore();
  });

  it("keeps confirm disabled until the reason is at least 4 characters, then resolves the text", async () => {
    const { promise, box, confirm } = await open();
    expect(confirm.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "ok" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  spoke on the phone  " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await expect(promise).resolves.toBe("spoke on the phone");
  });

  it("resolves null on cancel and on Escape", async () => {
    const first = await open();
    fireEvent.click(screen.getByText("Cancel", { selector: "button" }));
    await expect(first.promise).resolves.toBeNull();
    await waitFor(() => expect(screen.queryByLabelText(/reason/i)).toBeNull());
    cleanup();

    const second = await open();
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(second.promise).resolves.toBeNull();
  });
});
