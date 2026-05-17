"use client";

/**
 * useChatModalToggles — five boolean modal/panel toggles in one hook.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.12 BATCH 69
 * decomposition. The page used to declare five `useState(false)` calls
 * inline, scattered across ~40 lines. They share zero state, no effect
 * chains, and live entirely in UI. Bundling them keeps the page surface
 * tighter and makes "what overlays can chat show" inspectable in one
 * place.
 *
 * Toggles owned:
 *   · inspector       — system-prompt inspector modal
 *   · toolLog         — tool-call log side panel
 *   · browserSandbox  — browser_do agent side panel (auto-opens on tool fire)
 *   · help            — keyboard shortcut cheat-sheet (Cmd+/)
 *   · historySearch   — full-text chat search (Cmd+F)
 */

import { useState, type Dispatch, type SetStateAction } from "react";

export interface ChatModalToggles {
  inspectorOpen: boolean;
  setInspectorOpen: Dispatch<SetStateAction<boolean>>;
  toolLogOpen: boolean;
  setToolLogOpen: Dispatch<SetStateAction<boolean>>;
  browserSandboxOpen: boolean;
  setBrowserSandboxOpen: Dispatch<SetStateAction<boolean>>;
  showHelp: boolean;
  setShowHelp: Dispatch<SetStateAction<boolean>>;
  showHistorySearch: boolean;
  setShowHistorySearch: Dispatch<SetStateAction<boolean>>;
}

export function useChatModalToggles(): ChatModalToggles {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toolLogOpen, setToolLogOpen] = useState(false);
  const [browserSandboxOpen, setBrowserSandboxOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showHistorySearch, setShowHistorySearch] = useState(false);

  return {
    inspectorOpen,
    setInspectorOpen,
    toolLogOpen,
    setToolLogOpen,
    browserSandboxOpen,
    setBrowserSandboxOpen,
    showHelp,
    setShowHelp,
    showHistorySearch,
    setShowHistorySearch,
  };
}
