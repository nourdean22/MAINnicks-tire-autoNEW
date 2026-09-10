/**
 * The 48-hour reply promise has a mechanism behind it.
 *
 * WHY (2026-09-10). /careers states "We respond within 48 hours" twice
 * (Careers.tsx:259 and :588) and NOTHING enforced it: no cron referenced the
 * candidates table, no timer, no escalation, no aging sort. The only surface
 * for an applicant was a collapsible admin panel someone had to remember to
 * open. A public promise with no mechanism behind it is how a shop loses a
 * technician to whoever called back.
 *
 * Two halves are asserted here, because either alone scores green while the
 * promise still goes unkept:
 *   1. the BANDING behaves (thresholds, boundaries, unknown-age handling)
 *   2. the ALARM is actually wired to a surface an operator sees
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";
import { slaBand, SLA_THRESHOLD_HOURS } from "./candidateSla";

const APP = process.cwd();
const read = (rel: string) => readFileSync(resolve(APP, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the band escalates with the wait", () => {
  it("a day-old applicant is a warning, not yet urgent", () => {
    // The positive control. Without it, a function that returned "breached"
    // for every input would satisfy every escalation assertion below and turn
    // the panel into a permanent red the operator learns to ignore.
    expect(slaBand(24)).toBe("warning");
    expect(slaBand(30)).toBe("warning");
    expect(slaBand(39)).toBe("warning");
  });

  it("40 hours is urgent — eight hours of runway left", () => {
    expect(slaBand(40)).toBe("urgent");
    expect(slaBand(47)).toBe("urgent");
  });

  it("48 hours is a BROKEN PUBLIC PROMISE, not a late chore", () => {
    expect(slaBand(48)).toBe("breached");
    expect(slaBand(200)).toBe("breached");
  });

  it("each threshold is inclusive at its own boundary", () => {
    // An off-by-one here means the 48-hour promise reports as kept on the hour
    // it is broken.
    expect(slaBand(SLA_THRESHOLD_HOURS.urgent - 1)).toBe("warning");
    expect(slaBand(SLA_THRESHOLD_HOURS.urgent)).toBe("urgent");
    expect(slaBand(SLA_THRESHOLD_HOURS.breached - 1)).toBe("urgent");
    expect(slaBand(SLA_THRESHOLD_HOURS.breached)).toBe("breached");
  });

  it("an UNKNOWN wait escalates instead of resting in the calmest band", () => {
    // hoursWaiting is null when createdAt is NULL. `Number(null)` is 0, which
    // is how a naive coercion files an un-ageable row under "warning" — the
    // most reassuring answer available, for the row we know least about.
    expect(slaBand(null)).toBe("breached");
  });
});

describe("the age is computed in SQL, never from a driver-parsed Date", () => {
  const helper = strip(
    sliceBlock(read("server/db.ts"), "export async function getCandidateSlaBreaches", "\nexport ", {
      label: "db.ts",
    }),
  );

  it("selects the wait with TIMESTAMPDIFF", () => {
    // Driver-parsed TiDB DATETIMEs come back shifted +4h on Eastern, so
    // `Date.now() - row.createdAt.getTime()` overstates every wait by four
    // hours — enough to cry breach at 44 real hours.
    expect(helper).toContain("TIMESTAMPDIFF(HOUR");
  });

  it("does not age the row in JavaScript", () => {
    expect(helper, "Date.now() age arithmetic is the skew bug").not.toMatch(/Date\.now\(\)/);
    expect(helper, "getTime() age arithmetic is the skew bug").not.toMatch(/getTime\(\)/);
  });

  it("takes its 24-hour cutoff from the constant, not a second literal", () => {
    // The threshold was declared in SLA_THRESHOLD_HOURS AND hard-coded as
    // `INTERVAL 24 HOUR` here. Raising the surfacing threshold in one place
    // would have left this query returning rows the banding no longer counts
    // as late — the query and the label disagreeing, silently.
    expect(helper).toContain("SLA_THRESHOLD_HOURS.warning");
    expect(helper, "a literal hour count is a second source of truth").not.toMatch(
      /INTERVAL\s+\d+\s+HOUR/,
    );
  });

  it("gates on contactedAt, not on status alone", () => {
    // contactedAt is the clock stop: an admin can move a candidate through
    // statuses without ever having contacted them, and the promise is about
    // contact. Filtering `status = "new"` alone let an applicant moved
    // straight to "interviewing" fall silently off the alarm.
    expect(helper).toContain("isNull(candidates.contactedAt)");
    expect(helper).not.toMatch(/eq\(candidates\.status,\s*"new"\)/);
  });

  it("distinguishes a dead handle from an empty queue", () => {
    // "No one is waiting" is the single most reassuring answer this can give,
    // which makes it the one that must never be fabricated from a dead
    // connection.
    expect(helper).toMatch(/if\s*\(!db\)\s*return\s*\{\s*available:\s*false/);
  });
});

describe("the alarm reaches an operator", () => {
  const panel = strip(read("client/src/pages/admin/leads/CandidatesPanel.tsx"));

  it("queries the breaches WITHOUT the panel's collapse gate", () => {
    // The defect being closed is that the promise had no surface except a
    // collapsed panel. `enabled: open` on this query would rebuild the same
    // gap one level down: the badge could only warn you after you had already
    // gone looking.
    expect(panel).toContain("trpc.candidates.slaBreaches.useQuery()");
    const call = sliceBlock(panel, "trpc.candidates.slaBreaches.useQuery(", ";", {
      label: "CandidatesPanel.tsx",
    });
    expect(call, "the SLA query must not be gated on `open`").not.toContain("enabled");
  });

  it("renders the count in the header, where a shut panel still shows it", () => {
    const header = sliceBlock(panel, "aria-expanded={open}", "</button>", {
      label: "CandidatesPanel.tsx",
    });
    expect(header).toContain("slaRows.length");
  });

  it("says so when the SLA read itself failed", () => {
    // available:false must not render as silence — silence is indistinguishable
    // from "nobody is waiting", which is the fabricated zero this whole shape
    // exists to prevent.
    expect(panel).toContain("sla.data?.available === false");
  });

  it("stops the clock when a candidate is contacted", () => {
    // Without this invalidate the badge keeps counting someone who was just
    // called, and an operator who sees a stale alarm twice stops reading it.
    const mutation = sliceBlock(panel, "trpc.candidates.updateStatus.useMutation", "});", {
      label: "CandidatesPanel.tsx",
    });
    expect(mutation).toContain("utils.candidates.slaBreaches.invalidate()");
  });
});
