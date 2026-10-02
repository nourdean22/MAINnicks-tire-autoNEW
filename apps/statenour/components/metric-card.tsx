import { Panel } from "@/components/panel";
import { AnimatedCounter } from "@/components/ui/animated-counter";

export function MetricCard({
  label,
  value,
  hint
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Panel className="rounded-[20px] border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-4 shadow-none">
      <p className="eyebrow">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="metric text-3xl font-semibold tracking-tight text-white">
          {typeof value === "number" ? <AnimatedCounter value={value} /> : value}
        </p>
        {hint ? <p className="max-w-[15ch] text-right text-xs text-fg-tertiary">{hint}</p> : null}
      </div>
    </Panel>
  );
}
