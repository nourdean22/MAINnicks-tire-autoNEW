/**
 * U6c (2026-10-31): the chat's pop-up mute list, per viewer in this browser.
 *
 * Only notes that confirm something already visible can be muted: "done" (copied, saved, pinned,
 * new chat ready) and "fallback" (live context went local; the reply still came). Errors, Undo
 * toasts and notes that an action did NOT happen (still replying, files skipped, device voice in
 * place of the neural one) never go through here, so no mute can hide a failure.
 */
import { toast, type ExternalToast } from "sonner";

export type PopupKind = "done" | "fallback";
export const POPUP_KINDS: readonly PopupKind[] = ["done", "fallback"];
export const MUTED_POPUPS_KEY = "chat:mutedPopups";

/** The muted kinds; none when nothing is saved or storage is blocked (private mode, Lockdown). */
export function readMutedPopups(): PopupKind[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MUTED_POPUPS_KEY) ?? "[]");
    return Array.isArray(parsed) ? POPUP_KINDS.filter((kind) => parsed.includes(kind)) : [];
  } catch {
    return [];
  }
}

export function setPopupMuted(kind: PopupKind, muted: boolean): PopupKind[] {
  const next = POPUP_KINDS.filter((k) => (k === kind ? muted : readMutedPopups().includes(k)));
  try {
    window.localStorage.setItem(MUTED_POPUPS_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: nothing is saved, so the pop-ups keep showing
  }
  // Read back, so a blocked write shows the switch still on instead of claiming a mute.
  return readMutedPopups();
}

/** A success note the viewer can mute ("Copied", "Saved as belief"). */
export function doneToast(message: string, opts?: ExternalToast): void {
  if (!readMutedPopups().includes("done")) toast.success(message, opts);
}

/** A neutral note that a fallback answered instead; the viewer can mute it. */
export function fallbackToast(message: string, opts?: ExternalToast): void {
  if (!readMutedPopups().includes("fallback")) toast(message, opts);
}
