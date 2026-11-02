"use client";

/**
 * /now · W6 intent surface (docs/design/ui-v3/W6-INTENT-SURFACE.md). Nour says what he wants to see;
 * Nick picks read-only reads (POST /api/intent/compose) and each result draws OPEN through the one
 * card registry (ToolResultCard). No prose, no writes. Phone first: 44 px targets, a 16 px input.
 * Recent asks are device-local and optional (try/catch): a blocked store only loses the shortcuts.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { ToolResultCard } from "@/components/chat/tool-result-card";

export const DEFAULT_INTENTS = ["Shop today", "Who needs me", "Is everything running", "My day"] as const;

const RECENT_KEY = "now.recent-intents";
const CHIP_COUNT = 4;

interface Part {
  type: string;
  state: string;
  output?: unknown;
  errorText?: string;
}

type View =
  | { kind: "idle" }
  | { kind: "loading"; intent: string }
  | { kind: "done"; intent: string; parts: Part[]; refused: number }
  | { kind: "failed"; intent: string; message: string };

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, CHIP_COUNT) : [];
  } catch {
    return [];
  }
}

function saveRecent(intent: string, current: string[]): string[] {
  const next = [intent, ...current.filter((v) => v !== intent)].slice(0, CHIP_COUNT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

async function compose(intent: string): Promise<View> {
  let res: Response;
  try {
    res = await fetch("/api/intent/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });
  } catch {
    return { kind: "failed", intent, message: "Could not reach the server. Check the connection and try again." };
  }
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; data?: { parts?: Part[]; refused?: number } }
    | null;
  if (!res.ok || !body?.ok || !Array.isArray(body.data?.parts)) {
    return { kind: "failed", intent, message: body?.error ?? `The compose read failed (${res.status}).` };
  }
  return { kind: "done", intent, parts: body.data.parts, refused: body.data.refused ?? 0 };
}

export function IntentSurface() {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [draft, setDraft] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => setRecents(readRecents()), []);

  const chips = [...new Set([...recents, ...DEFAULT_INTENTS])].slice(0, CHIP_COUNT);
  const busy = view.kind === "loading";

  const run = async (raw: string) => {
    const intent = raw.trim();
    if (!intent || busy) return;
    setView({ kind: "loading", intent });
    const next = await compose(intent);
    setView(next);
    if (next.kind === "done") setRecents((r) => saveRecent(intent, r));
  };

  return (
    <StandardPage eyebrow="Now" title="What do you want to see?" description="Nick picks the reads and lays out the cards. Read only." width="3xl">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={300}
          aria-label="What do you want to see"
          placeholder="Shop today, who needs me, is everything running"
          className="min-h-11 min-w-0 flex-1 border-b border-edge-subtle bg-transparent px-1 text-base text-fg placeholder:text-fg-tertiary focus:border-edge-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="min-h-11 shrink-0 px-3 text-[14px] font-medium text-fg disabled:text-fg-tertiary"
        >
          Show me
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((intent) => (
          <button
            key={intent}
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(intent);
              void run(intent);
            }}
            className="min-h-11 rounded-control border border-edge-subtle px-3 text-[13px] text-fg-secondary hover:text-fg disabled:opacity-60"
          >
            {intent}
          </button>
        ))}
      </div>

      <section className="mt-6" aria-live="polite" aria-busy={busy}>
        {view.kind === "loading" && <p className="text-[13px] text-fg-secondary">Nick is picking the reads for “{view.intent}”…</p>}

        {view.kind === "failed" && (
          <div className="border-l-2 border-rose-500/60 pl-3">
            <p className="text-[13px] text-rose-300">{view.message}</p>
            <button type="button" onClick={() => void run(view.intent)} className="mt-1 min-h-11 text-[13px] font-medium text-fg">
              Retry
            </button>
          </div>
        )}

        {view.kind === "done" && view.parts.length === 0 && (
          <p className="text-[13px] text-fg-secondary">
            Nick found no card for “{view.intent}”.{" "}
            <Link href="/chat" className="inline-flex min-h-11 items-center font-medium text-fg underline">
              Ask in Chat instead
            </Link>
          </p>
        )}

        {view.kind === "done" && view.parts.length > 0 && (
          <div>
            {view.parts.map((part, i) => {
              // The card shows no words for "output-error"; as a soft failure it shows "Not done" and the reason.
              const failed = part.state === "output-error";
              return (
                <ToolResultCard
                  key={`${part.type}-${i}`}
                  toolName={part.type.replace(/^tool-/, "")}
                  state={failed ? "output-available" : part.state}
                  output={failed ? { ok: false, reason: part.errorText ?? "The read failed." } : part.output}
                />
              );
            })}
            {view.refused > 0 && (
              <p className="mt-2 text-[12px] text-fg-tertiary">
                Nick asked for {view.refused} more {view.refused === 1 ? "read" : "reads"}; this screen shows at most 6.
              </p>
            )}
          </div>
        )}
      </section>
    </StandardPage>
  );
}
