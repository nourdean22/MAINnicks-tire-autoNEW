/**
 * Inline chart renderer · v10.0.49 · Apr 30.
 *
 * Pure-React SVG chart for inline rendering inside Nick's reply
 * markdown. The `renderInlineChart` Nick tool emits a fenced block:
 *
 *   ```chart
 *   {"type":"line","title":"Revenue 7d","data":[{...},...]}
 *   ```
 *
 * The Streamdown `code` override in `nick-message.tsx` detects the
 * `language-chart` className and hands the JSON payload to this
 * component. Bad payloads degrade gracefully to a plain code-block.
 *
 * Design constraints:
 *   · Pure SVG, no chart library — keeps bundle lean and theme
 *     colors stay native via `currentColor` / CSS vars.
 *   · viewBox-driven so it scales fluidly inside the message bubble.
 *   · Theme-aware: respects `var(--gold)`, `var(--text-tertiary)`,
 *     `var(--border-default)`. Five accent colors (gold/emerald/
 *     rose/blue/violet) that match the rest of the chat surface.
 *   · Accessible: `<title>` element + aria-label.
 *
 * Ports the "Inline Visualizer" plugin from open-webui-plugins
 * (Python) into the autonicks.com TypeScript stack — instead of
 * cloning the plugin, we re-implemented its surface in the existing
 * Vercel AI SDK + Streamdown architecture so it composes with
 * AgentTrace, the tool-catalog gate, and the message renderer.
 */

import * as React from "react";

export type ChartType = "line" | "bar" | "sparkline" | "pie";
export type ChartColor = "gold" | "emerald" | "rose" | "blue" | "violet";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSpec {
  type: ChartType;
  data: ChartPoint[];
  title?: string;
  color?: ChartColor;
}

const COLOR_MAP: Record<ChartColor, { stroke: string; fill: string }> = {
  gold: { stroke: "var(--gold)", fill: "var(--gold)" },
  emerald: { stroke: "#10b981", fill: "#10b981" },
  rose: { stroke: "#f43f5e", fill: "#f43f5e" },
  blue: { stroke: "#3b82f6", fill: "#3b82f6" },
  violet: { stroke: "#8b5cf6", fill: "#8b5cf6" },
};

const PIE_PALETTE = [
  "var(--gold)",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f43f5e",
  "#06b6d4",
  "#f59e0b",
  "#ec4899",
];

/**
 * Try to parse a JSON chart spec. Returns null on any malformed
 * input — caller renders a fallback. Validates shape strictly so a
 * hallucinated payload never crashes the message renderer.
 */
export function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const type = parsed.type as ChartType;
    if (!["line", "bar", "sparkline", "pie"].includes(type)) return null;
    if (!Array.isArray(parsed.data)) return null;
    const data: ChartPoint[] = [];
    for (const p of parsed.data.slice(0, 60)) {
      if (!p || typeof p !== "object") continue;
      const label = typeof p.label === "string" ? p.label : String(p.label ?? "");
      // Strict: only accept numeric value. Pre-fix this used Number(p.value)
      // which silently coerced null → 0 and "" → 0, polluting the chart with
      // bogus zero points whenever the LLM hallucinated a missing value.
      if (typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
      data.push({ label, value: p.value });
    }
    if (data.length === 0) return null;
    const color = (["gold", "emerald", "rose", "blue", "violet"].includes(parsed.color)
      ? parsed.color
      : "gold") as ChartColor;
    const title = typeof parsed.title === "string" ? parsed.title : undefined;
    return { type, data, title, color };
  } catch {
    return null;
  }
}

export function InlineChart({ spec }: { spec: ChartSpec }) {
  return (
    <div className="my-3">
      {spec.title && (
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-1.5">
          {spec.title}
        </p>
      )}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-2.5">
        {spec.type === "line" || spec.type === "sparkline" ? (
          <LineChart spec={spec} />
        ) : spec.type === "bar" ? (
          <BarChart spec={spec} />
        ) : (
          <PieChart spec={spec} />
        )}
      </div>
    </div>
  );
}

// ── Line / Sparkline ──────────────────────────────────────────────

