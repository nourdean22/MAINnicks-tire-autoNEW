"use client";

/**
 * Voice brain dump · 2026-10-29 (benchmark pick 1: Todoist Ramble + Jarvis).
 *
 * The quick-add mic: talk, stop, review the rows Nick split out, fix or drop
 * any, then one Save files them all in the Inbox. Nothing is written before
 * Save. Transcription is the existing /api/ai/transcribe route; the split is
 * one call on the existing provider chain (task.dumpSplit). If the split
 * fails, the whole transcript stays as one editable row and the line says so.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { MissionsQuickAdd } from "@/components/missions/missions-quick-add";
import { parseQuickAdd } from "@/lib/loops/quick-add-parser";
import { cn } from "@/lib/utils";

type Row = { key: number; title: string; dueDate: string | null };

let rowKey = 0;
/** "by friday" is read here, on the phone, so the day math runs in his time zone. */
export function toDumpRows(titles: string[]): Row[] {
  return titles.map((raw) => {
    const quick = parseQuickAdd(raw);
    return { key: ++rowKey, title: (quick?.title || raw).trim(), dueDate: quick?.dueDate ? quick.dueDate.toISOString() : null };
  });
}

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `by ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => (armed ? onRemove() : setArmed(true))}
      className={cn("inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end px-1 font-mono text-[12px]", armed ? "text-rose-300" : "text-fg-tertiary hover:text-fg")}
    >
      {armed ? "tap to drop" : "drop"}
    </button>
  );
}

export function MissionsCapture({
  onSubmit,
  busy,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const utils = trpc.useUtils();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const split = trpc.task.dumpSplit.useMutation();
  const save = trpc.task.dumpSave.useMutation({
    onSuccess: async (res, vars) => {
      if (res.failed.length === 0) {
        setRows(null);
        setNote(`Saved ${res.created} to the Inbox`);
      } else {
        // Keep only the rows that failed, so Save again cannot duplicate the saved ones.
        const failedTitles = new Set(res.failed.map((i) => vars.items[i]?.title));
        setRows((cur) => (cur ?? []).filter((r) => failedTitles.has(r.title.trim())));
        setNote(`Saved ${res.created}. ${res.failed.length} not saved; Save again to retry them.`);
      }
      await utils.task.invalidate();
    },
  });

  const onTranscript = async (text: string) => {
    setNote(null);
    try {
      const res = await split.mutateAsync({ transcript: text });
      if (res.items.length === 0) {
        setNote("Heard nothing to do in that one");
        return;
      }
      setRows(toDumpRows(res.items.map((i) => i.title)));
    } catch (err) {
      setRows([{ key: ++rowKey, title: text.trim().slice(0, 200), dueDate: null }]);
      setNote(`Could not split it (${err instanceof Error ? err.message : "error"}), so it is one row. Edit before saving.`);
    }
  };
  const voice = useVoiceInput((t) => void onTranscript(t), () => {});

  useEffect(() => {
    if (!voice.isRecording) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [voice.isRecording]);

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const status = voice.isRecording
    ? `Listening ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} · tap the mic to stop`
    : voice.transcribing
      ? "Transcribing"
      : split.isPending
        ? "Splitting into tasks"
        : null;

  const keep = (rows ?? []).filter((r) => r.title.trim());

  return (
    <div>
      <MissionsQuickAdd
        onSubmit={onSubmit}
        // One dump at a time: a second recording must not race the first one's split.
        busy={busy || save.isPending || voice.transcribing || split.isPending}
        onVoice={() => {
          if (voice.isRecording) return voice.stopRecording();
          const start = Date.now();
          setStartedAt(start);
          setNow(start);
          return voice.startRecording().then(() => {});
        }}
        voiceActive={voice.isRecording}
      />
      {status ? (
        <p role="status" className="mt-2 font-mono text-[12px] text-fg-secondary">
          {status}
        </p>
      ) : null}
      {note ? <p className="mt-2 font-mono text-[12px] text-fg-tertiary">{note}</p> : null}
      {rows ? (
        <section aria-label="Review before saving" className="mt-3" data-voice-dump-review={rows.length}>
          <ul className="divide-y divide-edge-default border-y border-edge-default">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    value={r.title}
                    onChange={(e) => setRows((cur) => cur!.map((x) => (x.key === r.key ? { ...x, title: e.target.value } : x)))}
                    aria-label="Task title"
                    maxLength={200}
                    className="block min-h-[44px] w-full border-0 bg-transparent px-0 text-[16px] text-fg focus:outline-none"
                  />
                  {dueLabel(r.dueDate) ? <p className="-mt-1 pb-1 font-mono text-[11px] text-fg-tertiary">{dueLabel(r.dueDate)}</p> : null}
                </div>
                <RemoveButton onRemove={() => setRows((cur) => cur!.filter((x) => x.key !== r.key))} />
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={keep.length === 0 || save.isPending}
              onClick={() => save.mutate({ items: keep.map((r) => ({ title: r.title.trim(), dueDate: r.dueDate })) })}
              className="inline-flex min-h-[44px] items-center border-b-2 border-accent px-1 text-[15px] font-medium text-fg disabled:opacity-40"
            >
              {save.isPending ? "Saving" : `Save ${keep.length} ${keep.length === 1 ? "task" : "tasks"}`}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setRows(null);
                setNote(null);
              }}
              className="inline-flex min-h-[44px] items-center px-1 text-[14px] text-fg-tertiary hover:text-fg"
            >
              Discard
            </button>
          </div>
          {save.isError ? <p className="mt-1 font-mono text-[12px] text-amber-300">Not saved: {save.error.message}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
