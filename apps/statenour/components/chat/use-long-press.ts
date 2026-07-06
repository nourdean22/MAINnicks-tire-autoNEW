"use client";

/**
 * useLongPress — unified touch + mouse long-press detector for
 * phone-first message actions.
 *
 * Usage: spread {...handlers} onto any element. Fires onLongPress
 * after holdMs of no movement, ignores accidental scroll gestures.
 */

import { useCallback, useRef } from "react";

interface Options {
  onLongPress: () => void;
  holdMs?: number;
  moveTolerance?: number;
  onClick?: () => void;
}

export function useLongPress({
  onLongPress,
  holdMs = 500,
  moveTolerance = 8,
  onClick,
}: Options) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  // 2026-07-06 · track drag so a drag-to-SELECT (copy text) is not mistaken
  // for a tap and does NOT trigger onClick (e.g. tap-to-edit). Without this,
  // making the bubble text selectable would fire onClick on every select.
  const movedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      firedRef.current = false;
      movedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      clear();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        onLongPress();
      }, holdMs);
    },
    [onLongPress, holdMs, clear],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.hypot(dx, dy) > moveTolerance) {
        movedRef.current = true; // this was a drag (scroll or text-select), not a tap
        clear();
      }
    },
    [moveTolerance, clear],
  );

  const onPointerUp = useCallback(() => {
    if (!firedRef.current && !movedRef.current && startRef.current && onClick) {
      onClick();
    }
    clear();
    startRef.current = null;
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => {
    clear();
    startRef.current = null;
  }, [clear]);

  // Suppress context menu on long-press (right-click / iOS hold)
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (firedRef.current) e.preventDefault();
    },
    [],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel: onPointerLeave,
    onContextMenu,
  };
}
