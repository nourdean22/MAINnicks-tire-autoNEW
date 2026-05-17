"use client";

/**
 * useChatRename — inline conversation rename state.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.15 BATCH A
 * decomposition. The page used to own two useState calls and a couple
 * of imperative handlers (commit on blur, cancel on Esc). They live
 * entirely inside the ConvoList sidebar render — pure UI state with
 * no effect chains.
 *
 * The actual server-side rename is a closure call into the page's
 * `renameConvo` handler, which the caller provides as `onCommit`.
 */

import { useCallback, useState } from "react";

export interface ChatRenameState {
  renamingConvoId: string | null;
  renameValue: string;
  /** Begin renaming a conversation — seeds the input with `current`. */
  startRename: (convoId: string, current: string) => void;
  /** Update the in-flight rename input. */
  setRenameValue: (next: string) => void;
  /** Commit (calls the caller's renameConvo) and exit edit mode. */
  commitRename: (onCommit: (id: string, name: string) => void | Promise<void>) => void;
  /** Cancel without persisting. */
  cancelRename: () => void;
}

export function useChatRename(): ChatRenameState {
  const [renamingConvoId, setRenamingConvoId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = useCallback((convoId: string, current: string) => {
    setRenamingConvoId(convoId);
    setRenameValue(current);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingConvoId(null);
    setRenameValue("");
  }, []);

  const commitRename = useCallback(
    (onCommit: (id: string, name: string) => void | Promise<void>) => {
      const id = renamingConvoId;
      const name = renameValue.trim();
      if (!id) return;
      // Always exit edit mode; only call onCommit if the name actually changed
      // (caller does its own no-op guard, but skip the round-trip on empty too).
      setRenamingConvoId(null);
      setRenameValue("");
      if (name.length > 0) {
        void onCommit(id, name);
      }
    },
    [renamingConvoId, renameValue],
  );

  return {
    renamingConvoId,
    renameValue,
    startRename,
    setRenameValue,
    commitRename,
    cancelRename,
  };
}
