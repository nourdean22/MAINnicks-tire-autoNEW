"use client";

/**
 * useChatEditing — message editing state for both user + assistant.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.15 BATCH A
 * decomposition. The page used to own three useState calls + a per-edit
 * draft autosave effect. Two distinct edit modes:
 *
 *   · `editingMsgId` — USER message being edited; saving will resend the
 *     message, retriggering a regeneration. Used by the inline edit UI on
 *     the user's own messages.
 *   · `editingAssistantId` — ASSISTANT message being edited; saving issues
 *     a PATCH to /api/ai/chat/edit/[messageId] with no resend. Used when
 *     Nour wants to fix a typo in a Nick reply without reproducing the turn.
 *   · `editValue` — shared draft buffer; only one of the two ids is non-null
 *     at a time so a single buffer is fine.
 *
 * The hook also owns the per-message draft autosave so a refresh mid-edit
 * restores the exact draft for the exact message. Storage key is namespaced
 * by the active edit id (`chat-edit:<id>` or `chat-edit:none` when idle).
 */

import { useEffect, useState } from "react";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";

export interface ChatEditingState {
  editingMsgId: string | null;
  setEditingMsgId: (id: string | null) => void;
  editingAssistantId: string | null;
  setEditingAssistantId: (id: string | null) => void;
  editValue: string;
  setEditValue: (next: string) => void;
  /** Clear the persisted draft for the active edit (call on save/cancel). */
  clearEditDraft: () => void;
}

export function useChatEditing(): ChatEditingState {
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(
    null,
  );
  const [editValue, setEditValue] = useState("");

  // Draft scope is keyed by whichever id is currently active. When both are
  // null we use a sentinel key so useDraftAutosave still has a valid key
  // (it doesn't accept conditional/null keys).
  const activeEditId = editingMsgId ?? editingAssistantId;
  const { clearDraft, restore } = useDraftAutosave({
    key: activeEditId ? `chat-edit:${activeEditId}` : "chat-edit:none",
    value: editValue,
  });

  // When the user begins editing a NEW message, restore any stashed draft
  // for that exact id. Skips if the current editValue already matches the
  // saved draft (avoids the restore→re-save→restore loop).
  useEffect(() => {
    if (!activeEditId) return;
    const saved = restore();
    if (saved && saved !== editValue) {
      setTimeout(() => setEditValue(saved), 0);
    }
    // Intentionally narrow deps: only re-run when the active edit id flips.
    // editValue is excluded by design — we don't want to re-restore on every
    // keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditId]);

  return {
    editingMsgId,
    setEditingMsgId,
    editingAssistantId,
    setEditingAssistantId,
    editValue,
    setEditValue,
    clearEditDraft: clearDraft,
  };
}
