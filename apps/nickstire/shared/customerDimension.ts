/**
 * CUSTOMER DIMENSION — one customer, seen from every side at once.
 *
 * THE PROBLEM IT SOLVES
 * This app knows an enormous amount about each customer and has never once held
 * it in a single object. The knowledge is assembled per surface, and each
 * surface sees a different slice:
 *
 *   - `smsOrchestrator.loadCustomerContext` builds a rich SMS-shaped view.
 *   - `vapi-personalization` builds its own for voice.
 *   - `customerIntelligence`, `retentionCohorts`, `journeyTracker` and
 *     `customerPsychoProfile` each build a fourth, fifth, sixth.
 *
 * ROS-042 #3 is that failure in miniature and it shipped: `loadCustomerContext`
 * assembled name, vehicle, open estimate and last-call gist, and only
 * `activeBooking` reached the SMS drafter — so replies went out cold to
 * customers the system knew everything about.
 *
 * THE HARDER PROBLEM: LINKAGE HONESTY
 * Assembling the slices is the easy half. The dangerous half is that they are
 * NOT linked with equal confidence, and merging them silently launders that
 * away. `docs/CURRENT-TRUTH.md` lists "weak phone/time attribution without
 * direct identifiers" under experimental-or-modeled, and ROS-013 records that
 * arrival and paid-call attribution are not universally linked. A voice call
 * matched to a customer by a direct `customerId` is a fact. The same call
 * matched by a 10-digit phone key is an inference — shared household lines,
 * recycled numbers and shop landlines all collide on it.
 *
 * So every channel fragment here carries HOW it was linked, and the dimension
 * refuses to present an inferred link as a verified one. `facets.verified` and
 * `facets.all` are separate views on purpose: a surface that drives money uses
 * the first, a surface that drafts a friendly reply may use the second.
 *
 * PURE BY CONSTRUCTION
 * No clock, no database, no I/O. Callers fetch fragments and pass them in with
 * an explicit `asOf`. Same pattern as `affinityScoring.ts` and
 * `loopShapeContract.ts` — the merge logic is where the bugs live, so the merge
 * logic is what has to be testable.
 */

import type { EvidenceLevel } from "./metricsContract";

/** How a fragment was tied to this customer. */
export type LinkageMethod =
  /** A foreign key. `invoices.customerId`, `bookings.customerId`. */
  | "direct-id"
  /** Matched on the 10-digit phone key. Households and recycled numbers collide. */
  | "phone-key"
  /** An operator confirmed the match by hand. */
  | "operator-confirmed"
  /** Fuzzy name/time proximity. Never sufficient on its own. */
  | "weak-match";

/** Which side of the business a fragment came from. */
export type Channel = "voice" | "sms" | "web" | "money" | "reputation";

export interface Linkage {
  method: LinkageMethod;
  /** Free-text note when the method alone does not explain the join. */
  note?: string;
}

/**
 * Evidence level implied by a linkage method. This is the whole safety
 * property: a fragment cannot claim to be better-evidenced than the way it was
 * joined. Mirrors the vocabulary in `metricsContract.ts` so one language
 * describes both metrics and customer facts.
 */
export function evidenceOf(link: Linkage): EvidenceLevel {
  switch (link.method) {
    case "direct-id":
    case "operator-confirmed":
      return "verified";
    case "phone-key":
      return "inferred";
    case "weak-match":
      return "inferred";
  }
}

export interface Facet<T> {
  channel: Channel;
  linkage: Linkage;
  evidence: EvidenceLevel;
  /** ISO timestamp of the underlying event, when it has one. */
  occurredAt: string | null;
  value: T;
}

/** A fragment as a caller supplies it, before the dimension stamps evidence. */
export interface FacetInput<T> {
  channel: Channel;
  linkage: Linkage;
  occurredAt?: string | null;
  value: T;
}

export interface CustomerIdentity {
  /** `customers.id` when a direct record exists. */
  customerId: number | null;
  /** 10-digit match key. The join everything else hangs off. */
  phoneKey: string | null;
  displayName: string | null;
  vehicle: string | null;
  smsOptOut: boolean;
}

/**
 * The time axis. Dimensional thinking is not only "many channels" — it is the
 * same customer across time, which is what turns a list of rows into a
 * relationship. Every field is nullable because `null` means UNKNOWN, and
 * unknown is not zero (ROS-036/037/049 were all that confusion).
 */
export interface CustomerTimeline {
  firstSeenAt: string | null;
  lastContactAt: string | null;
  lastPaidAt: string | null;
  /** Cents of open declined work. `null` = not measured, `0` = measured, none. */
  openDeclinedCents: number | null;
  /** Days between the two most recent paid visits. */
  lastVisitGapDays: number | null;
  /** Total paid, in cents. `null` = unknown. */
  lifetimePaidCents: number | null;
}

