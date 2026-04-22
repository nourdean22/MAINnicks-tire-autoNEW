/**
 * Sparkline — a tiny, dependency-free SVG trend indicator next to any KPI.
 *
 * Why this exists: adding Recharts for a 60×20 trend visualization is
 * overkill. This component is ~70 lines, no dependencies, and pixel-perfect
 * on mobile.
 *
 * Usage:
 *   <Sparkline values={[3,4,4,5,7,9,11]} />
 *   <Sparkline values={data} trend="up" showEndDot showArea />
 */

import { useMemo } from "react";

interface Props {
  /** Data values — sparkline auto-scales to min/max */
  values: number[];
  /** Width in pixels (default 80) */
  width?: number;
  /** Height in pixels (default 22) */
  height?: number;
  /** Stroke color (default = currentColor, so parent controls via text-color) */
  color?: string;
  /** Fill under line (default false) */
  showArea?: boolean;
  /** Show the end-point dot (default true) */
  showEndDot?: boolean;
  /** Explicit trend for color cue — overrides inferred trend */
  trend?: "up" | "down" | "flat";
  /** Extra className on the svg */
  className?: string;
  /** aria-label for screen readers */
  label?: string;
}

export default function Sparkline({
  values,
  width = 80,
  height = 22,
  color,
  showArea = false,
  showEndDot = true,
  trend,
  className = "",
  label = "trend sparkline",
}: Props) {
  const { linePath, areaPath, endX, endY, inferredTrend } = useMemo(() => {
    if (!values.length) {
      return { linePath: "", areaPath: "", endX: 0, endY: 0, inferredTrend: "flat" as const };
    }
    if (values.length === 1) {
      // single data point → dot in the middle
      return {
        linePath: `M ${width / 2} ${height / 2}`,
        areaPath: "",
        endX: width / 2,
        endY: height / 2,
        inferredTrend: "flat" as const,
      };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1; // avoid div-by-zero for flat lines
    const step = width / (values.length - 1);

    const points = values.map((v, i) => {
      const x = i * step;
      // Invert Y because SVG origin is top-left
      const y = height - ((v - min) / range) * height;
      return [x, y] as const;
    });

    const lp = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const ap = `${lp} L ${width} ${height} L 0 ${height} Z`;

    const first = values[0];
    const last = values[values.length - 1];
    const delta = last - first;
    const inferredTrend: "up" | "down" | "flat" =
      Math.abs(delta) / (Math.abs(first) || 1) < 0.05
        ? "flat"
        : delta > 0
        ? "up"
        : "down";

    const [ex, ey] = points[points.length - 1];
    return { linePath: lp, areaPath: ap, endX: ex, endY: ey, inferredTrend };
  }, [values, width, height]);

  const effectiveTrend = trend ?? inferredTrend;
  const strokeColor = color ?? (
    effectiveTrend === "up"
      ? "rgb(52, 211, 153)"   // emerald-400
      : effectiveTrend === "down"
      ? "rgb(248, 113, 113)" // red-400
      : "rgb(148, 163, 184)" // slate-400
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label}
    >
      {showArea && <path d={areaPath} fill={strokeColor} fillOpacity={0.15} />}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndDot && values.length > 0 && (
        <circle cx={endX} cy={endY} r={2} fill={strokeColor} />
      )}
    </svg>
  );
}
