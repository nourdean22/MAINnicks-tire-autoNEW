import { AlertTriangle, ArrowRight, Camera, FlaskConical, Gauge, Loader2, Recycle, Repeat, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import type { IgView } from "./igViews";
import { writeCreateHandoff } from "./igViews";

/**
 * CREATIVE ASSISTANT — "what should we make today?" (README §M / §S).
 *
 * Up to six stacked cards, each with the exact signal lines it was ranked on.
 * Three states, never two: a failed query says so in its own words; a source
 * the server could not read is listed by name under the cards; an empty card
 * set after a successful read is a real "nothing stood out". Mobile-first,
 * no modals, every tap target >= 48px (min-h-12).
 */
type Assistant = RouterOutputs["instagramAdmin"]["getCreativeAssistant"];
type AssistantCard = Assistant["cards"][number];

const ICON: Record<AssistantCard["type"], typeof Target> = {
  opportunity: Target,
  capture: Camera,
  fatigue: Repeat,
  quality: Gauge,
  experiment: FlaskConical,
  reuse: Recycle,
};

const TYPE_LABEL: Record<AssistantCard["type"], string> = {
  opportunity: "Strongest opportunity",
  capture: "Capture opportunity",
  fatigue: "Fatigue warning",
  quality: "Quality cost, measured",
  experiment: "Experiment",
  reuse: "Article ↔ social reuse",
};

const CONFIDENCE_CLASS: Record<AssistantCard["confidence"], string> = {
  high: "text-emerald-500",
  medium: "text-amber-500",
  low: "text-red-400",
};

/** Where the first action lands. Creation cards hand Create the topic + format
 *  through the existing handoff contract; the others open the tab that owns them. */
function actionTarget(card: AssistantCard): { view: IgView; handoff?: Parameters<typeof writeCreateHandoff>[0] } {
  switch (card.type) {
    case "opportunity":
    case "reuse":
      return {
        view: "create",
        handoff: {
          sourceType: "creative_assistant",
          detail: card.topic ?? card.title,
          format: card.format === "article" ? "post" : card.format,
        },
      };
    case "capture":
      return { view: "create", handoff: { sourceType: "creative_assistant_capture", detail: card.topic ?? card.title } };
    case "fatigue":
      return { view: "patterns" };
    case "quality":
      return { view: "publish" };
    case "experiment":
      return { view: "strategy" };
  }
}

export function CreativeAssistantCards({ onNavigate }: { onNavigate: (view: IgView) => void }) {
  const q = trpc.instagramAdmin.getCreativeAssistant.useQuery(undefined, { refetchInterval: 300_000 });
  const data = q.data;
  const erroredSources = data
    ? Object.entries(data.inputs).filter(([, v]) => typeof v === "string" && v.startsWith("error:"))
    : [];

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Target className="h-5 w-5 text-primary" /> What should we make today?</CardTitle>
        <CardDescription>Ranked on signals the shop actually has — every card lists them. Nothing here is a model&apos;s opinion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : q.isError || !data ? (
          <div role="alert" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>Could not load the assistant — recommendations are <strong>unknown</strong>, not empty.{q.error?.message ? ` (${q.error.message})` : ""}</span>
          </div>
        ) : (
          <>
            {data.cards.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Nothing stood out from today&apos;s signals{erroredSources.length ? " — and some sources could not be read, so this is incomplete" : ""}.
              </p>
            )}
            {data.cards.map((card) => {
              const Icon = ICON[card.type];
              const target = actionTarget(card);
              return (
                <section key={`${card.type}-${card.title}`} aria-label={TYPE_LABEL[card.type]} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{TYPE_LABEL[card.type]}</p>
                      <p className="text-sm font-medium leading-5">{card.title}</p>
                    </div>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide">{card.format}</span>
                  </div>
                  <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Why this</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {card.why.map((line) => (
                      <li key={line} className="flex gap-1.5"><span className="text-muted-foreground">·</span><span className="min-w-0 break-words">{line}</span></li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">
                    <span className={`font-semibold uppercase ${CONFIDENCE_CLASS[card.confidence]}`}>{card.confidence} confidence</span>
                    <span className="text-muted-foreground"> — {card.confidenceReason}</span>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 min-h-12 w-full justify-between text-left"
                    onClick={() => {
                      if (target.handoff) writeCreateHandoff(target.handoff);
                      onNavigate(target.view);
                    }}
                  >
                    <span className="min-w-0 truncate">{card.firstAction}</span>
                    <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
                  </Button>
                </section>
              );
            })}
            {erroredSources.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  Could not read {erroredSources.map(([k]) => k).join(", ")} — cards that depend on {erroredSources.length === 1 ? "it" : "them"} are <strong>missing, not absent</strong>.
                </span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Sources: {Object.entries(data.inputs).map(([k, v]) => `${k} ${String(v)}`).join(" · ")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
