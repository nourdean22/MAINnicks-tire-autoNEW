import { create } from "zustand";
import type { EntityRef } from "@/lib/ui/entity-ref";
import {
  addEntry,
  expiryFor,
  hasEntry,
  parseWorkset,
  pruneExpired,
  removeEntry,
  serializeWorkset,
  WORKSET_STORAGE_KEY,
  type WorksetEntry,
  type WorksetHorizon,
} from "@/lib/ui/workset";

/**
 * Workset store · 2026-09-15 (UI workbench slice 1).
 *
 * The rules are pure (lib/ui/workset.ts); this is the shared state plus
 * localStorage persistence. `hydrate()` is called once by the shelf on mount
 * (SSR-safe: nothing touches `window` at module load) and prunes expired
 * entries with the wall clock, so a "today" pin is gone tomorrow without a
 * timer.
 */
export interface WorksetState {
  entries: WorksetEntry[];
  hydrated: boolean;
  add: (ref: EntityRef, label: string, horizon?: WorksetHorizon, now?: Date) => void;
  remove: (ref: EntityRef) => void;
  clear: () => void;
  has: (ref: EntityRef) => boolean;
  hydrate: (now?: Date) => void;
}

function persist(entries: WorksetEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSET_STORAGE_KEY, serializeWorkset(entries));
  } catch {
    /* storage unavailable — in-memory shelf still works for the session */
  }
}

function load(): WorksetEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return parseWorkset(window.localStorage.getItem(WORKSET_STORAGE_KEY));
  } catch {
    return [];
  }
}

export const useWorksetStore = create<WorksetState>((set, get) => ({
  entries: [],
  hydrated: false,

  add: (ref, label, horizon = "today", now = new Date()) => {
    const entry: WorksetEntry = {
      ref,
      label: label.trim().slice(0, 120) || `${ref.kind} ${ref.id}`,
      horizon,
      pinnedAt: now.getTime(),
      expiresAt: expiryFor(horizon, now),
    };
    const entries = addEntry(get().entries, entry);
    persist(entries);
    set({ entries });
  },

  remove: (ref) => {
    const entries = removeEntry(get().entries, ref);
    persist(entries);
    set({ entries });
  },

  clear: () => {
    persist([]);
    set({ entries: [] });
  },

  has: (ref) => hasEntry(get().entries, ref),

  hydrate: (now = new Date()) => {
    if (get().hydrated) return;
    const entries = pruneExpired(load(), now.getTime());
    set({ entries, hydrated: true });
  },
}));
