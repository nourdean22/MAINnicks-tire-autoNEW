/**
 * Which Remotion template a queued reel renders as, or why it is refused
 * (2026-10-08).
 *
 * The render loop used to pick "alert" when the draft mentioned a warning and
 * "review" for everything else, filling the review template's gaps with
 * `reviewerName: "Verified Customer"` and `stars: 5`. So an approved reel draft
 * without the word "warning" became a five-star customer-review video whose
 * "review" was the draft's own text: an invented review, published on approval.
 *
 * A review video is now made only from a declared review:
 * `sourceMetadata.type === "review"` with the reviewer's name, a whole-number
 * 1-5 rating and the review text. No StateNour path writes that metadata today,
 * so the review template stays closed until one does. The alert rule is
 * unchanged. Anything else is refused before rendering; the row keeps its render
 * lease and is retired by the lease reclaim (MAX_RENDER_ATTEMPTS in
 * apps/statenour/app/api/sync/queue/render/route.ts).
 *
 * Pure on purpose: StateNour's repo tests import it
 * (apps/statenour/tests/repo/worker-render-plan.test.ts), because the worker has
 * no test suite of its own.
 */
export type RenderPlan =
  | {
      template: "review";
      data: { reviewerName: string; reviewText: string; stars: number; companyName: string };
    }
  | {
      template: "alert";
      data: { alertTitle: string; alertDetails: string; location: string; companyName: string };
    }
  | { refuse: string };

const COMPANY_NAME = "Nick's Tire & Auto";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function planRender(content: unknown, sourceMetadata: unknown): RenderPlan {
  const meta: Record<string, unknown> =
    sourceMetadata && typeof sourceMetadata === "object" ? (sourceMetadata as Record<string, unknown>) : {};
  const body = text(content);
  const companyName = text(meta.companyName) || COMPANY_NAME;

  if (text(meta.type).toLowerCase() === "review") {
    const reviewerName = text(meta.reviewerName);
    const reviewText = text(meta.reviewText) || body;
    const stars = typeof meta.stars === "number" ? meta.stars : Number(text(meta.stars) || NaN);
    if (!reviewerName || !reviewText || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return {
        refuse:
          "a review video needs the real review: the reviewer's name, a whole-number 1-5 rating and the review text in sourceMetadata",
      };
    }
    return { template: "review", data: { reviewerName, reviewText, stars, companyName } };
  }

  const lower = body.toLowerCase();
  if (meta.type === "alert" || lower.includes("warning") || lower.includes("alert")) {
    const alertDetails = text(meta.alertDetails) || body;
    if (!alertDetails) return { refuse: "an alert video needs text to show" };
    return {
      template: "alert",
      data: {
        alertTitle: text(meta.alertTitle) || "Service Alert",
        alertDetails,
        location: text(meta.location) || "Local Road Safety",
        companyName,
      },
    };
  }

  return {
    refuse:
      "neither a declared customer review nor an alert: the worker will not present a draft's own text as a customer review",
  };
}
