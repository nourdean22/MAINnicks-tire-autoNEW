"use client";

/**
 * ConfirmHold — press-and-hold confirmation button.
 *
 * Item #22 from the excellence marathon. Replaces "are you sure?"
 * modals with a progress-ring button the user holds for ~800ms. Feels
 * intentional, impossible to trigger accidentally, and avoids the
 * "click two buttons" chore that kills flow.
 *
 * Fires `onConfirm()` only after the hold duration elapses without
 * the user releasing. If they release early, the ring resets. Haptic
 * warn on start, success on confirm.
 *
 * Usage:
 *   <ConfirmHold
 *     label="Delete"
 *     onConfirm={() => deleteConvo(id)}
 *     variant="danger"
 *   />
 */

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptic";

interface ConfirmHoldProps {
  label: string;
  onConfirm: () => void;
  holdMs?: number;
  variant?: "default" | "danger" | "gold";
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function ConfirmHold({
  label,
  onConfirm,
  holdMs = 800,
  variant = "default",
  icon,
  className,
  disabled,
}: ConfirmHoldProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    stopLoop();
    setHolding(false);
    setProgress(0);
  }, [stopLoop]);

  const start = useCallback(() => {
    if (disabled) return;
    haptic.warn();
    setHolding(true);
    startRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(1, elapsed / holdMs);
      setProgress(p);
      if (p >= 1) {
        haptic.success();
        setHolding(false);
        setProgress(0);
        onConfirm();
        stopLoop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, holdMs, onConfirm, stopLoop]);

  const colorMap = {
    default: {
      border: "border-[var(--border-default)]",
      text: "text-[var(--text-secondary)]",
      ring: "stroke-[var(--text-secondary)]",
      bg: "bg-[var(--bg-raised)]",
    },
    danger: {
      border: "border-red-500/40",
      text: "text-red-400",
      ring: "stroke-red-500",
      bg: "bg-red-500/10",
    },
    gold: {
      border: "border-[var(--gold)]/40",
      text: "text-[var(--gold)]",
      ring: "stroke-[var(--gold)]",
      bg: "bg-[var(--gold)]/10",
    },
  } as const;

  const c = colorMap[variant];
  const circumference = 2 * Math.PI * 14; // r=14
  const offset = circumference * (1 - progress);

  return (
    <button
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      disabled={disabled}
      className={cn(
        "relative flex items-center gap-2 h-9 px-3 rounded-md border text-[11px] font-bold uppercase tracking-wider transition-all select-none touch-none",
        c.border,
        c.text,
        c.bg,
        holding && "scale-[0.97]",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
      title={`Hold to ${label.toLowerCase()}`}
    >
      {/* Progress ring — fills around the icon during hold */}
      <span className="relative w-5 h-5 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 32 32" className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="16" cy="16" r="14" fill="none" strokeWidth="2" className="stroke-current opacity-20" />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn(c.ring, "transition-[stroke-dashoffset] duration-75")}
          />
        </svg>
        <span className="relative">{icon}</span>
      </span>
      <span>{holding ? "Hold…" : label}</span>
    </button>
  );
}
