/**
 * Controls: every door that stops or pauses an autonomous Instagram lane, on one screen.
 *
 * WHY THIS VIEW EXISTS
 * Autonomy control and Pipeline health had zero opens in 14 days of logs, but they are the only
 * places that can stop the account posting reels and replying to comments by itself. The W3 prune
 * (2026-10-19) kept them and merged them rather than cut them. Nothing new is read here: each part
 * keeps its own query and its own failed / paused / unknown states.
 *
 * ORDER IS THE CONTRACT. The kill switch and limits come first, then the three lanes that act on
 * their own (send lanes, image autopost, comment responder), and the read-only pipeline health
 * last, so a failed or slow reel read can never push a stop switch off the screen.
 *
 * EACH PART HAS ITS OWN ERROR BOUNDARY. The shell's boundary wraps the whole view, so one part that
 * throws while rendering would otherwise replace every switch on this screen with a single message.
 */
import type { ReactNode } from "react";
import AutonomyCommandCenter from "@/components/admin/AutonomyCommandCenter";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SendSwitchesCard } from "./SendSwitchesCard";
import { ImageAutopostCard } from "./ImageAutopostCard";
import { CommentResponderCard } from "./CommentResponderCard";
import { Pipeline } from "./Pipeline";

function Part({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <p role="alert" className="rounded-md border border-amber-500/40 p-3 text-sm">
          {name} failed to render. The other switches on this screen still work. Reload the page to try again.
        </p>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export function Controls() {
  return (
    <div className="space-y-4">
      <Part name="Autonomy control"><AutonomyCommandCenter /></Part>
      <Part name="Send switches"><SendSwitchesCard /></Part>
      <Part name="Image autopost"><ImageAutopostCard /></Part>
      <Part name="Comment responder"><CommentResponderCard /></Part>
      <section aria-labelledby="ig-pipeline-health" className="space-y-4">
        <h3 id="ig-pipeline-health" className="px-1 text-base font-semibold">Pipeline health</h3>
        <Part name="Pipeline health"><Pipeline /></Part>
        <p className="px-1 text-xs text-muted-foreground">
          Pipeline health is read-only. The switches above can pause or resume each lane.
        </p>
      </section>
    </div>
  );
}
