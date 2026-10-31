/**
 * Composer in-form buttons must not submit the composer form.
 *
 * MentionDropdown and AttachmentPreview render inside the chat composer's
 * `<form onSubmit>` (features/chat-v2/components/chat-composer.tsx). A
 * `<button>` with no `type` is a submit button in HTML, so picking an
 * @mention sent the draft (a paid model call), and "Remove attachment"
 * submitted the form too -- with an edit armed, that runs the edit-resend
 * path, which deletes the edited message and everything after it.
 *
 * vitest runs in the node environment here (no jsdom, no testing-library;
 * see observability-tiles.test.tsx), so these tests call the components,
 * walk the element tree they return, and apply the browser's activation
 * rule for a button inside a form (`clickInsideForm` below).
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MentionDropdown } from "@/components/chat/mention-dropdown";
import { AttachmentPreview } from "@/components/chat/attachment-preview";
import type { Mention } from "@/hooks/use-mention-suggestions";

type HostProps = {
  type?: string;
  onClick?: (event: { preventDefault: () => void }) => void;
  className?: string;
  children?: React.ReactNode;
  size?: number;
  "aria-label"?: string;
};
type HostEl = React.ReactElement<HostProps>;

function collect(node: React.ReactNode, match: (el: HostEl) => boolean, out: HostEl[] = []): HostEl[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, match, out);
    return out;
  }
  if (!React.isValidElement(node)) return out;
  const el = node as HostEl;
  if (match(el)) out.push(el);
  collect(el.props.children, match, out);
  return out;
}

const buttons = (tree: React.ReactNode) => collect(tree, (el) => el.type === "button");

/**
 * HTML activation of a <button> inside a <form>: run the click handler, then,
 * unless it called preventDefault, submit the form when the button's type
 * state is Submit -- which a missing or unknown `type` is. Only "button" and
 * "reset" opt out.
 */
function clickInsideForm(button: HostEl, submitForm: () => void) {
  let defaultPrevented = false;
  button.props.onClick?.({
    preventDefault: () => {
      defaultPrevented = true;
    },
  });
  const type = button.props.type;
  if (!defaultPrevented && type !== "button" && type !== "reset") submitForm();
}

const MIT: Mention = { key: "mit", label: "@mit", icon: "*", description: "Most important task" };

describe("composer in-form buttons", () => {
  it("mention pick does not submit the enclosing form", () => {
    const pick = vi.fn();
    const submit = vi.fn();
    const tree = MentionDropdown({ filtered: [MIT], onPick: pick });

    const [option] = buttons(tree);
    expect(option).toBeDefined();
    clickInsideForm(option, submit);

    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledWith(MIT);
    expect(submit).not.toHaveBeenCalled();
  });

  it("remove attachment does not submit the enclosing form", () => {
    const clear = vi.fn();
    const submit = vi.fn();
    const file = new File(["x"], "invoice.pdf", { type: "application/pdf" });
    const tree = AttachmentPreview({ file, preview: "", onClear: clear });

    const remove = buttons(tree).find((b) => String(b.props["aria-label"]).startsWith("Remove "));
    expect(remove).toBeDefined();
    clickInsideForm(remove!, submit);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("remove attachment has a 44x44 hit area and keeps the 12px icon", () => {
    const file = new File(["x"], "photo.png", { type: "image/png" });
    const tree = AttachmentPreview({ file, preview: "blob:x", onClear: () => {} });

    const remove = buttons(tree).find((b) => String(b.props["aria-label"]).startsWith("Remove "))!;
    const classes = (remove.props.className ?? "").split(/\s+/);
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("min-w-11");

    const icons = collect(remove.props.children, (el) => typeof el.props.size === "number");
    expect(icons.map((el) => el.props.size)).toEqual([12]);
  });
});
