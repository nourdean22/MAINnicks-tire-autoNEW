# GBP Q&A Seeding

**Status: DRAFT/MANUAL — copy-paste, no live posting.**

## Opportunity
The Google Business Profile Q&A section is empty/underused. Seeding it
with real questions + plain-English answers improves local SEO and
pre-answers what customers ask before they call.

## What's automated vs manual
- **Automated:** the answer copy is curated in `client/src/lib/gbpQaSeeds.ts`
  (17 pairs, 15 categories), claim-safety enforced by `server/gbp-growth.test.ts`.
- **Manual:** the owner posts BOTH the question and answer from the
  business account in GBP. Nothing here posts to Google.

## How to post (owner, ~15 min, one-time)
1. Open the GBP for Nick's Tire & Auto → "Q&A" (or search your own
   business on Google and use "Ask a question").
2. For each pair in the seed list: post the question, then answer it from
   the business account (GBP labels business answers as the owner).
3. Space a few out over days — a burst of identical-timestamp Q&As looks
   manufactured.

## Claim-safety rules baked in (do not violate when editing)
No "guaranteed same-day", no invented warranties or wait times, no
"everyone uses us", no exact prices except the **owner-approved used-tire
wording**: "used tires from $25 installed on select 12-inch sizes; most
used tires run $40-80 installed." "Payment Programs" is the brand term,
not "financing"; the site says "free check / written quote", never "free
estimate".

## Truth source
`client/src/lib/gbpQaSeeds.ts` (copy) · `server/gbp-growth.test.ts` (safety).
Future: a copy-button admin card in the Ops Hub (see integration plan in
`docs/gbp-growth-integration-plan.md`).
