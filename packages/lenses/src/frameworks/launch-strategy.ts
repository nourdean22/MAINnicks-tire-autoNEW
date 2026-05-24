import type { StrategicFramework } from "../types";

/**
 * Launch Strategy — for "how to roll out a new offering, service line,
 * or product." Pre-launch / launch / post-launch with the right anchor
 * customers and feedback loop.
 */
export const launchStrategy: StrategicFramework = {
  id: "launch-strategy",
  name: "Launch Strategy (GTM)",
  oneLiner: "Pre-launch / launch / post-launch — anchor customers, feedback loops, escape velocity.",
  triggers: [
    /\b(launch|launching|roll\s*out|rollout|go\s*to\s*market|gtm)\b/i,
    /\b(new\s+(service|product|line|offering|tier))\b/i,
    /\b(beta|waitlist|pre\s*launch|pre\s*order)\b/i,
    /\b(soft\s*launch|public\s*launch|stealth\s+launch)\b/i,
    /\b(introduce|ship)\s+(a\s+)?(new|fresh)\b/i,
  ],
  antiTriggers: [
    // Tech/process commands · launch a browser, app, script · NOT a GTM context
    /\blaunch\s+(angry\s*birds|the\s+app|chrome|firefox|safari|edge|the\s+browser|a\s+(browser|script|process|terminal|repl|shell))/i,
    /\blaunch\s+(the\s+)?(chrome|firefox|safari|edge|browser)\b/i,
    /\bhow\s+do\s+i\s+launch\s+the\b/i,
    /\blaunch\s+(it|that|this|them)\s+(from|using|via|with)\b/i,
    // Aerospace launches · rocket / moon / space-shuttle · NOT a GTM context
    /\b(spacex|nasa|rocket|moon|space\s+shuttle|saturn\s+v|falcon\s+\d|starship)\s+launch\b/i,
    /\blaunch\s+(is|was|tomorrow|today|next\s+week|this\s+week)\s/i,
  ],
  weight: 1.0,
  lens: `Apply Launch Strategy. Decide the launch SHAPE first:
  · Stealth      · build with 1-3 anchor customers, no public signal
  · Soft launch  · open to a defined segment, gather data before scaling
  · Public       · all-in announcement, needs the funnel ready to absorb traffic
Then map the three phases:
  · Pre-launch  · build anticipation + recruit anchors. Waitlist? Beta?
  · Launch      · activation moment. What's the ONE thing that has to
    work flawlessly Day 1?
  · Post-launch · feedback loop into iteration. First 30/60/90 days
    determine whether this becomes a moat or a side project.
Always name the riskiest assumption that would kill the launch — then
how you'd test it before committing.`,
};
