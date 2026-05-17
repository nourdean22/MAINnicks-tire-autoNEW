"use client";

/**
 * /system/history · v8.0.1 · Apr 29.
 *
 * Universal entity-audit explorer. Three modes:
 *
 *   1. Per-entity history     — ?type=task&id=X
 *   2. Actor activity firehose — ?actor=nick (or any actor)
 *   3. Browse / picker         — empty querystring, presents quick-pick
 *      buttons + a free-form input
 *
 * Composes the Phase 2A entity-audit table + the EntityHistoryDrawer
 * component into a single permalink-friendly page so any deep link
 * (e.g. from an alert, or a "what changed" question) lands here with
 * the right view.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { EntityHistoryDrawer } from "@/components/system/entity-history-drawer";

import { authedFetch } from "@/hooks/use-authed-fetch";
const ENTITY_TYPES = [
  "task",
  "mission",
  "lifeGoal",
  "brainMemory",
  "masteryDecision",
  "commitment",
  "brainDump",
  "reflection",
  "identitySnapshot",
  "chatMessage",
] as const;

const ACTOR_QUICK_PICKS = [
  { value: "nick", label: "Nick (AI)" },
  { value: "user", label: "Me" },
  { value: "system", label: "System" },
  { value: "cron:brain-cycle", label: "cron · brain-cycle" },
  { value: "cron:weekly-review", label: "cron · weekly-review" },
];

interface FirehoseEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  reason: string | null;
  source: string | null;
  createdAt: string;
}

function HistoryPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const type = params.get("type") || "";
  const id = params.get("id") || "";
  const actor = params.get("actor") || "";
  const action = params.get("action") || "";
  const since = params.get("since") || "";

  const mode = useMemo<"entity" | "firehose" | "picker">(() => {
    if (type && id) return "entity";
    if (actor) return "firehose";
    return "picker";
  }, [type, id, actor]);

  // v8.7 BATCH 43 — chip-style filters update the URL params so
  // bookmarks remain shareable. Click a chip → shallow router push.
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.push(`/system/history?${next.toString()}`);
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="System"
        title="History"
        description="Universal entity-audit explorer · v8.0 Phase 2A"
      />

      <Panel className="mt-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">search</h2>
        <PickerForm
          initialType={type}
          initialId={id}
          initialActor={actor}
          onSubmit={(next) => {
            const qs = new URLSearchParams();
            if (next.type) qs.set("type", next.type);
            if (next.id) qs.set("id", next.id);
            if (next.actor) qs.set("actor", next.actor);
            router.push(`/system/history?${qs.toString()}`);
          }}
        />
      </Panel>

      <div className="mt-6">
        {mode === "entity" && (
          <Panel>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              history of {type}/{id.slice(0, 14)}
            </h2>
            <EntityHistoryDrawer
              entityType={type}
              entityId={id}
              defaultOpen
              limit={200}
              trigger={
                <button className="text-xs text-zinc-400 underline">
                  re-open drawer
                </button>
              }
            />
          </Panel>
        )}

        {mode === "firehose" && (
          <Panel>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              recent activity by {actor}
            </h2>
            {/* v8.7 BATCH 43 — filter chips */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                action:
              </span>
              {(["created", "updated", "soft_deleted", "restored", "purged"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setParam("action", action === a ? null : a)}
                  className={
                    "rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors " +
                    (action === a
                      ? "border-zinc-500 bg-zinc-700/50 text-zinc-100"
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200")
                  }
                >
                  {a.replace("_", " ")}
                </button>
              ))}
              <span className="ml-3 text-[10px] uppercase tracking-wider text-zinc-500">
                since:
              </span>
              {(
                [
                  { v: "1h", label: "1h" },
                  { v: "24h", label: "24h" },
                  { v: "7d", label: "7d" },
                  { v: "30d", label: "30d" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setParam("since", since === opt.v ? null : opt.v)}
                  className={
                    "rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors " +
                    (since === opt.v
                      ? "border-zinc-500 bg-zinc-700/50 text-zinc-100"
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200")
                  }
                >
                  {opt.label}
                </button>
              ))}
              {(action || since) && (
                <button
                  type="button"
                  onClick={() => {
                    setParam("action", null);
                    setParam("since", null);
                  }}
                  className="ml-2 rounded-full border border-rose-500/40 px-2 py-0.5 text-[10px] font-mono text-rose-300 hover:bg-rose-500/10"
                >
                  clear
                </button>
              )}
            </div>
            <FirehoseList actor={actor} action={action} since={since} />
          </Panel>
        )}

        {mode === "picker" && (
          <Panel>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
              quick picks
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Or fill the form above with type + id
            </p>
            <div className="flex flex-wrap gap-2">
              {ACTOR_QUICK_PICKS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => router.push(`/system/history?actor=${encodeURIComponent(p.value)}`)}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </main>
  );
}

