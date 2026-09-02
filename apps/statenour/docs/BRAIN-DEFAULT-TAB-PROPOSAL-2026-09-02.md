# Should MAP stop being the default `/brain` tab?

**Status: PROPOSAL — operator decision required. Nothing in this pass changed the default.**
Written 2026-09-02 alongside the brain-map legibility pass (WP-1 … WP-6).

`app/(mastery)/brain/page.tsx` sets `defaultKey="graph"`, so every visit to `/brain`
with no `?tab=` lands on the force-directed map. The question is whether it should.

---

## The argument for demoting it

A force-directed graph answers one question well: **"is this connected?"** It is an
exploratory instrument — you bring a hypothesis to it and look for shape.

The operator's actual daily questions, judging by what the other tabs exist to answer,
are different:

- **"What did the brain conclude?"** → REASON
- **"What moved since I last looked?"** → CONTINUITY / CHANGED

Neither is answerable from a node cluster. If those are the real queries, then landing
on MAP costs one navigation on every single visit, forever, and the landing surface is
decorative rather than decisive. A default tab is the most expensive piece of real
estate in the product; it should answer the most frequent question.

## The argument against

Three things cut the other way, and the third is the strongest.

1. **MAP is the only surface that shows structure.** No other tab renders the shape of
   the knowledge base. Demoting it does not just move a view; it removes structure from
   the default field of vision entirely.

2. **The unlinked tray now lives here.** WP-3 surfaces 43 nodes the brain ingested and
   never connected, framed as integration debt. That debt is visible on MAP and nowhere
   else. Demote the tab and the debt goes quiet — which is the failure mode this whole
   codebase keeps writing tests against.

3. **The evidence that motivated the question is now stale.** The audit measured MAP as
   148 nodes, 37% of them task and journal churn, 26% of them floating orphans, labels
   at P90 98 characters, no fit-to-content, and the canvas below its own fold. That map
   *was* undecidable. After this pass it is 50 connected nodes, zero orphans in the
   layout, labels capped at 28 characters, fitted to the viewport on settle. **The case
   for demotion was built on a version that no longer exists.**

## Recommendation

**Do not demote it now. Re-ask the question in two weeks against the improved surface.**

Deciding today would judge the new map by the old map's evidence, which is exactly the
reasoning error the repo's plan-gate exists to catch. It would also be unfalsifiable in
the wrong direction: if we demote and the operator stops seeing integration debt, nothing
will tell us that was a mistake.

**Concrete revisit trigger, so this does not become "later":** if, over two weeks of
normal use, the first action on `/brain` is switching away from MAP more than half the
time, demote it to a drill-down and promote REASON. That is measurable from the existing
page-visit tracking (`components/brain/page-tracker.tsx`) without new instrumentation.

If the operator already knows from experience that they always switch tabs, then the
measurement is unnecessary and the answer is demote — that judgement is theirs, and it
is worth more than two weeks of telemetry.

## What demotion would involve, if chosen

Small and reversible: change `defaultKey` on the `PageTabs` in
`app/(mastery)/brain/page.tsx`. Deep links are unaffected — `?tab=memory`, `?tab=reason`,
`?tab=wisdom`, `?tab=board`, `?tab=health` and `?tab=continuity` are live contracts from
Home and are keyed independently of the default. The tray and the map itself would remain
exactly as built here, one click away.

**Not recommended as part of that change:** moving the unlinked tray to another tab. It
belongs next to the structure it describes; splitting them would make the debt harder to
act on, not easier.
