# Showing the welcome: proof and drafts (2026-10-24)

Nour, 2026-10-24: people in Cleveland would say Nick's is the warmest, most comfortable, most welcoming shop,
"by a mile". This file is the evidence behind that, the ways to show it, and the drafts waiting on his approval.
Nothing here is posted, sent or scheduled. Every item needs Nour's go for that specific item.

## 1. What the evidence supports (read 2026-10-24)

| Fact | Source |
|---|---|
| 4.9 stars on 1,727 Google reviews; 1,674 of them five-star (97%), 27 one-star | Google Maps listing, read 2026-10-24 |
| "Polite staff" is the most-mentioned topic Google pulls from the reviews: 54 reviews, ahead of used tires (46) and brakes (45). "Honest mechanics": 6 | Google Maps "Refine reviews" topics, 2026-10-24 |
| Newest 480 reviews (about two years back), 376 with written text: 49 of 376 (13%) use warmth words (friendly 24; welcoming, comfortable or "at home" 9; polite or courteous 8; plus kind, respectful, patient) | Google Search reviews panel, sorted newest, keyword count, 2026-10-24 |
| Same 376: 96 (26%) mention speed (fast, quick, in and out, minutes); 13 (3%) say honest or trust | same read |
| In a Google Maps "tire shop" search around the shop, Nick's has the most reviews: 1,727 at 4.9. Next: 656 (4.3), 585 (4.5), 531 (4.8) | Google Maps, 2026-10-24 |
| Only 10 reviews are stored in our own `review_replies` table, so the database cannot give a base rate | SELECT-only probe, 2026-10-24 |

**What it does not support.** "Warmest by a mile" is a comparison, and no warmth data for other shops was read, so it
stays a CLAIM. Customers write about speed about twice as often as about warmth. Public copy should show the people
and let customers' own words carry the welcome, never "warmest in Cleveland" or "#1".

**Unconfirmed amenities.** Coffee, water and a phone charger for people who wait are a standard in `SHOP-SOUL.md`
section 2, not a confirmed daily fact. Nothing below promises them until Nour confirms.

## 2. Ways to show it, ranked

| # | What | Proof it uses | Effort | Cost | Where |
|---|---|---|---|---|---|
| 1 | Customers' own lines about the people at the decision point | 6 verbatim Google review lines | 2 h (done, PR) | $0 | nickstire.org /about |
| 2 | Three Google Business Profile posts with real shop photos | "Polite staff" topic, review lines, photos 903, 481, 814 | 1 h, then 15 min a week | $0 | Google Business Profile |
| 3 | Reel: what drivers write about the people at Nick's | Real footage plus verbatim review lines on screen | 3 to 4 h to cut | $0 (no AI spend) | Instagram and Facebook Reels, posted by hand |
| 4 | Post-visit text that sounds like the counter | It is the experience itself | 30 min copy, small PR | $0 (same send count) | Post-visit text (invoice-keyed lane) |
| 5 | Counter review card: crew photo front, Google review QR back | Real crew photo 814 | 1 to 2 h | about $40 to $80 print (estimate) | In the shop |

Also worth doing, after the five: an Instagram pinned post "Meet the people working on your car" (needs each crew
member's yes for a face photo), and a visible waiting-area standard (water, charger) once Nour confirms what is
actually offered every day.

## 3. Draft A: website (built, PR open, not merged)

/about "In our customers' words" now shows six verbatim Google review lines about how the crew treats people, with
"Google review" under each and no names. It replaces three curated testimonials that could not be traced to real
reviews. Lines and their age when read:

1. "He took care of my car, also he made me feel at home while I waited…" (a week old)
2. "He got me in and out, I was comfortable waiting. Im very satisfied with the work." (a week old)
3. "Good friendly nice respectful people there. They inspected my car before they did any work to exactly tell me
   what was wrong…" (2 months old)
4. "Boss is trustworthy and kind, stuck to quoted price, and goes over and beyond to help customer. They gave me a
   ride to my bank so I could pay in cash." (2 weeks old)
5. "The guys here are kind and get it done!! In and out 20 min. Attitude and courtesy matter and I appreciated
   them." (about a year old)
6. "They were so courteous and polite. Plugged the hole, checked all the tires and was super reasonably priced.
   This is my family's new tire store" (about a year old)

Rules kept: words unchanged, whitespace normalized, long reviews trimmed with an ellipsis, names removed (customer
and crew). If Nour wants it on the homepage too, the same list can replace the homepage fallback cards.

## 4. Draft B: Google Business Profile posts (copy only)

Photos are from the shop media library (`C:\Users\nourd\NattyNour\shop-media`, numbers are triage ids). Do the
100% plate check on any photo with a car before it goes public.

**Post 1: what people write about the crew.** Photo 814 (crew under the sign; each person's yes first) or 903.
> Google lists "polite staff" as the top topic in our reviews. A few lines, word for word: "Good friendly nice
> respectful people there." "I was comfortable waiting." "Attitude and courtesy matter and I appreciated them."
> Walk in any day, first come, first served. 17625 Euclid Ave.

Button: Get directions.

**Post 2: if you wait, this is where you sit.** Photo 481 (waiting room, counter, Brakes Forever banner) or 483.
> This is the waiting room at Nick's. One customer put it this way: "He took care of my car, also he made me feel
> at home while I waited." For a longer repair, drop the car off and we call you when it is ready. Walk-ins
> 7 days, no appointment needed.

Button: Call now.

**Post 3: first time here.** Photo 903 (Nour under the sign) or 495 (entrance with a car).
> First time at Nick's? Pull in on Euclid Ave, no appointment. We take a quick look first and give you a written
> estimate before any work. You decide, then we get you back on the road. Open 7 days.

Button: Get directions.

Facts used: walk-in, first come first served, 7 days, free quick check, written estimate first, drop-off and call
(`shared/business.ts` `model`, `SHOP-SOUL.md` section 2). No prices, no wait times, no amenities.

## 5. Draft C: reel

Pack: `docs/reel-packs/2026-10-24-what-drivers-write-about-the-crew/README.md`. Real footage only, posted by hand.
It never enters the autopost lane. A silent 18 s draft cut is at
`C:\Users\nourd\NattyNour\shop-media\reels-draft\what-drivers-write-DRAFT.mp4` (local only).

## 6. Draft D: post-visit text (copy only, no code change yet)

Live lane: `post-invoice-followup` (`server/postInvoiceFollowUp.ts`, keyed to invoices, about 7 days after the
visit). Today it reads "thank you for choosing Nick's Tire & Auto! We truly appreciate your business. Got 30 sec?
A Google review helps other Cleveland drivers find honest repair".

Draft:
> Hi {firstName}, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off,
> text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went:
> {reviewUrl}

Why this shape: it opens like the counter talks, offers help before asking for anything, and asks every customer
the same way. Asking only happy customers for reviews is review gating, which Google's policy forbids, so the ask
never depends on how the visit went. About 250 characters with the link, two SMS segments. Sending stays with the
existing lane; changing the copy is a small PR on Nour's go.

## 7. Found while gathering (not fixed here)

1. `shared/customer-testimonials.ts` holds "testimonials" that could not be traced to real reviews: "Amber S." adds
   invented details to a real review, "Greg M." and "Marcus L." read like house copy. They still render as the
   fallback on every service and city page (`serviceReviews.forService`, `forCity`).
2. Homepage reviews subline names "the lady whose Civic survived 287,000 miles", with no source found.
3. `server/services/aiReceptionist.ts` TwiML greets callers with "Cleveland's top-rated auto repair shop".
4. /about meta description promises "a coffee maker older than half our customers"; unverified.
