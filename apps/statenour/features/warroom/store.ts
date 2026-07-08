import { create } from "zustand";

/**
 * War-Room · Slice 1 · pan/zoom store.
 *
 * The single source of truth for the spatial canvas viewport. Holds the
 * forward transform (`translate(panX,panY) scale(zoom)`) that the world
 * layer applies. Zoom is anchored at a stage-space point so the world
 * position under the cursor stays put while zooming — the same math the
 * Slice-0 spike self-verified (round-trip error ~0px across zoom).
 *
 * Slice 4 (the task→mission drag) will invert this transform for drop
 * hit-testing; keeping the zoom math here means both share one truth.
 */

export interface WarRoomView {
  panX: number;
  panY: number;
  zoom: number;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.6;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Initial view framed on the seed-tile cluster (world ~1120–1780, 300–860). */
const INITIAL: WarRoomView = { panX: -880, panY: -220, zoom: 1 };

export interface WarRoomState extends WarRoomView {
  panBy: (dx: number, dy: number) => void;
  setPan: (panX: number, panY: number) => void;
  /** Zoom by `factor`, keeping the world point under stage-space (sx,sy) fixed. */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  reset: () => void;
}

export const useWarRoomStore = create<WarRoomState>((set) => ({
  ...INITIAL,
  panBy: (dx, dy) => set((s) => ({ panX: s.panX + dx, panY: s.panY + dy })),
  setPan: (panX, panY) => set({ panX, panY }),
  zoomAt: (factor, sx, sy) =>
    set((s) => {
      const nz = clampZoom(s.zoom * factor);
      if (nz === s.zoom) return s;
      // world point currently under (sx,sy): wx = (sx - panX) / zoom
      const wx = (sx - s.panX) / s.zoom;
      const wy = (sy - s.panY) / s.zoom;
      // solve new pan so that wx,wy re-projects back onto (sx,sy) at nz
      return { zoom: nz, panX: sx - wx * nz, panY: sy - wy * nz };
    }),
  reset: () => set({ ...INITIAL }),
}));