function LineChart({ spec }: { spec: ChartSpec }) {
  const isSparkline = spec.type === "sparkline";
  const W = 320;
  const H = isSparkline ? 48 : 140;
  const PAD_X = isSparkline ? 2 : 28;
  const PAD_TOP = isSparkline ? 4 : 8;
  const PAD_BOTTOM = isSparkline ? 4 : 22;

  const values = spec.data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const colors = COLOR_MAP[spec.color ?? "gold"];

  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const stepX = spec.data.length > 1 ? innerW / (spec.data.length - 1) : 0;

  const points = spec.data.map((d, i) => {
    const x = PAD_X + i * stepX;
    const y = PAD_TOP + innerH - ((d.value - min) / range) * innerH;
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `M ${points[0].x.toFixed(1)} ${(PAD_TOP + innerH).toFixed(1)} ` +
        points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
        ` L ${points[points.length - 1].x.toFixed(1)} ${(PAD_TOP + innerH).toFixed(1)} Z`
      : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={spec.title ?? `${spec.type} chart with ${spec.data.length} points`}
    >
      <title>{spec.title ?? `${spec.type} chart`}</title>
      {!isSparkline && (
        // Y-axis tick marks (3 lines: min, mid, max)
        <g>
          {[0, 0.5, 1].map((t) => {
            const y = PAD_TOP + innerH * (1 - t);
            const value = min + range * t;
            return (
              <g key={t}>
                <line
                  x1={PAD_X}
                  x2={W - PAD_X}
                  y1={y}
                  y2={y}
                  stroke="var(--border-default)"
                  strokeOpacity={0.3}
                  strokeDasharray="2 3"
                />
                <text
                  x={PAD_X - 4}
                  y={y + 3}
                  fontSize="9"
                  fill="var(--text-tertiary)"
                  textAnchor="end"
                  fontFamily="ui-monospace, monospace"
                >
                  {fmtAxis(value)}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {/* Soft area under the line */}
      <path d={areaPath} fill={colors.fill} fillOpacity={0.08} />
      <polyline
        points={polyline}
        fill="none"
        stroke={colors.stroke}
        strokeWidth={isSparkline ? 1.4 : 1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {!isSparkline &&
        points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={2.2}
            fill={colors.fill}
          >
            <title>
              {p.label}: {fmtValue(p.value)}
            </title>
          </circle>
        ))}
      {!isSparkline && spec.data.length > 0 && (
        // X-axis labels — show first / mid / last to avoid crowding
        <g>
          {[0, Math.floor(spec.data.length / 2), spec.data.length - 1]
            .filter((idx, i, arr) => arr.indexOf(idx) === i)
            .map((idx) => {
              const p = points[idx];
              return (
                <text
                  key={idx}
                  x={p.x}
                  y={H - 6}
                  fontSize="9"
                  fill="var(--text-tertiary)"
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                >
                  {truncate(spec.data[idx].label, 12)}
                </text>
              );
            })}
        </g>
      )}
    </svg>
  );
}

// ── Bar ───────────────────────────────────────────────────────────

function BarChart({ spec }: { spec: ChartSpec }) {
  const W = 320;
  const H = 140;
  const PAD_X = 28;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 22;

  const values = spec.data.map((d) => d.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const colors = COLOR_MAP[spec.color ?? "gold"];

  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const barWidth = innerW / spec.data.length;
  const zeroY = PAD_TOP + innerH - ((0 - min) / range) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title ?? "bar chart"}>
      <title>{spec.title ?? "bar chart"}</title>
      {[0, 0.5, 1].map((t) => {
        const y = PAD_TOP + innerH * (1 - t);
        const value = min + range * t;
        return (
          <g key={t}>
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y}
              y2={y}
              stroke="var(--border-default)"
              strokeOpacity={0.3}
              strokeDasharray="2 3"
            />
            <text
              x={PAD_X - 4}
              y={y + 3}
              fontSize="9"
              fill="var(--text-tertiary)"
              textAnchor="end"
              fontFamily="ui-monospace, monospace"
            >
              {fmtAxis(value)}
            </text>
          </g>
        );
      })}
      {spec.data.map((d, i) => {
        const x = PAD_X + i * barWidth + barWidth * 0.15;
        const w = barWidth * 0.7;
        const valY = PAD_TOP + innerH - ((d.value - min) / range) * innerH;
        const y = Math.min(valY, zeroY);
        const h = Math.abs(valY - zeroY);
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill={colors.fill} fillOpacity={0.85} rx={1.5}>
              <title>
                {d.label}: {fmtValue(d.value)}
              </title>
            </rect>
            {spec.data.length <= 12 && (
              <text
                x={x + w / 2}
                y={H - 6}
                fontSize="9"
                fill="var(--text-tertiary)"
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
              >
                {truncate(d.label, 8)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Pie ───────────────────────────────────────────────────────────

function PieChart({ spec }: { spec: ChartSpec }) {
  const W = 280;
  const H = 160;
  const cx = 80;
  const cy = H / 2;
  const r = 60;
  const total = spec.data.reduce((s, d) => s + Math.max(0, d.value), 0);
  if (total <= 0) {
    return (
      <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
        chart · empty (all values ≤ 0)
      </p>
    );
  }
  let acc = 0;
  const slices = spec.data.map((d, i) => {
    const v = Math.max(0, d.value);
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += v;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const path = `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
    return { path, fill: PIE_PALETTE[i % PIE_PALETTE.length], label: d.label, value: v };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title ?? "pie chart"}>
      <title>{spec.title ?? "pie chart"}</title>
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.fill} fillOpacity={0.85} stroke="var(--bg-raised)" strokeWidth={1.5}>
          <title>
            {s.label}: {fmtValue(s.value)} ({((s.value / total) * 100).toFixed(0)}%)
          </title>
        </path>
      ))}
      {/* Legend */}
      {slices.map((s, i) => (
        <g key={`legend-${i}`} transform={`translate(${2 * r + 30} ${20 + i * 14})`}>
          <rect width={9} height={9} fill={s.fill} rx={1} />
          <text
            x={14}
            y={8}
            fontSize="10"
            fill="var(--text-secondary)"
            fontFamily="ui-monospace, monospace"
          >
            {truncate(s.label, 18)} · {((s.value / total) * 100).toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "k";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (Math.abs(v) >= 1_000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
