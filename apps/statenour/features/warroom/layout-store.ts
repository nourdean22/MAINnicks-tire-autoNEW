import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { WIDGET_REGISTRY } from "./manifest";

/**
 * War-Room · Slice 2 · window layout store (persisted).
 *
 * Holds each widget window's rect (world x/y, size, z-order). Persisted
 * to localStorage so the desktop arrangement survives reloads — NO
 * Prisma table in Phase 1 (dodges the hand-applied migration / pgvector
 * hazard). `skipHydration` + a mount-time `rehydrate()` in SpatialCanvas
 * keeps SSR and the first client render on defaults (no hydration
 * mismatch); `merge` guarantees newly-registered widgets appear even
 * against an older saved layout.
 */

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

function defaultLayout(): Record<string, WindowRect> {
  const out: Record<string, WindowRect> = {};
  WIDGET_REGISTRY.forEach((m, i) => {
    out[m.id] = {
      x: m.defaultPos.x,
      y: m.defaultPos.y,
      w: m.defaultSize.w,
      h: m.defaultSize.h,
      z: i + 1,
    };
  });
  return out;
}

interface LayoutState {
  windows: Record<string, WindowRect>;
  topZ: number;
  moveWindow: (id: string, x: number, y: number) => void;
  bringToFront: (id: string) => void;
  resetLayout: () => void;
}

export const useWarRoomLayout = create<LayoutState>()(
  persist(
    (set) => ({
      windows: defaultLayout(),
      topZ: WIDGET_REGISTRY.length,
      moveWindow: (id, x, y) =>
        set((s) => {
          const cur = s.windows[id];
          if (!cur) return s;
          return { windows: { ...s.windows, [id]: { ...cur, x, y } } };
        }),
      bringToFront: (id) =>
        set((s) => {
          const cur = s.windows[id];
          if (!cur) return s;
          const nz = s.topZ + 1;
          return { topZ: nz, windows: { ...s.windows, [id]: { ...cur, z: nz } } };
        }),
      resetLayout: () => set({ windows: defaultLayout(), topZ: WIDGET_REGISTRY.length }),
    }),
    {
      name: "warroom:layout:v1",
      // Safe on the server: skipHydration + lazy invocation means this
      // getter only runs on the client (rehydrate / setItem), never at
      // SSR module-load — so `window` is never dereferenced server-side.
      storage: createJSONStorage(() => window.localStorage),
      skipHydration: true,
      // Persisted layout wins, but always fold in defaults so a widget
      // added after the layout was saved still renders.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayoutState>;
        return {
          ...current,
          ...p,
          windows: { ...current.windows, ...(p.windows ?? {}) },
        };
      },
    },
  ),
);
