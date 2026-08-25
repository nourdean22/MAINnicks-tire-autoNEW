import { statusToneMap } from "@/lib/domain";
import { toSentenceCase } from "@/lib/utils/format";
import { ParentBackLink } from "./parent-back-link";

type PageHeaderProps = {
  /** v10.0.221 · ReactNode so adopters can fold a domain code +
   *  stakes badge into the eyebrow without a separate sibling. The
   *  link-review primitive makes this pattern useful on detail pages. */
  eyebrow: React.ReactNode;
  title: string;
  // v-truth · ReactNode (was string) so pages with live-metric subtitles
  // (seo clicks, funnel rates, financial pace) can adopt StandardPage
  // without dropping their inline JSX. string still satisfies ReactNode.
  description: React.ReactNode;
  actions?: React.ReactNode;
  /** v10.0.529.50 · Wave 4 nav upgrade · optional back-link to a
   *  parent hub. When set, renders a thin "← <label>" link above the
   *  eyebrow. Sub-pages under /system or /brain pass parentHref="/system"
   *  + parentLabel="system" to give the operator a one-tap path back.
   *  Pre-fix, sub-pages were a dead end · operator had to retype URLs. */
  parentHref?: string;
  parentLabel?: string;
};

const toneClassMap: Record<string, string> = {
  amber: "badge-amber",
  blue: "badge-blue",
  lime: "badge-lime",
  orange: "badge-orange",
  purple: "badge-purple",
  rose: "badge-rose",
  slate: "badge-slate",
  violet: "badge-violet",
  zinc: "badge-zinc"
};

export function PageHeader({ eyebrow, title, description, actions, parentHref, parentLabel }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {parentHref && parentLabel && (
          <div className="mb-1.5">
            <ParentBackLink href={parentHref} label={parentLabel} />
          </div>
        )}
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-copy">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

// MetricCard previously lived here as a second variant (label/value/copy
// props, plain markup). Removed during the v11.1 alive-layer unification
// — the canonical MetricCard lives in `@/components/metric-card` with
// label/value/hint + AnimatedCounter. All callers migrated 2026-04-22.

export function PanelHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="section-title">{title}</h2>
        {description ? <p className="section-copy">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) {
    return <span className="badge badge-zinc">Unknown</span>;
  }

  const tone = toneClassMap[statusToneMap[value] || "slate"] || "badge-slate";
  return <span className={`badge ${tone}`}>{toSentenceCase(value)}</span>;
}

// REMOVED 2026-08-24: a second `EmptyState` taking only { title, copy }.
// Exported, zero importers, and it was the loophole — a component could render
// an empty surface with no provenance at all just by importing this one instead
// of components/ui/empty-state. A required prop is only required if there is no
// second door. Use <EmptyState> from "@/components/ui/empty-state".
