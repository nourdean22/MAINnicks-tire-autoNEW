"use client";

/**
 * OwnerPanel · 2026-09-23 · Q-24 — what needs the owner, and nothing else.
 *
 * Sits directly under the control tower on /system and speaks its language:
 * one verdict line, then only the rows that need him. Three blocks —
 * exceptions (each with its age and the row it rests on), decisions waiting
 * on him, and cost per outcome with every tile labelled MEASURED, ESTIMATE
 * or UNMEASURED. All logic is server-side in lib/system/owner-panel.ts; this
 * file renders what the server decided.
 *
 * Three states, never two (empty-vs-error): a failed query renders
 * "couldn't load — state unknown, not empty"; a source the server could not
 * read is named under the verdict; an UNMEASURED tile shows its reason, not
 * a zero. Read-only: no buttons that act, only links to the surfaces that do.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import type { CostTile, OwnerItem } from "@/lib/system/owner-panel";

function age(min: number | null): string {
  if (min == null) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const PROVENANCE_TONE: Record<CostTile["provenance"], string> = {
  MEASURED: "text-emerald-300",
  ESTIMATE: "text-amber-300",
  UNMEASURED: "text-fg-tertiary",
};

function Row({ item }: { item: OwnerItem }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[15px]",
            item.tone === "rose" ? "text-rose-200" : item.tone === "amber" ? "text-amber-100" : "text-fg",
          )}
        >
          {item.title}
        </span>
        {item.detail && <span className="block truncate text-[13px] text-fg-secondary">{item.detail}</span>}
        <span className="block truncate font-mono text-[11px] text-fg-tertiary">{item.evidence}</span>
      </span>
      <span className="shrink-0 text-right font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        {age(item.ageMin)}
        {item.href && <span className="block text-fg-secondary group-hover:text-fg">open ↗</span>}
      </span>
    </>
  );
  return (
    <li>
      {item.href ? (
        <Link href={item.href} className="group flex min-h-[48px] items-start gap-3 py-2">
          {body}
        </Link>
      ) : (
        <div className="flex min-h-[48px] items-start gap-3 py-2">{body}</div>
      )}
    </li>
  );
}

export function OwnerPanel() {
  const q = trpc.system.ownerPanel.useQuery(undefined, { refetchInterval: 60_000 });
  const p = q.data;
  const decisionsUnknown =
    p?.unreadable.includes("approvals") ||
    p?.unreadable.includes("action attempts") ||
    false;

  if (!p) {
    return (
      <section aria-labelledby="owner-heading" className="border-l-2 border-edge pl-5 sm:pl-6">
        <h2 id="owner-heading" className="vt-eyebrow text-fg-secondary">
          needs you
        </h2>
        <p className="mt-3 text-[15px] text-fg-secondary">
          {q.isError ? "Couldn't load — state unknown, not empty." : "Reading exceptions, decisions and cost…"}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="owner-heading"
      data-owner-panel={p.state}
      className={cn(
        "border-l-2 pl-5 sm:pl-6",
        p.state === "attention" ? "border-amber-400" : p.state === "clear" ? "border-emerald-400/70" : "border-edge",
      )}
    >
      <h2 id="owner-heading" className="vt-eyebrow text-fg-secondary">
        needs you
      </h2>
      <p className={cn("mt-3 text-2xl font-semibold", p.state === "attention" ? "text-amber-200" : p.state === "unknown" ? "text-fg-secondary" : "text-fg")}>
        {p.headline}
      </p>
      {(p.unreadable.length > 0 || q.isError) && (
        <p className="mt-2 text-[13px] text-amber-200/80">
          {q.isError ? "Last refresh failed — showing the previous read. " : ""}
          {p.unreadable.length > 0 && `Unreadable, so not cleared: ${p.unreadable.join(", ")}.`}
        </p>
      )}

      {p.exceptions.length > 0 && (
        <ul aria-label="owner exceptions" className="mt-5 divide-y divide-edge border-y border-edge">
          {p.exceptions.map((e) => (
            <Row key={e.key} item={e} />
          ))}
        </ul>
      )}

      <h3 className="mt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        decisions waiting · {decisionsUnknown ? "unknown" : p.decisions.length + p.decisionsHidden}
      </h3>
      {p.decisions.length > 0 ? (
        <ul aria-label="decisions waiting" className="mt-2 divide-y divide-edge border-y border-edge">
          {p.decisions.map((d) => (
            <Row key={d.key} item={d} />
          ))}
          {p.decisionsHidden > 0 && (
            <li>
              <Link href="/system/actions" className="flex min-h-[48px] items-center text-[13px] text-fg-secondary hover:text-fg">
                {p.decisionsHidden} more in the approval queue ↗
              </Link>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-fg-secondary">
          {decisionsUnknown
            ? "Decision sources unreadable — state unknown."
            : "No approval is waiting on you."}
        </p>
      )}

      <h3 className="mt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">cost per outcome</h3>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {p.cost.map((t) => (
          <div key={t.key} className="min-w-0">
            <dt className="flex items-baseline justify-between gap-2 text-[13px] text-fg-secondary">
              <span className="truncate">{t.label}</span>
              <span className={cn("shrink-0 font-mono text-[11px]", PROVENANCE_TONE[t.provenance])}>
                {t.provenance}
              </span>
            </dt>
            <dd>
              <span className={cn("block font-mono text-lg", t.value == null ? "text-fg-tertiary" : "text-fg")}>
                {t.value ?? "—"}
              </span>
              <span className="block text-[12px] text-fg-tertiary">{t.note}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
