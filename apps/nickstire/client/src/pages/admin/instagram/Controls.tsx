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
 */
import AutonomyCommandCenter from "@/components/admin/AutonomyCommandCenter";
import { SendSwitchesCard } from "./SendSwitchesCard";
import { ImageAutopostCard } from "./ImageAutopostCard";
import { CommentResponderCard } from "./CommentResponderCard";
import { Pipeline } from "./Pipeline";

export function Controls() {
  return (
    <div className="space-y-4">
      <AutonomyCommandCenter />
      <SendSwitchesCard />
      <ImageAutopostCard />
      <CommentResponderCard />
      <section aria-labelledby="ig-pipeline-health" className="space-y-4">
        <h3 id="ig-pipeline-health" className="px-1 text-base font-semibold">Pipeline health</h3>
        <Pipeline />
        <p className="px-1 text-xs text-muted-foreground">
          Pipeline health is read-only. The switches above can pause or resume each lane.
        </p>
      </section>
    </div>
  );
}
