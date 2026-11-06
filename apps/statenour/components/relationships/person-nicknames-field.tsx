"use client";

/**
 * Nicknames on the /people edit drawer. Each add or remove saves at once through the one writer
 * (lib/services/people/nicknames.ts), apart from the drawer's Save, so a word typed here reaches Nick and the journal
 * even if the rest of the form is cancelled. A failed save stays on screen; the list only moves on the server's answer.
 */
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function PersonNicknamesField({ personId, initial }: { personId: string; initial: string[] }) {
  const [nicknames, setNicknames] = useState(initial);
  const [draft, setDraft] = useState("");
  const [dead, setDead] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const edit = trpc.task.editPersonNicknames.useMutation();

  async function save(change: { add: string[] } | { remove: string[] }) {
    setError(null);
    try {
      const res = await edit.mutateAsync({ personId, ...change });
      setNicknames(res.nicknames);
      setDead(res.dead);
      void utils.task.personProfile.invalidate({ personId });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the nickname.");
      return false;
    }
  }

  async function add() {
    const word = draft.trim();
    if (word && !edit.isPending && (await save({ add: [word] }))) setDraft("");
  }

  return (
    <div className="space-y-1">
      <span className="font-mono text-[11px] text-fg-tertiary">nicknames · what you call them</span>
      {nicknames.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {nicknames.map((n) => (
            <li key={n} className="inline-flex items-center rounded-control border border-edge-default bg-content pl-2.5 text-[14px] text-fg">
              {n}
              <button
                type="button"
                onClick={() => void save({ remove: [n] })}
                disabled={edit.isPending}
                aria-label={`remove nickname ${n}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-fg-tertiary hover:text-fg disabled:opacity-50"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void add();
          }}
          aria-label="new nickname"
          placeholder="mom"
          maxLength={40}
          autoCapitalize="none"
          className="min-h-11 w-full min-w-0 flex-1 rounded-control border border-edge-default bg-content px-2.5 py-2 text-[16px] text-fg placeholder:text-fg-tertiary focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={edit.isPending || !draft.trim()}
          aria-label="add nickname"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary hover:border-edge-strong hover:text-fg disabled:opacity-50"
        >
          {edit.isPending ? <Loader2 size={12} className="animate-spin" strokeWidth={2} /> : "Add"}
        </button>
      </div>
      {dead.length > 0 && (
        <p className="text-xs leading-5 text-[var(--text-secondary)]">
          {dead.map((n) => `"${n}"`).join(", ")} links nobody: someone else uses it or is named it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
