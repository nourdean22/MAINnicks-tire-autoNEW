"use client";

/**
 * components/missions/linked-missions-panel.tsx · v10.0.421
 *
 * Shows + manages mission-to-mission links for a single mission.
 * Mounts inside ProjectDetail (the /plan page mission view).
 *
 * UI:
 *   · Each existing link as a chip · "depends on Bay 5 Revive ↗"
 *   · ↗ outbound · ↙ inbound
 *   · [×] removes the link (idempotent · /api/missions/[id]/links/[linkId])
 *   · Picker · type-ahead through other missions · select relation type
 *
 * Picker uses /api/missions GET (list all missions) · filters out the
 * current mission + ones already linked. Operator can add 5+ links.
 */

import { useEffect, useState, useCallback } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { toast } from "sonner";
import { Link2, X, Plus, ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface LinkRow {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string | null;
  note: string | null;
  direction: "outbound" | "inbound";
  otherMission: { id: string; title: string; status: string; domain: string };
  createdAt: string;
}

interface MissionOpt { id: string; title: string; status?: string }

const RELATIONS = [
  { value: "related", label: "related to" },
  { value: "depends-on", label: "depends on" },
  { value: "blocks", label: "blocks" },
  { value: "supersedes", label: "supersedes" },
  { value: "spawned-from", label: "spawned from" },
];

const RELATION_TONE: Record<string, string> = {
  "related": "border-[var(--border-default)] text-[var(--text-secondary)]",
  "depends-on": "border-amber-500/40 text-amber-300",
  "blocks": "border-rose-500/40 text-rose-300",
  "supersedes": "border-violet-500/40 text-violet-300",
  "spawned-from": "border-sky-500/40 text-sky-300",
};

export function LinkedMissionsPanel({ missionId }: { missionId: string }) {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [allMissions, setAllMissions] = useState<MissionOpt[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerRelation, setPickerRelation] = useState("related");
  const [busy, setBusy] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      const r = await authedFetch(`/api/missions/${missionId}/links`);
      if (!r.ok) return;
      const data = (await r.json()) as { links?: LinkRow[] };
      setLinks(data.links ?? []);
    } catch {
      /* ignore · will retry on next interaction */
    }
  }, [missionId]);

  const loadMissions = useCallback(async () => {
    if (allMissions) return;
    try {
      const r = await authedFetch(`/api/missions`);
      if (!r.ok) return;
      const data = (await r.json()) as MissionOpt[] | { missions?: MissionOpt[] };
      const list = Array.isArray(data) ? data : (data.missions ?? []);
      setAllMissions(list);
    } catch {
      /* ignore */
    }
  }, [allMissions]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  async function addLink(targetId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await authedFetch(`/api/missions/${missionId}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId, relation: pickerRelation }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(`Could not link · ${err.error ?? `HTTP ${r.status}`}`);
        return;
      }
      toast.success("Linked");
      setPicking(false);
      setPickerQuery("");
      await loadLinks();
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await authedFetch(
        `/api/missions/${missionId}/links/${linkId}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        toast.error(`Could not remove · HTTP ${r.status}`);
        return;
      }
      await loadLinks();
    } finally {
      setBusy(false);
    }
  }

  if (!links) return null;

  // Build candidates list · all missions minus current + already-linked
  const linkedIds = new Set([
    missionId,
    ...links.map((l) => l.otherMission.id),
  ]);
  const candidates = (allMissions ?? [])
    .filter((m) => !linkedIds.has(m.id))
    .filter((m) =>
      pickerQuery.trim().length === 0
        ? true
        : m.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()),
    )
    .slice(0, 12);

  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link2 size={14} className="text-[var(--text-tertiary)]" />
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
            linked missions ({links.length})
          </h3>
        </div>
        {!picking && (
          <button
            type="button"
            onClick={() => { setPicking(true); void loadMissions(); }}
            className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 flex items-center gap-1"
          >
            <Plus size={12} /> link
          </button>
        )}
      </header>

      {/* Existing links */}
      {links.length === 0 && !picking && (
        <p className="text-[11px] text-[var(--text-tertiary)] italic">
          No linked missions yet · click "link" to connect this mission to another
        </p>
      )}

      {links.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {links.map((l) => {
            const tone = RELATION_TONE[l.relation ?? "related"] ?? RELATION_TONE.related;
            const Arrow = l.direction === "outbound" ? ArrowUpRight : ArrowDownLeft;
            const relLabel = RELATIONS.find((r) => r.value === (l.relation ?? "related"))?.label ?? l.relation ?? "related";
            return (
              <li key={l.id} className={`flex items-center gap-2 rounded border ${tone} bg-[var(--bg-base)] px-3 py-2`}>
                <Arrow size={12} className="shrink-0 opacity-70" />
                <span className="text-[10px] font-mono uppercase tracking-wider opacity-80 shrink-0">
                  {relLabel}
                </span>
                <a
                  href={`/plan?missionId=${l.otherMission.id}`}
                  className="flex-1 text-[12px] text-[var(--text-primary)] hover:text-[var(--gold)] truncate"
                  title={l.otherMission.title}
                >
                  {l.otherMission.title}
                </a>
                <span className="text-[9px] font-mono text-[var(--text-tertiary)] shrink-0">
                  {l.otherMission.status}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeLink(l.id)}
                  className="shrink-0 w-8 h-8 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                  title="Remove link"
                  aria-label="Remove link"
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Picker */}
      {picking && (
        <div className="rounded border border-[var(--gold)]/30 bg-[var(--bg-base)] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={pickerRelation}
              onChange={(e) => setPickerRelation(e.target.value)}
              className="text-[11px] font-mono px-2 py-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)]"
            >
              {RELATIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="search missions…"
              className="flex-1 text-[12px] px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/40"
              autoFocus
            />
            <button
              type="button"
              onClick={() => { setPicking(false); setPickerQuery(""); }}
              className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              cancel
            </button>
          </div>
          {allMissions === null && (
            <p className="text-[10px] text-[var(--text-tertiary)] italic">loading missions…</p>
          )}
          {allMissions !== null && candidates.length === 0 && (
            <p className="text-[10px] text-[var(--text-tertiary)] italic">
              {pickerQuery ? "no matches" : "all other missions are already linked"}
            </p>
          )}
          {candidates.length > 0 && (
            <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
              {candidates.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void addLink(m.id)}
                    className="w-full text-left text-[12px] px-3 py-2 sm:py-1.5 rounded border border-transparent hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/5 text-[var(--text-primary)] disabled:opacity-50"
                  >
                    {m.title}
                    {m.status && (
                      <span className="ml-2 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                        {m.status}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
