/**
 * BrandMark — Nick's Tire & Auto logo badge.
 *
 * Vector recreation of the shop's metal hangtag pendant:
 *   - Tire-tread ring border (dashed circle)
 *   - "NICK'S" stacked over "TIRE & AUTO"
 *   - "CLEVELAND TOUGH" banner at the bottom
 *   - Dark navy background, yellow primary text, white secondary
 *
 * Scalable from 24px (favicon) to 512px (hero) with no quality loss.
 * No image file needed — inline SVG ships with the bundle.
 *
 * Variants:
 *   - "full"    → full pendant with tagline banner (default)
 *   - "compact" → circle only, no tagline (navbar use)
 *   - "mark"    → just the "N" tire tread mark (favicon / small spaces)
 */

import React from "react";

interface BrandMarkProps {
  size?: number;
  variant?: "full" | "compact" | "mark";
  /** Override the navy background — set transparent for custom backdrops */
  background?: string;
  className?: string;
  title?: string;
}

export default function BrandMark({
  size = 96,
  variant = "full",
  background = "#0a1628",
  className = "",
  title = "Nick's Tire & Auto — Cleveland Tough",
}: BrandMarkProps) {
  // Base viewBox matches the hangtag aspect
  const vb = variant === "full" ? "0 0 120 140" : "0 0 120 120";
  const h = variant === "full" ? size * (140 / 120) : size;

  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={h}
      viewBox={vb}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        {/* Subtle metallic gradient for the pendant background */}
        <linearGradient id="bm-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={background} />
          <stop offset="50%" stopColor={shade(background, 10)} />
          <stop offset="100%" stopColor={shade(background, -15)} />
        </linearGradient>
        {/* Yellow gradient — matches #FDB913 brand color */}
        <linearGradient id="bm-yellow" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFD447" />
          <stop offset="100%" stopColor="#FDB913" />
        </linearGradient>
        {/* Subtle tire-tread dash pattern for the border ring */}
        <pattern id="bm-tread" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#111" />
          <rect width="2" height="4" fill="#2a2a2a" />
        </pattern>
      </defs>

      {/* Hangtag hole + pendant body (only on "full" variant) */}
      {variant === "full" && (
        <>
          <circle cx="60" cy="6" r="3" fill="#555" stroke="#999" strokeWidth="0.5" />
          <rect x="54" y="8" width="12" height="4" rx="1" fill="#888" />
        </>
      )}

      {/* Rounded square backplate */}
      <rect
        x="4"
        y={variant === "full" ? 14 : 4}
        width="112"
        height={variant === "full" ? 122 : 112}
        rx="10"
        fill="url(#bm-bg)"
        stroke="#1f2d45"
        strokeWidth="1.5"
      />

      {/* Tire-tread border ring */}
      <circle
        cx="60"
        cy={variant === "full" ? 60 : 50}
        r="42"
        fill="none"
        stroke="#0d1a2e"
        strokeWidth="7"
      />
      <circle
        cx="60"
        cy={variant === "full" ? 60 : 50}
        r="42"
        fill="none"
        stroke="#2a3a55"
        strokeWidth="1"
        strokeDasharray="2 2"
      />

      {/* Inner circle backdrop (darker) */}
      <circle cx="60" cy={variant === "full" ? 60 : 50} r="34" fill="#05101f" />

      {/* Text mark — shared layout for all variants */}
      {variant === "mark" ? (
        // Favicon-style: just the "N" big and bold (always centered in
        // the 112px backplate — no need to branch on variant here).
        <text
          x="60"
          y="65"
          textAnchor="middle"
          fontFamily="Arial Black, Helvetica, sans-serif"
          fontSize="48"
          fontWeight="900"
          fill="url(#bm-yellow)"
          style={{ letterSpacing: "-1px" }}
        >
          N
        </text>
      ) : (
        <>
          {/* NICK'S */}
          <text
            x="60"
            y={variant === "full" ? 55 : 45}
            textAnchor="middle"
            fontFamily="Arial Black, Helvetica, sans-serif"
            fontSize="20"
            fontWeight="900"
            fill="url(#bm-yellow)"
            style={{ letterSpacing: "-0.5px" }}
          >
            NICK&apos;S
          </text>
          {/* TIRE & AUTO */}
          <text
            x="60"
            y={variant === "full" ? 72 : 62}
            textAnchor="middle"
            fontFamily="Arial Black, Helvetica, sans-serif"
            fontSize="11"
            fontWeight="800"
            fill="#ffffff"
            style={{ letterSpacing: "1px" }}
          >
            TIRE &amp; AUTO
          </text>
        </>
      )}

      {/* CLEVELAND TOUGH banner — only on "full" variant */}
      {variant === "full" && (
        <>
          <rect x="12" y="110" width="96" height="18" rx="2" fill="#0f2345" stroke="#1a3460" strokeWidth="0.5" />
          <text
            x="60"
            y="123"
            textAnchor="middle"
            fontFamily="Arial Black, Helvetica, sans-serif"
            fontSize="10"
            fontWeight="800"
            fill="#ffffff"
            style={{ letterSpacing: "2px" }}
          >
            CLEVELAND TOUGH
          </text>
        </>
      )}
    </svg>
  );
}

// Tiny color-shade helper so the gradient varies without needing a color lib
function shade(hex: string, percent: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + percent));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + percent));
  const b = Math.max(0, Math.min(255, (num & 0xff) + percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
