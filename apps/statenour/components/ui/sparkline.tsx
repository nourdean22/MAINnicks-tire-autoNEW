"use client";

import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
  /** Show a dot on the latest value */
  showDot?: boolean;
  /** Animate the line drawing */
  animate?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "var(--gold)",
  fillOpacity = 0.1,
  className,
  showDot = true,
  animate = true,
}: SparklineProps) {
  if (!data.length || data.every(d => d === 0)) return null;

  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => ({
    x: padding + (i / (data.length - 1)) * w,
    y: padding + h - ((val - min) / range) * h,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const fillPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  const last = points[points.length - 1];
  const pathLength = estimatePathLength(points);

  // Render with preserveAspectRatio so the SVG scales to whatever
  // container width it gets (mobile safe). The `width` prop becomes
  // a MAX target — styles let it shrink below that on narrow screens
  // without pushing the parent. No more `shrink-0` — that used to
  // force 400px sparklines to overflow 375px viewports.
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMinYMid meet"
      style={{ width: "100%", maxWidth: `${width}px`, height: `${height}px` }}
      className={className}
    >
      {/* Fill */}
      <path
        d={fillPath}
        fill={color}
        opacity={fillOpacity}
      />
      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(animate ? {
          strokeDasharray: pathLength,
          strokeDashoffset: pathLength,
          style: { animation: `sparkline-draw 1s ease-out forwards` },
        } : {})}
      />
      {/* Latest value dot */}
      {showDot && (
        <circle
          cx={last.x}
          cy={last.y}
          r={2}
          fill={color}
        />
      )}
    </svg>
  );
}

function estimatePathLength(points: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return Math.ceil(len);
}
