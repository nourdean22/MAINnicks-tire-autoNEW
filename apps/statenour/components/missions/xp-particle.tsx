"use client";

/**
 * XP Particle — floating "+N XP" animation on task completion.
 *
 * Renders at an absolute position, animates upward with opacity fade,
 * then auto-removes from the DOM after the animation completes. Pure
 * CSS keyframes — no JS animation loop, no layout thrash.
 */

import { useEffect, useState } from "react";

export interface XpParticleProps {
  /** XP amount to display (e.g. 1.4). Hidden when <= 0. */
  xp: number;
  /** Trigger key — change this to fire a new particle. */
  triggerKey: string | number;
}

/**
 * Drop this inside a `position: relative` container. On `triggerKey`
 * change it spawns a new particle at center-top that floats upward.
 */
export function XpParticle({ xp, triggerKey }: XpParticleProps) {
  const [particles, setParticles] = useState<
    { id: string; xp: number }[]
  >([]);

  useEffect(() => {
    if (xp <= 0 || !triggerKey) return;
    const id = `${triggerKey}-${Date.now()}`;
    setParticles((prev) => [...prev, { id, xp }]);
    // Auto-remove after animation completes (1.2s + 100ms buffer).
    const timer = setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 1300);
    return () => clearTimeout(timer);
    // Intentionally fires only on triggerKey change — xp is read once per trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  if (particles.length === 0) return null;

  return (
    <>
      {particles.map((p) => (
        <span
          key={p.id}
          className="xp-particle"
          aria-hidden="true"
        >
          +{Number.isInteger(p.xp) ? p.xp : p.xp.toFixed(1)} XP
        </span>
      ))}
      <style jsx>{`
        .xp-particle {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 50;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--gold, #f5a623);
          text-shadow: 0 0 8px rgba(245, 166, 35, 0.5);
          animation: xp-float 1.2s cubic-bezier(0.25, 1, 0.5, 1) forwards;
        }

        @keyframes xp-float {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) translateY(0) scale(1);
          }
          60% {
            opacity: 1;
            transform: translate(-50%, -50%) translateY(-32px) scale(1.15);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) translateY(-56px) scale(0.9);
          }
        }
      `}</style>
    </>
  );
}
