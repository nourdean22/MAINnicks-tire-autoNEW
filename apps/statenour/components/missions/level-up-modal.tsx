"use client";

/**
 * Level-Up Modal — glassmorphic celebration overlay.
 *
 * Shown when a task completion pushes the operator to a new level.
 * Features:
 *   · Backdrop blur + gold border glow
 *   · Screen-edge ambient aura
 *   · New level + tier display with scale-in animation
 *   · Auto-dismiss after 5s or tap-anywhere
 *   · "View Stats" link to /stats
 */

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

export interface LevelUpModalProps {
  newLevel: number;
  tierName: string;
  tierEmoji: string;
  onClose: () => void;
}

export function LevelUpModal({
  newLevel,
  tierName,
  tierEmoji,
  onClose,
}: LevelUpModalProps) {
  const router = useRouter();

  // Auto-dismiss after 5 seconds.
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const handleViewStats = useCallback(() => {
    onClose();
    router.push("/stats");
  }, [onClose, router]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="level-up-backdrop"
        onClick={onClose}
        role="presentation"
      />

      {/* Ambient aura glow at screen edges */}
      <div className="level-up-aura" aria-hidden="true" />

      {/* Center card */}
      <div
        className="level-up-card"
        role="dialog"
        aria-label={`Level up! You reached level ${newLevel}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="level-up-emoji">{tierEmoji}</div>
        <div className="level-up-label">LEVEL UP</div>
        <div className="level-up-number">{newLevel}</div>
        <div className="level-up-tier">{tierName}</div>
        <button
          type="button"
          className="level-up-stats-btn"
          onClick={handleViewStats}
        >
          View Stats &rarr;
        </button>
        <button
          type="button"
          className="level-up-dismiss"
          onClick={onClose}
        >
          Continue
        </button>
      </div>

      <style jsx>{`
        .level-up-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9998;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: level-up-fade-in 0.3s ease-out forwards;
        }

        .level-up-aura {
          position: fixed;
          inset: 0;
          z-index: 9997;
          pointer-events: none;
          background: radial-gradient(
            ellipse at 50% 50%,
            rgba(245, 166, 35, 0.08) 0%,
            rgba(245, 166, 35, 0.03) 40%,
            transparent 70%
          );
          animation: level-up-aura-pulse 2s ease-in-out infinite alternate;
        }

        .level-up-card {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 32px 40px;
          border-radius: 20px;
          border: 1px solid rgba(245, 166, 35, 0.3);
          background: rgba(10, 10, 10, 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow:
            0 0 40px rgba(245, 166, 35, 0.15),
            0 0 80px rgba(245, 166, 35, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
          animation: level-up-card-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          min-width: 240px;
          text-align: center;
        }

        .level-up-emoji {
          font-size: 48px;
          line-height: 1;
          animation: level-up-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both;
        }

        .level-up-label {
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: var(--gold, #f5a623);
          margin-top: 8px;
        }

        .level-up-number {
          font-family: "Outfit", var(--font-sans, sans-serif);
          font-size: 64px;
          font-weight: 800;
          line-height: 1;
          color: #fff;
          text-shadow: 0 0 20px rgba(245, 166, 35, 0.4);
          animation: level-up-number-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both;
        }

        .level-up-tier {
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.6);
          margin-bottom: 16px;
        }

        .level-up-stats-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 8px 20px;
          border-radius: 8px;
          border: 1px solid rgba(245, 166, 35, 0.4);
          background: rgba(245, 166, 35, 0.1);
          color: var(--gold, #f5a623);
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }

        .level-up-stats-btn:hover {
          background: rgba(245, 166, 35, 0.2);
          border-color: rgba(245, 166, 35, 0.6);
        }

        .level-up-dismiss {
          margin-top: 4px;
          padding: 6px 16px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.4);
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: color 0.2s;
        }

        .level-up-dismiss:hover {
          color: rgba(255, 255, 255, 0.7);
        }

        @keyframes level-up-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes level-up-card-in {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.85);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }

        @keyframes level-up-bounce {
          from {
            opacity: 0;
            transform: scale(0.3);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes level-up-number-in {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.7);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes level-up-aura-pulse {
          from {
            opacity: 0.5;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
