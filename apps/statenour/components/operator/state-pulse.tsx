"use client";

/**
 * components/operator/state-pulse.tsx · 2026-05-23 · UI #3.
 *
 * Living visualization of the operator-state model. The 5 dimensions
 * (focus · capacity · drift · momentum · mood) rendered as concentric
 * SVG rings · Apple Watch activity-ring aesthetic adapted for the
 * editorial-minimalist palette.
 *
 * Why rings vs bars / dials / radar charts:
 *   · Concentric rings show all 5 dimensions simultaneously with no
 *     scale-comparison ambiguity · every ring uses the same 0-1 range
 *   · Inner ring = "core state" (mood) · outer rings = "external
 *     observable behavior" · the spatial metaphor matches the operator's
 *     own intuition (mood drives capacity drives focus drives...)
 *   · Color encodes mood at a glance · operator can read the pulse
 *     without parsing numbers
 *
 * Motion:
 *   · Subtle pulse on each ring · period scales with momentum
 *     (high momentum = faster pulse · energized feel)
 *   · Drift ring oscillates · "jitter" when drift is high
 *   · respects prefers-reduced-motion · static when set
 *
 * Pure SVG + CSS · no chart lib · no animation lib · ~150 LOC.
 */

import { cn } from "@/lib/utils";

type Mood = "energized" | "neutral" | "depleted" | "scattered";

export interface StatePulseProps {
  focus: number; // 0-1
  capacity: number; // 0-1
  drift: number; // 0-1
  momentum: number; // 0-1
  mood: Mood;
  /** Confidence · 0-1 · low values dim the entire visualization. */
  confidence?: number;
  /** Diameter in CSS px · default 220. Responsive · respects parent. */
  size?: number;
  className?: string;
}

// Per-mood color palette · gold-on-dark theme with subtle hue shifts
// for each emotional state. All colors hover near editorial palette ·
// no neon · no purple gradients (per frontend-design skill).
const MOOD_PALETTE: Record<
  Mood,
  { primary: string; accent: string; glow: string; label: string }
> = {
  energized: {
    primary: "rgb(94 234 212)", // teal-300 · forward energy
    accent: "rgb(45 212 191)",
    glow: "rgb(45 212 191 / 0.20)",
    label: "Energized",
  },
  neutral: {
    primary: "rgb(253 185 19)", // gold · default brand color
    accent: "rgb(252 211 77)",
    glow: "rgb(253 185 19 / 0.15)",
    label: "Neutral",
  },
  depleted: {
    primary: "rgb(251 113 133)", // rose-400 · drained, warm but soft
    accent: "rgb(244 63 94)",
    glow: "rgb(251 113 133 / 0.15)",
    label: "Depleted",
  },
  scattered: {
    primary: "rgb(251 191 36)", // amber-400 · busy energy, unfocused
    accent: "rgb(245 158 11)",
    glow: "rgb(251 191 36 / 0.15)",
    label: "Scattered",
  },
};

interface RingSpec {
  label: string;
  value: number;
  radiusPct: number;
  hint: string;
}

export function StatePulse({
  focus,
  capacity,
  drift,
  momentum,
  mood,
  confidence = 1,
  size = 220,
  className,
}: StatePulseProps) {
  const palette = MOOD_PALETTE[mood];
  // Momentum drives the pulse period · high momentum = fast pulse.
  // Inverted because lower momentum should breathe slower (calmer).
  const pulseSeconds = 4.5 - momentum * 2.5; // 2s → 4.5s range
  const dim = Math.max(0.35, confidence); // never fully invisible

  // 4 rings from outside in · focus / capacity / drift / momentum.
  // Mood is the inner core circle.
  const rings: RingSpec[] = [
    {
      label: "focus",
      value: focus,
      radiusPct: 0.46,
      hint: "completion-rate over last 24h",
    },
    {
      label: "capacity",
      value: capacity,
      radiusPct: 0.38,
      hint: "headroom vs 7-day baseline",
    },
    {
      label: "drift",
      value: drift,
      radiusPct: 0.30,
      hint: "open DOING tasks vs recent completions",
    },
    {
      label: "momentum",
      value: momentum,
      radiusPct: 0.22,
      hint: "7d completions slope",
    },
  ];

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = Math.max(4, size * 0.025);

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        className,
      )}
      style={{
        width: size,
        height: size,
        opacity: dim,
      }}
      aria-label={`Operator state · mood ${palette.label}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        className="block"
      >
        {/* Outer glow · soft halo · only visible when confidence > 0.5 */}
        {confidence > 0.5 ? (
          <circle
            cx={cx}
            cy={cy}
            r={size * 0.48}
            fill="none"
            stroke={palette.glow}
            strokeWidth={size * 0.04}
            opacity={0.6}
            style={{
              animation: `state-pulse-glow ${pulseSeconds.toFixed(2)}s ease-in-out infinite`,
              transformOrigin: "center",
            }}
          />
        ) : null}

        {/* 4 concentric value rings */}
        {rings.map((ring, idx) => {
          const radius = size * ring.radiusPct;
          const circumference = 2 * Math.PI * radius;
          const value = Math.max(0, Math.min(1, ring.value));
          const offset = circumference * (1 - value);
          // Drift ring jitters · slightly larger animation amplitude
          // proportional to drift value itself · feels like static.
          const isDriftRing = ring.label === "drift";
          const driftJitter =
            isDriftRing && drift > 0.4 ? `state-pulse-jitter ${(2 - drift).toFixed(2)}s ease-in-out infinite` : undefined;
          return (
            <g key={ring.label} style={{ animation: driftJitter }}>
              {/* Background track · faint */}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="rgb(255 255 255 / 0.04)"
                strokeWidth={strokeWidth}
              />
              {/* Value arc · rotated -90° so the arc starts at 12 o'clock */}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={idx === 0 ? palette.primary : palette.accent}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{
                  // Each ring breathes at a slightly different rate so
                  // the visualization doesn't feel mechanical.
                  animation: `state-pulse-ring ${(pulseSeconds + idx * 0.3).toFixed(2)}s ease-in-out infinite`,
                  opacity: 0.85,
                }}
              />
            </g>
          );
        })}

        {/* Center mood label · operator's emotional anchor */}
        <text
          x={cx}
          y={cy - size * 0.02}
          textAnchor="middle"
          fontSize={size * 0.07}
          fontWeight={600}
          fill={palette.primary}
          fontFamily="var(--font-display), system-ui, sans-serif"
          style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
        >
          {palette.label.toLowerCase()}
        </text>
        <text
          x={cx}
          y={cy + size * 0.06}
          textAnchor="middle"
          fontSize={size * 0.045}
          fill="rgb(156 156 156)"
          fontFamily="var(--font-mono), monospace"
          style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          {Math.round(confidence * 100)}%
        </text>
      </svg>

      <style jsx>{`
        @keyframes state-pulse-ring {
          0%, 100% {
            opacity: 0.85;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.012);
          }
        }
        @keyframes state-pulse-glow {
          0%, 100% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.04);
          }
        }
        @keyframes state-pulse-jitter {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(0.6px, -0.4px); }
          50% { transform: translate(-0.4px, 0.5px); }
          75% { transform: translate(0.3px, 0.3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          :global([aria-label*="Operator state"]) circle {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
