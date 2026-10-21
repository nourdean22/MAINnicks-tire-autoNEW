/**
 * AI referrals, last 30 days: customers an AI assistant sent (ChatGPT, Meta AI, Gemini...).
 *
 * Nour, 2026-10-21: two customers came in because assistants sent them, and nothing in the shop
 * recorded how a customer heard about us. Two facts here, each from aiReferrals.summary:
 *   logged  = customers the counter logged with the sheet below (aiReferrals.log);
 *   web     = booking, lead and call-tap ROWS whose referrer was an assistant. Rows, not people:
 *             one visitor who taps the phone number twice counts twice, so the label names the rows.
 * Each half is null when its own read failed, so one half can be unknown while the other is real.
 * A failed or paused read (offline PWA: no data and no error) renders "?" and "not checked",
 * never 0: zero would say "no assistant sent anyone", which nobody measured.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AI_ASSISTANTS, type AiAssistantId } from "@shared/aiReferral";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Topic = "tires" | "repair" | "other";
type Half = { total: number; byAssistant: Partial<Record<AiAssistantId, number>> } | null;

const TOPICS: { id: Topic; label: string }[] = [
  { id: "tires", label: "Tires" },
  { id: "repair", label: "Repair" },
  { id: "other", label: "Other" },
];

const CHIP =
  "min-h-12 px-4 rounded-md border text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const CHIP_OFF = "border-border/60 text-foreground/80 hover:bg-foreground/5";
const CHIP_ON = "border-emerald-400 bg-emerald-500/15 text-emerald-300";

/** Non-zero entries only, in AI_ASSISTANTS order: "ChatGPT 1, Meta AI / Muse 1". */
function breakdown(by: Partial<Record<AiAssistantId, number>>): string {
  return AI_ASSISTANTS.filter((a) => (by[a.id] ?? 0) > 0)
    .map((a) => `${a.label} ${by[a.id]}`)
    .join(", ");
}

function Fact({ testId, half, label }: { testId: string; half: Half; label: string }) {
  const detail = half ? breakdown(half.byAssistant) : "";
  return (
    <p data-testid={testId} className="text-[14px] text-foreground/80 leading-relaxed">
      <span className="text-[17px] font-semibold tabular-nums text-foreground">{half ? half.total : "?"}</span>{" "}
      {label}
      {half === null ? (
        <span className="text-amber-300">, not checked</span>
      ) : detail ? (
        <span className="text-[13px] text-foreground/55"> ({detail})</span>
      ) : null}
    </p>
  );
}

export function AiReferralsCard() {
  const utils = trpc.useUtils();
  const summary = trpc.aiReferrals.summary.useQuery();
  const [open, setOpen] = useState(false);
  const [assistant, setAssistant] = useState<AiAssistantId | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const log = trpc.aiReferrals.log.useMutation({
    onSuccess: () => {
      setOpen(false);
      toast.success("Logged");
      void utils.aiReferrals.summary.invalidate();
    },
    // Keep the sheet open: the customer is still at the counter and the tap was not saved.
    onError: (err) => setSaveError(err.message || "Not saved. Try again."),
  });

  const openSheet = () => {
    setAssistant(null);
    setTopic(null);
    setSaveError(null);
    setOpen(true);
  };

  const save = () => {
    if (!assistant) return;
    setSaveError(null);
    log.mutate(topic ? { assistant, topic } : { assistant });
  };

  const data = summary.data;
  const loading = !data && summary.isLoading && summary.fetchStatus !== "paused";
  // No data and not loading: failed, or paused offline. Both halves are unknown, never 0.
  const logged: Half = data ? data.logged : null;
  const web: Half = data ? data.web : null;
  const noneYet = logged?.total === 0 && web?.total === 0;

  return (
    <section aria-labelledby="ai-referrals-title" className="border border-border/40 bg-card p-4 space-y-3">
      <h2 id="ai-referrals-title" className="text-[15px] font-semibold text-foreground">
        AI referrals, last 30 days
      </h2>

      {loading ? (
        <p className="text-[13px] text-foreground/60">Loading AI referrals</p>
      ) : (
        <div className="space-y-1">
          <Fact testId="ai-referrals-logged" half={logged} label="logged at the counter" />
          <Fact testId="ai-referrals-web" half={web} label="website bookings, leads or call taps from an assistant" />
          {noneYet && (
            <p className="text-[13px] text-foreground/60">
              None logged yet. When a customer says an AI assistant sent them, log it here.
            </p>
          )}
          {(logged === null || web === null) && (
            <button
              type="button"
              onClick={() => void summary.refetch()}
              className="min-h-12 px-3 -ml-3 text-[13px] text-foreground/70 underline underline-offset-2 hover:text-foreground"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={openSheet}
        className="w-full sm:w-auto min-h-12 px-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[15px] font-medium text-emerald-300 hover:bg-emerald-500/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Log a customer an AI sent
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          // The primitive's own close X is a 16 px glyph; the last-child rules give it the 48 px floor.
          className="max-h-[90dvh] overflow-y-auto sm:mx-auto sm:max-w-lg sm:rounded-t-lg pb-[max(1rem,env(safe-area-inset-bottom))] [&>button:last-child]:top-1 [&>button:last-child]:right-1 [&>button:last-child]:flex [&>button:last-child]:size-12 [&>button:last-child]:items-center [&>button:last-child]:justify-center"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>Log a customer an AI sent</SheetTitle>
            <SheetDescription>Which assistant sent them? The topic is optional.</SheetDescription>
          </SheetHeader>

          <div className="px-4 space-y-4">
            <fieldset>
              <legend className="mb-2 text-[13px] text-foreground/60">Assistant</legend>
              <div className="flex flex-wrap gap-2">
                {AI_ASSISTANTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={assistant === a.id}
                    onClick={() => setAssistant(a.id)}
                    className={`${CHIP} ${assistant === a.id ? CHIP_ON : CHIP_OFF}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[13px] text-foreground/60">Topic (optional)</legend>
              <div className="flex flex-wrap gap-2">
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={topic === t.id}
                    onClick={() => setTopic(topic === t.id ? null : t.id)}
                    className={`${CHIP} ${topic === t.id ? CHIP_ON : CHIP_OFF}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {saveError && (
              <p role="alert" className="text-[14px] text-red-300">
                Not saved: {saveError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`${CHIP} ${CHIP_OFF} flex-1 sm:flex-none`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!assistant || log.isPending}
                className="flex-1 min-h-12 px-4 rounded-md bg-emerald-500 text-[15px] font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {log.isPending ? "Saving" : saveError ? "Try again" : "Save"}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