function PickerForm({
  initialType,
  initialId,
  initialActor,
  onSubmit,
}: {
  initialType: string;
  initialId: string;
  initialActor: string;
  onSubmit: (next: { type: string; id: string; actor: string }) => void;
}) {
  const [type, setType] = useState(initialType);
  const [id, setId] = useState(initialId);
  const [actor, setActor] = useState(initialActor);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ type, id, actor });
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-zinc-400">
          Entity type
          <select
            className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">(any)</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Entity id
          <input
            className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            placeholder="cuid or numeric id"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Actor (firehose mode)
          <input
            className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            placeholder="user · nick · cron:..."
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          />
        </label>
      </div>
      <button
        type="submit"
        className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        Search
      </button>
    </form>
  );
}

function FirehoseList({
  actor,
  action,
  since,
}: {
  actor: string;
  action?: string;
  since?: string;
}) {
  const [entries, setEntries] = useState<FirehoseEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // v8.7 BATCH 43 — translate "1h" / "24h" / "7d" / "30d" into the
    // ISO datetime the API expects.
    const sinceIso = (() => {
      if (!since) return null;
      const m = since.match(/^(\d+)([hd])$/);
      if (!m) return null;
      const n = Number(m[1]);
      const ms = m[2] === "h" ? n * 3_600_000 : n * 86_400_000;
      return new Date(Date.now() - ms).toISOString();
    })();
    const qs = new URLSearchParams({
      firehose: "1",
      actor,
      limit: "200",
    });
    if (action) qs.set("action", action);
    if (sinceIso) qs.set("since", sinceIso);
    authedFetch(`/api/audit/entity?${qs.toString()}`)
      .then((r) => r.json())
      .then((j: { entries: FirehoseEntry[] }) => {
        if (cancelled) return;
        setEntries(Array.isArray(j.entries) ? j.entries : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, action, since]);

  if (loading) return <div className="text-sm text-zinc-500">loading…</div>;
  if (error) return <div className="text-sm text-rose-300">{error}</div>;
  if (!entries || entries.length === 0)
    return <div className="text-sm text-zinc-500">No activity by {actor} in recent history.</div>;

  return (
    <ol className="divide-y divide-zinc-800/60">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
          <time className="w-32 shrink-0 font-mono text-[11px] text-zinc-500">
            {new Date(e.createdAt).toLocaleString()}
          </time>
          <span
            className={
              "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
              (e.action === "created"
                ? "bg-emerald-500/20 text-emerald-200"
                : e.action === "updated"
                  ? "bg-blue-500/20 text-blue-200"
                  : e.action === "soft_deleted"
                    ? "bg-amber-500/20 text-amber-200"
                    : e.action === "restored"
                      ? "bg-violet-500/20 text-violet-200"
                      : "bg-rose-500/20 text-rose-200")
            }
          >
            {e.action}
          </span>
          <span className="text-zinc-400">{e.entityType}</span>
          <a
            href={`/system/history?type=${encodeURIComponent(e.entityType)}&id=${encodeURIComponent(e.entityId)}`}
            className="font-mono text-xs text-zinc-300 underline-offset-2 hover:underline"
          >
            {e.entityId.slice(0, 14)}
          </a>
          {e.reason && <span className="ml-auto truncate text-xs text-zinc-500">{e.reason}</span>}
        </li>
      ))}
    </ol>
  );
}

export default function HistoryPage() {
  // useSearchParams must be wrapped in Suspense per Next 16 conventions.
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">loading…</div>}>
      <HistoryPageInner />
    </Suspense>
  );
}