export interface CustomerDimension {
  identity: CustomerIdentity;
  timeline: CustomerTimeline;
  facets: {
    /** Everything, including inferred links. */
    all: Facet<unknown>[];
    /** Only `verified` linkage. The view a money surface is allowed to use. */
    verified: Facet<unknown>[];
  };
  /** Channels this customer has ANY evidence on. */
  channelsSeen: Channel[];
  /**
   * Channels with no fragment at all. Distinguishing "no voice calls" from
   * "we did not look at voice" is the whole point — a surface must be able to
   * render "unknown" rather than "none".
   */
  channelsUnknown: Channel[];
  /** Weakest linkage anywhere in this dimension. */
  weakestLinkage: LinkageMethod | null;
  /** True when ANY fragment is merely inferred. Surfaces should say so. */
  hasInferredLinkage: boolean;
  asOf: string;
  /** Reasons a consumer should treat this dimension carefully. */
  caveats: string[];
}

const ALL_CHANNELS: Channel[] = ["voice", "sms", "web", "money", "reputation"];

const LINKAGE_STRENGTH: Record<LinkageMethod, number> = {
  "operator-confirmed": 3,
  "direct-id": 3,
  "phone-key": 2,
  "weak-match": 1,
};

export interface BuildDimensionInput {
  identity: CustomerIdentity;
  facets: FacetInput<unknown>[];
  timeline?: Partial<CustomerTimeline>;
  /** ISO timestamp. Passed in, never read from the clock. */
  asOf: string;
  /** Channels deliberately not queried, so they resolve to unknown not empty. */
  channelsNotQueried?: Channel[];
}

/**
 * Merge channel fragments into one canonical customer.
 *
 * Guarantees a consumer can rely on:
 *   - `facets.verified` never contains an inferred link.
 *   - A channel that was not queried appears in `channelsUnknown`, not as an
 *     absence of evidence.
 *   - Every timeline field is `null` unless it was actually supplied.
 *   - `caveats` names every reason this view is less solid than it looks.
 */
export function buildCustomerDimension(input: BuildDimensionInput): CustomerDimension {
  const facets: Facet<unknown>[] = input.facets.map((f) => ({
    channel: f.channel,
    linkage: f.linkage,
    evidence: evidenceOf(f.linkage),
    occurredAt: f.occurredAt ?? null,
    value: f.value,
  }));

  const verified = facets.filter((f) => f.evidence === "verified");

  const seen = new Set<Channel>(facets.map((f) => f.channel));
  const notQueried = new Set<Channel>(input.channelsNotQueried ?? []);

  const channelsSeen = ALL_CHANNELS.filter((c) => seen.has(c));
  // Unknown = never queried, OR queried-and-empty is NOT unknown. Only the
  // explicit not-queried set counts, because "we looked and found nothing" is
  // real information and must not be laundered into "we don't know".
  const channelsUnknown = ALL_CHANNELS.filter((c) => notQueried.has(c) && !seen.has(c));

  const weakestLinkage =
    facets.length === 0
      ? null
      : facets.reduce<LinkageMethod>((worst, f) => {
          return LINKAGE_STRENGTH[f.linkage.method] < LINKAGE_STRENGTH[worst]
            ? f.linkage.method
            : worst;
        }, facets[0].linkage.method);

  const hasInferredLinkage = facets.some((f) => f.evidence !== "verified");

  const caveats: string[] = [];
  if (hasInferredLinkage) {
    caveats.push(
      "Some facts are linked by phone key, not a direct id — household lines and recycled numbers collide. Use facets.verified for anything that drives money (ROS-013).",
    );
  }
  if (input.identity.customerId === null) {
    caveats.push("No customers row — this dimension is assembled from the phone key alone.");
  }
  if (channelsUnknown.length > 0) {
    caveats.push(`Not queried: ${channelsUnknown.join(", ")}. Render these as unknown, not empty.`);
  }
  if (facets.length === 0) {
    caveats.push("No facts on any channel. This is an empty dimension, not a quiet customer.");
  }

  return {
    identity: input.identity,
    timeline: {
      firstSeenAt: input.timeline?.firstSeenAt ?? null,
      lastContactAt: input.timeline?.lastContactAt ?? null,
      lastPaidAt: input.timeline?.lastPaidAt ?? null,
      openDeclinedCents: input.timeline?.openDeclinedCents ?? null,
      lastVisitGapDays: input.timeline?.lastVisitGapDays ?? null,
      lifetimePaidCents: input.timeline?.lifetimePaidCents ?? null,
    },
    facets: { all: facets, verified },
    channelsSeen,
    channelsUnknown,
    weakestLinkage,
    hasInferredLinkage,
    asOf: input.asOf,
    caveats,
  };
}

/**
 * The subset a customer-facing generator is allowed to speak from.
 *
 * ROS-042 #3 shipped cold SMS replies because rich context existed and did not
 * reach the drafter. The fix is not "hand the drafter everything" — an inferred
 * phone-key match on someone else's invoice becomes a confidently wrong
 * statement about the customer's own car. This returns what is safe to SAY.
 */
export function speakableFacts(dim: CustomerDimension): {
  name: string | null;
  vehicle: string | null;
  openDeclinedCents: number | null;
  facts: Facet<unknown>[];
} {
  return {
    name: dim.identity.displayName,
    vehicle: dim.identity.vehicle,
    // Money statements require verified linkage, full stop.
    openDeclinedCents: dim.hasInferredLinkage ? null : dim.timeline.openDeclinedCents,
    facts: dim.facets.verified,
  };
}
