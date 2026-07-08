import type { Metadata } from "next";
import { SpatialCanvas } from "@/features/warroom/spatial-canvas";

/**
 * /warroom · Slice 1 · the SpatialCanvas shell.
 *
 * Renders inside the (mastery) layout (TRPCProvider + NourStateProvider,
 * force-dynamic, owner-gated via middleware). The surface itself is a
 * client component (pointer/wheel/keyboard interaction + zustand view).
 */
export const metadata: Metadata = { title: "War-Room" };

export default function WarRoomPage() {
  return <SpatialCanvas />;
}
