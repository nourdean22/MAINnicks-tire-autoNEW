# CONTENT WAR ROOM — Final Quality Pass

**Nick's Tire & Auto · Instagram/Facebook content engine**
**Date:** 2026-06-24 · **Auditor:** Claude (Opus 4.8) · **Mode:** brutal, grounded in the real codebase
**Scope audited:** `apps/nickstire/{server,client,shared,data}`, `packages/{reel-engine,social-assets,gbp-publisher}`, standalone `reel-factory-out` / `veo-livetest`. Five read-only recon scouts mapped the system; two heart files (`contentManufacturing.ts`, `facelessReelStudio.ts`) were read line-by-line to verify the load-bearing claims below.

> This is not a generation prompt. It is a quality, optimization, and domination pass. Every assumption was challenged. Existing work was not protected.

---

## BOTTOM LINE (read this if nothing else)

You built a **Ferrari and left it in the garage with a fake speedometer.**

- **The architecture is genuinely elite.** 5 personas, 6 narrative franchises, 14 reel archetypes, 14 motion lenses, 14 anthropomorphized object-characters, multi-layer claim-safety gates, a weather-aware topic exploder, a wired-up learning loop, revenue attribution. This is *not* generic-AI slop. In the local-automotive niche it is probably best-in-class on paper.
- **But almost none of it runs.** Every autonomous switch is OFF by default: `REEL_AUTOPOST_ENABLED`, `REEL_GENERATION_ENABLED`, `REEL_PUBLISH_ENABLED`, the comment responder, inventory publisher. The daily reel campaign's last *manual* post was reel #4. The 9 AM cron is a no-op. **The engine that was built to run the account does not run the account.**
- **And the part that does run can't measure itself.** The content scoring system — your "publish only if it's great" gate — has the **LLM grade its own homework**. The generator invents the 0–100 scores, then the gate trusts them (`contentManufacturing.ts:341-350` → gate at `:480`). An AI told "clear 75" clears 75. Your "90+ everywhere" standard is currently **unenforceable theater.**
- **The content that shipped is mostly safe-but-forgettable.** ~3 of 14 shipped reel hooks ("Your tire is gaslighting you," "Metal on metal is a bill," the 20-minute install) are genuinely scroll-stopping. The rest open with jargon, end with the same "Stop by," carry the CTA only in the caption (which 60%+ never read), and have zero share/save/Stories mechanics.

**The fix is not "make more content." It is: turn the engine on, replace self-scoring with a real critic, fix ~10 mediocre hooks, ship Stories, and engineer shares/saves on purpose.** Most of the leverage is in *operationalizing and measuring* what already exists.

---

## FINAL GRADE

| Dimension | Score | Why |
|---|---|---|
| Creative IP & strategy architecture | **82 / A−** | Personas, franchises, archetypes, object-characters, territories — deep and non-generic. |
| Claim-safety & brand-voice enforcement | **90 / A** | Multi-layer pattern gates (price, fearmonger, overdiagnosis, generic-cliché, faceless). Real. Live. |
| Content-scoring *integrity* | **30 / F** | LLM self-scores; gate trusts fabricated numbers. The 90+ standard is unenforceable. |
| Hook / scroll-stop quality (shipped) | **55 / C−** | ~3/14 strong; majority open with jargon, no first-frame jeopardy. |
| Visual production maturity | **48 / D** | Ad Studio ships; Carousel/Reel studios generate *briefs*, not finished assets. Only 2 product shots. Brand tokens duplicated/mismatched. |
| Operationalization (does it actually ship daily?) | **22 / F** | Every autonomous switch OFF. Daily campaign abandoned at reel #4. |
| Engagement engineering (shares/saves/comments/Stories) | **35 / F+** | One static share-CTA line. Comment responder vestigial. **Zero Instagram Stories.** No trending audio. |
| Learning loop | **40 / D−** | Wired but latent: needs ≥2 posts/slot, no live data, and feeds on self-scored signals. |
| Local authority leverage | **70 / B−** | Cleveland angle is real and differentiating — but seasonally concentrated and under-shipped. |
| Distribution / publishing plumbing | **78 / B+** | Meta Graph (reel/carousel/feed), FB, GBP, scheduler, observer — solid. |

### Current System Score: **56 / 100 (D+)**
A weighted blend: the architecture earns an A−, but it is dragged down by a measurement system that doesn't measure, an engine that doesn't run, and shipped content that is mostly forgettable. **You are graded on what reaches a human, not what exists in a repo.**

### Projected Score After Improvements: **88 / 100 (A−)**
Achievable in ~60 days. The gap is almost entirely *operationalization + measurement + a dozen craft fixes* — not a rebuild. The hardest 12 points (A− → A) require real human-in-the-loop scoring data and sustained posting to prove out.

### Expected Impact (directional estimates — labeled as estimates, not measured)
Assumes: engine armed, real scoring critic, daily reels + 2 Stories/day + 3 carousels/week, share/save mechanics added, comment responder live with first-hour velocity.

| Metric | 90-day directional range | Driver |
|---|---|---|
| Reach / impressions | **+150–400%** | Daily cadence (from ~0 autonomous) + Stories discovery + trending audio + share-bait. |
| Engagement rate | **+40–90%** | Hook fixes + polls/quizzes + comment-reply velocity (Meta rewards 1st-hour). |
| Shares (sends) | **+200–500%** | "Send this to…" templates + tag-bait + saveable recaps (today: 1 static line). |
| Saves | **+150–350%** | Glovebox cheat-sheets, seasonal checklists, "save before the cold snap" formats. |
| Followers | **+300–800 net / 90 days** | Compounding from reach + bingeable series + Stories habit. |
| Bookings attributed to social | **+15–40 / month** | DM-keyword loops actually firing + CTA routing by content type. |
| Revenue (attributed) | **directionally meaningful, not guaranteed** | At Nick's ticket sizes, even +20 bookings/mo is real money; depends on close rate. Treat as upside, not a promise. |

> Honesty note: these are *modeling assumptions*, not telemetry. The single biggest lever is **turning the engine on** — a disabled engine has no impact at any quality level.

---

## BRUTAL EVALUATION — the 7 questions, answered for *shipped* content

| Question | Honest verdict on what's live today |
|---|---|
| Would I stop scrolling? | **Sometimes.** Reels 3/13/14 yes. Reels 1/2/5/6 no — they open with jargon, not jeopardy. |
| Would I share this? | **Rarely.** One static "send this to someone whose tires are bald" line. No tag-bait, no relatable-callout, no "this is so my husband." |
| Would I save this? | **Occasionally.** The penny-test / pressure tips are reference-worthy, but they aren't *designed* as glovebox keepers. No save-rate signal feeds back. |
| Would I send it to a friend? | **No, mostly.** Nothing is engineered as a "you have to see this." |
| Would I remember it tomorrow? | **The object-characters could** (pothole gremlin, brake-pad lifeguard) — but they're barely shipped. The educational reels won't. |
| Would I choose it over entertainment? | **No.** Most shipped reels are useful, not *entertaining*. The absurdity engine that would win this is defined but not generating. |
| Would I consume it if I weren't shopping for tires? | **Only the absurdity/character content** — which is the least-shipped layer. This is the whole game and it's idle. |

**Conclusion:** the content that would pass these tests (absurdity, characters, myth-busting, local drama) **exists as IP but isn't being produced.** The content being produced is competent education that loses to entertainment.

---

## SYSTEM-BY-SYSTEM AUDIT (graded, grounded)

### 1. Content Scoring / Eval — **GRADE: F (the critical defect)**
- **Self-scoring theater.** `generateScoredDraft` asks the LLM to emit `scoreCuriosity…scoreAuthority` (0–100), then `runManufacturingPipeline` computes a weighted overall and gates at `<75` (`contentManufacturing.ts:468-483`). The grader is the author. Faceless reels do the same ("Self-score and show per-part table"). **An LLM will inflate to clear any gate.**
- **Binary reel rubric.** The 75-pt faceless rubric is mostly pass/fail (hook present? text present? 4–6 beats?). A barely-legal hook and a viral hook both score 10. The gate is a **floor, not a ceiling** — it catches disasters, not mediocrity.
- **No distinctiveness / novelty / anti-repetition dimension.** Nothing penalizes "we did brakes last week." "Avoid repeating" is advisory prose, not scored.
- **Weights under-value the business.** Authority 10%, Local 10% (`:468-477`) — for a hyperlocal shop fighting national chains, both should be 15%+.
- **Fix:** add an **independent critic pass** (second model call, or human 1-tap rating in the admin UI) that scores the *finished* draft; gate on the critic, not the author. Add `distinctiveness` (penalize last-30-day overlap) and `scrollStop` (0–10) dimensions. Re-weight to Authority/Local 15%.

### 2. Reel & Video Engine — **GRADE: D (built, not running)**
- 14 reels shipped (manual), reels 9–30 exist as **text data only** (`reels-data.ts`) — never rendered. If `REEL_AUTOPOST_ENABLED` flips on without rendering them, the bot enqueues briefs for "a sock on your vents" and ships junk or stalls silently.
- VO→assembly chain is **not chained** inside `dailyReelPost` — expects a separate process; silent failure mode.
- Index tracking (`reel_autopost_index`) is non-atomic KV → double-post / stall risk.
- CTA lives in caption, never reinforced in-frame. VO scripts (25–35s) overstuffed for 15–22s reels.
- **Fix:** render the backlog before arming; chain gen→VO→assemble→publish; make the index atomic; put a visual CTA card on the final (loop) frame.

### 3. Content Brain (topic/hook/story) — **GRADE: C+ (smart, but blind)**
- Topic exploder is genuinely good: GSC queries + weather + competitor ratings feed a 15-angle explosion mapped to franchises/personas (`explodeTopic`). **Strong.**
- BUT competitor data is only *ratings* — no competitor *content* analysis → can't find white space.
- Hooks scored on only 4 dims, self-scored, no surprise/distinctiveness.
- Pipeline processes only top-3 angles, 1 draft each (`:430`) → ~3 drafts/run. Modest.
- **Fix:** feed competitor *post* themes into the "avoid/differentiate" instruction; add the critic; widen angle processing when reserves are low.

### 4. Visual / Carousel / Image / Ad — **GRADE: D+ (briefs ≠ assets)**
- **Ad Studio ships** (HTML/CSS → Puppeteer → post). Real, clean, on-brand (#FDB913/#0A0A0A/Anton).
- **Carousel & Reel studios generate briefs, not finished images.** The gorgeous `visualPrompt`s ("a tire in the witness box under a spotlight") are **operator homework** — no auto-call to image gen.
- **Visual style assigned by `Math.random()`** (`contentManufacturing.ts:312`) — luxury-cinematic can land on a pothole news-alert. No fit logic, non-reproducible, un-A/B-able.
- **Only 2 product shots** (`tire-hero`, `tread-macro`) reused everywhere → repetitive after 3 posts.
- **Brand tokens duplicated & mismatched:** `adTemplate.ts` uses Anton/Barlow + #FDB913; `packages/social-assets/src/brand.ts` uses Inter/Outfit. Two visual systems that don't talk.
- **Fix:** wire `visualPrompt → image gen → hosted URL`; replace random style with fit-mapped selection; shoot a real product-shot library (10–15 parts); unify brand tokens to one source of truth.

### 5. Distribution / Scheduling — **GRADE: B+ (the one mature layer)**
- Meta Graph (reel/carousel/feed), FB, GBP publisher, tiered cron scheduler, failure observer. Solid plumbing.
- Scheduled-posts queue is live; IG autopost has dry-run default.
- **Fix:** mostly fine — just *arm it* and add Stories publishing (absent entirely).

### 6. Learning Loop / Analytics — **GRADE: D− (latent + self-referential)**
- `instagram_analytics` captures reach/saves/shares/views; `getReelGenerationSignal()` extracts top themes + best hour and injects "PERFORMANCE FEEDBACK" into generation. **Good design.**
- BUT: latent until ≥2 posts/slot (sparse for months), needs live posting (off), and the themes it learns from were ranked by **self-scored** content. Garbage-in risk.
- **Save-rate is captured but never used** as a signal. Shares too.
- **Fix:** arm posting to generate data; add a `highSaveThemes` signal (saves = "reference-worthy"); decouple save/share into their own cadence biases.

### 7. Engagement (comments / shares / saves) — **GRADE: F+ (broadcast, not virality)**
- Comment responder: **not in any cron**, manual-only, **dry-run by default**, capped 5 replies/3 reels. Meta rewards first-hour velocity — this is the opposite.
- Shares: one static caption line. Saves: not engineered. **Instagram Stories: zero.** No trending audio (local static music only). No tag-bait, no polls/quizzes, no UGC.
- **Fix:** make the responder autonomous with a first-hour velocity bonus + sentiment routing; template 3–5 rotating share-CTAs; ship Stories daily; integrate trending sounds.

### 8. Creative IP (characters / absurdity / universes) — **GRADE: C (great library, no factory)**
- Object-characters, franchises, personas, territories — **excellent, real, non-generic.**
- BUT: ~3 sample reels (all tire/pothole/brake), franchises mostly un-instantiated (only "Cleveland Survival" actually appears), **no generative absurdity system** (concepts are hand-authored → will repeat in 6–8 weeks), single-service bias, personas not voice-differentiated in output.
- **Fix:** build a generative absurdity engine (this doc ships 100 starters); instantiate all 6 franchises; force per-service coverage; A/B personas.

---

## BORING-CONTENT DETECTION (sources + fixes)

| Boring source | Where it lives | Fix |
|---|---|---|
| **Jargon-first hooks** | Shipped reels 1/2/4/5/6 | Lead with jeopardy/curiosity/cost, not specs. (See "Top 50 Missing Hooks.") |
| **Same "Stop by" CTA every time** | `dailyReelPost` manifest | Rotate CTA by content type: save / send / DM keyword / walk-in. |
| **Education without entertainment** | Most reels | Route through absurdity engine + object-characters, not plain tips. |
| **Self-scored "great" content** | `contentManufacturing.ts` | Independent critic — boring content currently self-certifies as 90+. |
| **Random visual style** | `:312` | Fit-mapped style; stop gambling the aesthetic. |
| **2 product shots reused** | `adAssets` | Real product-shot library. |
| **Seasonal concentration (winter/pothole)** | Topic seeds | Build summer/AC/road-trip/spring universes (see per-service expansion). |
| **No recurring series payoff** | Franchises un-instantiated | Ship named, episodic series (see "Top 50 Missing Series"). |
| **Tire-topic monoculture** | Sample briefs | Force coverage of brakes/AC/battery/suspension/diagnostics/bearings. |

---

## CONTENT CHARACTER AUDIT (expand / keep / cut / add)

**Highest potential — EXPAND into recurring stars:**
- **Pothole Gremlin** — the perfect local villain; give him a weekly "Pothole of the Week" beat and a Cleveland map tour. Highest follow-magnet potential.
- **Brake-Pad Lifeguard** — turns the most boring high-margin service into character drama; "rescue of the week."
- **Dashboard Light Therapist** (persona) — owns the calm-in-a-panicky-category lane; nobody else does soothing.
- **Tire Whisperer** — wear-pattern "interpretation" is endlessly repeatable.

**KEEP, use more:** Penny-Test Inspector, Rust Creeping Villain, Road-Salt Quiet Thief, Check-Engine Smoke-Alarm — strong, under-shipped.

**THIN / consolidate:** "Shop Insider" and "Cleveland Car Doctor" overlap heavily (both authority/owner voice). Merge into one signature owner voice ("The Cleveland Car Doctor") to avoid a muddy brand voice — followers should recognize *one* expert, not two similar ones.

**ADD (missing archetypes):**
- A **recurring customer-stand-in** (anonymized, no fake face — a "driver" silhouette / hands-only) so stories have a protagonist to root for.
- A **seasonal antagonist roster**: Road Salt (winter), Heat-Wave (summer/AC + battery), Pothole Gremlin (spring) — gives the calendar built-in villains.
- A **"Bay" mascot/POV** (the lift itself) for behind-the-shop continuity without faces.

---

## COMPETITIVE ANALYSIS — "why watch us over TikTok / Netflix / sports / memes?"

The honest answer today is **"you mostly wouldn't"** — except for the absurdity/character content, which isn't shipping. Here is the defensible answer once the engine runs:

1. **Hyperlocal stakes nobody else has.** TikTok can't tell a Euclid driver that *the I-90 pothole that got them last February* is why their wheel shakes now. **Specific local jeopardy > generic entertainment.** This is the moat.
2. **Useful absurdity = entertainment that pays rent.** "If Brake Pads Had Yelp Reviews" is as funny as a meme *and* teaches a $0 fix that prevents a $400 bill. Memes don't save you money.
3. **Anthropomorphized parts = a cast you follow.** The Pothole Gremlin is a recurring villain; Netflix has characters, so should you. One-off tips have no cast.
4. **Real proof, shown not claimed.** 4.9★ on 1,685+ reviews animated as a constellation; today's actual lift-finds. Authenticity beats polish for local trust.
5. **The "open 7 days, walk-in" flex.** A genuine differentiator no national chain matches — turn it into a recurring vibe ("Open When Others Aren't").

**Where it's weak → fix:** entertainment value (ship absurdity), distinctiveness (fix the look — see Visual Styles), and consistency (arm the engine). If those three land, "why watch us" has a real answer.

---

## TOP 50 WEAKNESSES (grounded in the real system, ranked by damage)

1. **Self-scoring theater** — the LLM grades its own content; the publish gate trusts fabricated 0–100 scores (`contentManufacturing.ts:341-350`,`:480`). The "90+ everywhere" standard is unenforceable.
2. **The engine is OFF.** `REEL_AUTOPOST_ENABLED`, `REEL_GENERATION_ENABLED`, `REEL_PUBLISH_ENABLED` all default false. Nothing posts autonomously.
3. **Daily reel campaign abandoned** — last manual post was reel #4; the 9 AM cron is a no-op.
4. **22 reels (9–30) are text data only** — never rendered; arming autopost risks shipping junk/stalling.
5. **Visual style chosen by `Math.random()`** (`:312`) — no fit logic, non-reproducible, un-A/B-able.
6. **Zero Instagram Stories** — the highest-discovery, daily-habit format is entirely absent.
7. **Comment responder is vestigial** — not in cron, manual-only, dry-run default, capped 5/3 reels. Kills first-hour velocity.
8. **CTA lives only in captions** — 60%+ of reel viewers never read them; CTA never reinforced in-frame.
9. **One static share-CTA** — "send this to someone whose tires are bald" is the entire share strategy.
10. **Saves captured but never used** as a generation signal (`saved` column ignored by `pickTopThemes`).
11. **Shares captured but never used** as a signal either.
12. **Binary reel rubric** — barely-legal and viral hooks both score 10; gate is a floor, not a ceiling.
13. **No distinctiveness/anti-repetition dimension** — nothing penalizes repeating last week's topic.
14. **Authority & Local weighted only 10% each** for a hyperlocal shop fighting national chains (`:468-477`).
15. **Tire-topic monoculture** — almost all shipped/sample content is tire/pressure/pothole; brakes/AC/battery/suspension/diagnostics/bearings barely covered.
16. **No generative absurdity system** — concepts hand-authored; the 8–10 existing will visibly repeat within 6–8 weeks.
17. **Franchises un-instantiated** — 6 defined, only "Cleveland Survival" actually appears in output.
18. **Personas not voice-differentiated** in actual generated copy — 5 defined, indistinguishable in practice.
19. **Two overlapping authority personas** (Shop Insider ≈ Cleveland Car Doctor) muddy the brand voice.
20. **Only 2 product shots** reused across every ad → repetitive after 3 posts.
21. **Brand tokens duplicated & mismatched** — `adTemplate` (Anton/Barlow/#FDB913) vs `social-assets/brand.ts` (Inter/Outfit).
22. **Carousel/Reel studios output briefs, not assets** — gorgeous `visualPrompt`s are operator homework; no auto image gen.
23. **No before/after format** — the single most-proven local-service format (worn vs new) doesn't exist.
24. **No multi-part series** — every reel is one-off; no binge/return mechanic.
25. **VO scripts (25–35s) overstuffed** for 15–22s reels → rushed pacing.
26. **VO/assembly chain not chained** in `dailyReelPost` → silent failure if assembly fails.
27. **Non-atomic reel index** (`reel_autopost_index` KV) → double-post / stall risk.
28. **No trending-audio integration** — local static music only; forfeits the biggest algorithmic boost lever.
29. **No seasonal urgency engine** — weather is *tagged* but not used to *prioritize/time* posting.
30. **Competitor data is ratings-only** — no competitor *content* analysis → can't find white space.
31. **Learning loop latent** — needs ≥2 posts/slot; sparse for months; best-hour stays null.
32. **Learning loop feeds on self-scored content** — garbage-in to the "what's working" signal.
33. **Attribution is single-touch, first-interaction** (`attributeRevenueToSocial`, 14-day flat window, no decay).
34. **Attribution depends on customers texting a keyword** — low-signal; the IG DM auto-responder loop may not even exist.
35. **No hashtag strategy** — LLM-generated placeholders; no trending/evergreen split, no tracking.
36. **No A/B testing harness** — every post is a one-shot; no variant learning on hook/CTA/style.
37. **Hard-coded allowed prices** `[49,80,60,25,40,100]` (`:264`) — brittle; a $45 oil change would be rejected.
38. **No first-frame jeopardy** in most reels — they open on pretty macro, not a visible problem.
39. **`briefJson` is freeform LLM text** — the storyboard is an unvalidated string, not structured data.
40. **No Story studio / generator** to match the Reel/Carousel studios — Stories have no production path at all.
41. **GBP content diverges from IG** — same brief could seed both; instead they're generated independently.
42. **No UGC mechanic** — zero "tag a friend," caption contests, customer-car features, or duet/stitch bait.
43. **No save-worthy "glovebox" assets** — tips aren't designed as screenshot-keepers with branded recap cards.
44. **No comment-sentiment routing** — angry/happy/question all get the same warm reply.
45. **No engagement-velocity alerting** — a post going off at hour 1 gets no bonus reply/boost pulse.
46. **Faceless rule under-leveraged** — "no fake people" is enforced as a *limit*, not turned into a *signature aesthetic* advantage.
47. **No highlight covers / profile shelf** — the IG profile has no branded, navigable Tires/Brakes/Hours/Reviews highlights.
48. **Proof under-used** — 4.9★/1,685 reviews appear as a flat stat, never as a recurring animated proof beat.
49. **Reel CTA + caption claim-safety can silently nuke AI personalization** — a tripped gate falls back to a generic manifest caption, losing the differentiated copy without surfacing it.
50. **No "why watch us over entertainment" answer ships today** — the content that would win that fight (absurdity/characters) is the least-produced layer.

---

## TOP 50 OPPORTUNITIES (the upside, ranked by leverage)

1. **Replace self-scoring with an independent critic** — instantly makes the 90+ standard real and every downstream signal trustworthy.
2. **Arm the engine** — the single highest-impact action; a disabled engine has zero impact at any quality.
3. **Ship Instagram Stories daily** — biggest untapped reach/discovery surface, lowest production cost.
4. **Activate the absurdity engine** — the only content that beats entertainment; turn the 100 starters in this doc into a generator.
5. **Engineer shares on purpose** — rotating "send this to…" + tag-bait + relatable callouts; 2–5× share potential.
6. **Engineer saves on purpose** — glovebox cheat-sheets + seasonal checklists + branded recap cards.
7. **Turn the Pothole Gremlin into a weekly franchise** — local villain + comment-sourced nominations = follow magnet.
8. **First-hour comment velocity** — autonomous responder + velocity bonus exploits Meta's ranking window.
9. **Wire `visualPrompt → image gen → URL`** — converts the studios from idea tools into production lines.
10. **Build a real product-shot library** (10–15 parts) — kills repetition, enables every service universe.
11. **Fit-map visual style** — stop gambling the aesthetic; match style to topic/emotion.
12. **Instantiate all 6 franchises** as named recurring series — converts a content library into appointment-viewing.
13. **Differentiate the 5 personas** in output (and merge the 2 authority ones) — a recognizable cast.
14. **Before/after as a core format** — proven, save-worthy, claim-safe (the part shows the proof).
15. **Trending-audio integration** — ride the single biggest reach lever you're forfeiting.
16. **Seasonal urgency engine** — fire weather-matched content the morning conditions hit.
17. **Competitor content analysis** — feed rivals' themes into "differentiate" logic to own white space.
18. **Save-rate & share-rate as learning signals** — separate cadence for reference vs reach content.
19. **CTA routing by content type** — education→save, problem→walk-in, quick-win→DM keyword.
20. **Per-service universes** — expand brakes/AC/battery/suspension/diagnostics/bearings to tire-level depth.
21. **Animate the 4.9★ / 1,685 reviews** as a recurring proof beat — show-don't-claim social proof.
22. **"Open 7 days / walk-in" as a recurring vibe** — a genuine differentiator turned into content.
23. **Multi-part reel series** — "Spot it → Fix it → What it costs" binge arcs.
24. **Comment-to-DM keyword quizzes** — engagement spike + booking funnel in one.
25. **Highlight-cover set** — give the profile a permanent branded shelf (Tires/Brakes/Hours/Reviews).
26. **Glovebox lead-magnet PDF** — "Cleveland Winter Car Kit," QR on final carousel slide → contact capture.
27. **Hands-only / POV human presence** — adds warmth inside the no-fake-people rule.
28. **A/B harness** — variant hooks/CTAs/styles, learn what actually drives shares vs saves vs clicks.
29. **Decay + multi-touch attribution** — actually isolate which content drives revenue.
30. **Unify GBP + IG from one brief** — amplify, don't diverge.
31. **Faceless as a *signature* aesthetic** — own a distinctive macro/forensic/diorama look competitors can't (people-based ads).
32. **Weekly "Today's Finds"** — real lift discoveries = endless, authentic, show-don't-claim content.
33. **Myth-court / evidence-board territories** for every service — proven engaging structures, under-used.
34. **Local landmark + neighborhood shoutouts** — make Collinwood/Willowick/Wickliffe feel seen → tags.
35. **Sound design / ASMR depth** — the muted-first rule already fits; lean into satisfying audio.
36. **Countdown mechanics** (first freeze, first snow, E-Check season) — manufacture honest urgency.
37. **Review-quote carousels** — customers write the ad; you just design it.
38. **"Mechanic Shower Thoughts" as a daily micro-format** — cheap, memorable, on-brand.
39. **Diagnostic HUD / scanner reveals** — the `diagnostic_hud_reveal` archetype is defined and never shipped.
40. **Reaction/reply reels** — convert real follower questions into evergreen content.
41. **Branded meme formats** — trending audio skinned in #FDB913/Anton with a tire-shop punchline.
42. **Stop-motion / claymation craft pieces** — high-save, high-share, fully faceless.
43. **"Customer Thought vs Reality" series** — defined franchise, zero samples; pure trust-building.
44. **Seasonal antagonist roster** — Road Salt / Heat-Wave / Pothole Gremlin gives the calendar villains.
45. **Pinned-comment CTAs** — keep captions clicky, move booking path to pinned comment.
46. **Save-streak / most-saved monthly recaps** — reward audience, re-surface evergreen wins.
47. **Interactive slider/quiz carousels** — "spot the worn one," "guess the tread" → study + save + comment.
48. **Weather-radar / news-alert reactive posts** — native to how Clevelanders already check weather.
49. **Cross-promo with real local businesses** — borrow audiences without a formal shoot.
50. **Turn the whole thing into a *measured* flywheel** — once scoring is real and posting is live, every loop compounds instead of guessing.

---

## TOP 50 FASTEST WINS (≤1 day each, high ROI, do these first)

1. Render reels 9–30 *before* arming any autopost switch (prevents junk/stall).
2. Add a visual CTA card to the final loop frame of every reel template.
3. Rotate the manifest CTA across 4 variants (save / send / DM keyword / walk-in) instead of "Stop by."
4. Replace `Math.random()` style pick with a topic→style lookup map.
5. Re-weight the draft score: Authority 0.15, Local 0.15 (trim two 0.15s to 0.125).
6. Add a one-line "distinctiveness penalty": skip any draft whose topic shipped in last 14 days.
7. Ship 3 Story templates (poll, this-or-that, "today's finds") and post them by hand this week.
8. Turn the comment responder cron ON in dry-run; review outputs; flip live for the top reel only.
9. Build a "send this to…" caption variant bank (5 lines) and randomize.
10. Fix the 6 cold hooks (reels 1,2,4,5,6,7) using lines from "Top 50 Missing Hooks."
11. Add `highSaveThemes` read from the `saved` column into the generation signal.
12. Create the 4 highlight covers (Tires/Brakes/Hours/Reviews) and pin them.
13. Animate a 4.9★/1,685-reviews proof card; drop it as a Story + reel-end beat.
14. Unify brand tokens: point `social-assets/brand.ts` to Anton/Barlow/#FDB913.
15. Shoot 8–10 real product macro shots (brake pad, rotor, battery, terminal, belt, filter, hub, valve stem).
16. Add a pinned-comment CTA to the next 5 reels.
17. Ship one before/after reel (worn pad → new pad) this week.
18. Post the "Pothole of the Week" Story with a comment-nomination sticker.
19. Add a save-prompt sticker to every educational carousel's last slide.
20. Write the "Cleveland Winter Car Kit" one-pager; QR it on the next carousel.
21. Instantiate "Mechanic Shower Thoughts" as 5 text-over-macro reels (cheapest content you have).
22. Trim VO scripts to ≤18s; let visuals breathe.
23. Add an atomic guard to the reel index (write date+index in one KV op).
24. Make a tripped caption-safety fallback *log loudly* + flag in admin (stop silent personalization loss).
25. Add first-hour velocity: if a reel hits N comments in hour 1, fire a bonus responder pulse.
26. Post a weekly "Today's Finds" carousel from real shop discoveries.
27. Add 3 trending-audio reels using existing visuals (manual sound swap).
28. Quiz Story: "Which tire passes the penny test?" (4-option).
29. "Open When Others Aren't" Sunday Story.
30. Convert one persona overlap: rename/merge Shop Insider into Cleveland Car Doctor.
31. Add a "scrollStop (0–10)" self-rated dim now (stopgap) *and* flag it for the real critic.
32. Tag-bait Story: "Send this to the friend ignoring that noise since March."
33. Review-quote carousel from 5 real 5-star reviews (no names/edits).
34. Add map-sticker "tap for directions, we're open" to daily Stories.
35. Seasonal countdown sticker (first freeze / E-Check) on Stories.
36. Add emoji-slider engagement Story after every snow/rain event.
37. Ship one `diagnostic_hud_reveal` reel (already-defined archetype, never used).
38. Ship one myth-court carousel for a non-tire service (brakes or battery).
39. Add a "what's busy this week at Nick's" Monday Story.
40. Caption-this engagement Story on a funny shop/weather photo.
41. Add the "constellation of 1,685 stars" animation as a reusable end-card.
42. Hands-only behind-the-shop clip (faceless) for warmth.
43. Pin a "walk in any day, no appointment" comment template.
44. Add hashtag split: 5 evergreen + 2 local-trending per post (manual to start).
45. Story link-sticker to booking, refreshed daily with a new hook.
46. One stop-motion craft reel (brake job rebuilding itself) for save/share.
47. Add "rate this repair 👍/👎" Story on a finished job.
48. Spot-the-problem interactive Story (tap where it's worn).
49. Cross-post the best reel to FB + GBP from the same brief.
50. Write down which switches are off and the exact arming order (ops runbook) so arming is safe.

---

## TOP 50 HIGHEST-ROI IMPROVEMENTS (structural bets, ranked)

1. **Independent critic scoring** (2nd-model + human 1-tap in admin) — makes quality real; unlocks everything downstream.
2. **Operationalize the daily engine end-to-end** (render→VO→assemble→publish, chained, monitored, armed).
3. **Generative Useful-Absurdity Engine** — LLM produces N new claim-safe absurd-but-useful concepts/week across all services.
4. **Instagram Stories studio + daily generator** — own the discovery/daily-habit surface.
5. **Share/save engineering layer** — share-CTA bank, tag-bait templates, save-card recaps, scored as first-class goals.
6. **Auto image/video generation wired into the studios** — briefs → finished assets, one click.
7. **Recurring named series system** — instantiate franchises with episode logic + scheduling.
8. **Trending-audio + trend-topic ingestion** — Meta sound library + local trend feed.
9. **Per-service content universes** — break the tire monoculture; depth on 9 services.
10. **Comment responder → autonomous + velocity-aware + sentiment-routed.**
11. **Closed, *trustworthy* learning loop** — feed on critic-scored + real engagement (save/share), not self-scores.
12. **Multi-touch + decaying attribution** with a holdout — actually measure content ROI.
13. **Real product-shot library + fit-mapped visual styles** — kills repetition, enables universes.
14. **A/B variant harness** — systematic learning on hooks/CTAs/styles.
15. **Persona voice differentiation + a recognizable cast** (characters as recurring stars).
16. **Competitor content intelligence** — find and attack white space.
17. **Seasonal urgency engine** — weather-triggered prioritization + timing, not just tagging.
18. **DM-keyword automation loop** actually built and firing (comment→DM→booking).
19. **Unified brief → IG + FB + GBP** amplification.
20. **Distinctive signature aesthetic** — turn "faceless" into an ownable look (see Visual Styles).
21. **Before/after as a first-class, templated format.**
22. **Save-worthy lead-magnet system** (glovebox PDFs + QR + capture).
23. **Highlight-cover + profile-shelf system.**
24. **Reaction/reply content pipeline** (follower Qs → evergreen reels).
25. **Proof-beat system** (animated reviews, today's-finds) as recurring.
26. **Local-authority program** — neighborhood shoutouts, landmark co-stars, community series.
27. **Hook quality model** with surprise/distinctiveness/scroll-stop dims.
28. **Structured storyboard schema** (replace freeform `briefJson`).
29. **Content calendar with seasonal balance** (winter/spring/summer/fall universes).
30. **Engagement-velocity alerting + auto-boost pulses.**
31. **Hashtag research + tracking layer.**
32. **UGC program** (caption contests, customer-car features, duet/stitch bait).
33. **Stop-motion/claymation craft track** for high-save flagship pieces.
34. **Myth-court / evidence-board territory rollout** across all services.
35. **Countdown/urgency mechanics** as reusable templates.
36. **"Today's Finds" automated capture** from shop workflow.
37. **Sound-design/ASMR production standard.**
38. **Cross-promo partnerships** with local businesses.
39. **Save-streak/most-saved recap automation.**
40. **Interactive carousel mechanics** (sliders/quizzes).
41. **Branded meme-format pipeline** (trend + brand skin).
42. **Seasonal antagonist roster** as a content spine.
43. **Pinned-comment CTA standard.**
44. **Reel CTA in-frame standard** (not caption-only).
45. **Price-allowlist → config-driven** (not hard-coded array).
46. **Caption-safety fallback transparency** (surface, don't silently degrade).
47. **GBP content elevated** from isolated to brief-seeded.
48. **Reserve-system tuned to per-service balance** (not just type counts).
49. **Ops runbook + safe arming sequence + alerting** (so "on" never means "broken silently").
50. **A measured flywheel** — the meta-bet: real scoring + live posting + real signals = compounding, not guessing.

---

## TOP 50 MISSING CONTENT TYPES

1. **Before/After Side-by-Side Reel** — Split-screen of a salt-crusted, pothole-chewed part vs. the clean replacement on a satisfying snap-cut; the visual delta persuades without a claim and begs a save.
2. **"Send This To" Share-Bait Card** — 1-slide poster: "Send this to the friend who's been ignoring that noise since March" — a tag-a-friend grenade.
3. **Comment-to-DM Keyword Trigger** — "Comment SALT and we'll DM you our free-check checklist"; comment surge feeds the algorithm, DM opens a booking convo.
4. **Green-Screen Google-Review Reaction** — Faceless hands hold a phone showing a real 5-star review while the matching part is inspected — show-don't-claim.
5. **Sound-On ASMR Diagnostic** — Audio of a healthy vs. rough wheel bearing, "one of these is worth checking" — trains the ear, earns saves.
6. **Poll-Sticker Carousel Quiz** — "Which tire passes the penny test?" 4-option visual quiz people screenshot to test their spouse.
7. **This-or-That Swipe Decider** — "All-season vs. winter for a Euclid driveway?" — settles a real local debate, shop is the referee.
8. **Stitch-Bait Reaction Prompt** — Reel ends "Duet this with your weirdest car noise" — algorithm-favored, no shop on camera.
9. **Map-Pin Pothole Reel** — Overhead zoom to a notorious Euclid Ave/Shoreway crater, "tag the one that got you."
10. **Receipt-Roll Trust Reel** — Printer spitting a long roll: "1,685 reviews and counting" — proof as a satisfying physical object.
11. **Countdown-to-Snow Sticker Series** — Weekly lake-effect countdown graphic tied to a real Cleveland calendar pressure.
12. **First-Frame Hook-Test Reel** — Reels built around a 0.5s pattern interrupt, optimized purely for swipe-stop rate.
13. **Saveable Glovebox Cheat-Sheet** — "Screenshot and keep in your glovebox" dashboard-light legend, built to live in a camera roll.
14. **Carousel Cliffhanger** — Slide 1 ends mid-sentence ("The #1 thing we find on Euclid cars in winter is…"), forcing the swipe.
15. **Reply-Reel (Comment Answered)** — Pin a real follower question over a faceless lift-shot answering it.
16. **Weather-Triggered Reactive Post** — Pre-built "first hard freeze" template fired the morning it actually happens.
17. **Two-Column Myth-Buster Poster** — "What people Google vs. what's actually worth checking" — calm authority.
18. **Loop-Until-You-Get-It Reel** — Seamless loop (bead seating, lug torque) with no clear end, juicing replays.
19. **Texture-Macro ASMR Carousel** — Extreme macro gallery (tread, pad wear, terminals) — beautiful enough to save.
20. **"Caught On The Lift" POV Reel** — POV-you-are-the-part: camera as the rotor narrating its Cleveland winter.
21. **Number-Reveal Counter Reel** — Animated counter ticking to 1,685 reviews / 7 days open with a build-up beat.
22. **Tag-The-Car Identification Game** — "Spot the bad tire in 5 seconds" with a timer — comment + replay bait.
23. **Seasonal Swap Checklist Carousel** — "Spring de-salt / fall winter-prep" 5-slide list timed to the equinox.
24. **Stitchable Open-Loop Question** — "Why do Euclid cars eat front tires faster?" — invites stitches + follows.
25. **Branded Meme-Format Reel** — Trending audio skinned in #FDB913/Anton with a tire-shop punchline.
26. **Day-In-The-Bay Time-Lapse** — "The only Saturday plan that's actually open" — proof of 7-days as motion.
27. **"Would You Trust This?" Poll Reel** — Worn part + yes/no poll overlay; algorithm gold.
28. **Carousel-to-Lead-Magnet** — Final slide is a QR/link to a "Cleveland Winter Car Kit" PDF.
29. **Reaction-Face-Free Hand-Cam Skit** — A bit told entirely with hands + props; faceless personality.
30. **Sound-Test Quiz Reel** — 3 mystery car sounds, "which means worth-a-look?" answer in slide-out captions.
31. **Pinned-Comment CTA Reel** — Booking path lives in a pinned comment, keeping captions clean and clicky.
32. **Local Landmark Co-Star Poster** — Tire composited near a recognizable public Cleveland skyline for instant resonance.
33. **"Save For Later" Maintenance Calendar** — 12-month at-a-glance car-care graphic; the screenshot-of-the-year.
34. **Reverse-Reveal Reel** — Start on the clean result, rewind to the rough "before."
35. **Two-Speed Split Reel** — Real-time vs. slow-mo of the same satisfying action side by side.
36. **Quote-Card Carousel From Real Reviews** — Verbatim 5-star lines on Anton/yellow cards (no names).
37. **"First-Come Energy" Open-Sign Reel** — Looping animated "OPEN — no appointment" sign with foot-traffic blur.
38. **Interactive Slider Comparison Post** — Faux drag-the-line slider showing tread depth or rotor wear.
39. **Emoji-Diagnostic Decoder Reel** — "🔋 = worth a check, not a panic" — disarming dashboard translation.
40. **"Things We Heard This Week" Audio Reel** — Faceless montage of recreated customer one-liners over shop b-roll.
41. **Local Business Cross-Promo Carousel** — "Euclid small-biz we love" mutual shoutout slide.
42. **Stop-Motion Part Assembly** — Frame-by-frame brake job rebuilding itself; high craft, high save.
43. **"Rate This Repair" Slider** — Clean finished job, "rate the satisfaction 1-10" — frictionless social proof.
44. **Geo-Targeted Neighborhood Shoutout** — Rotating "Hey Collinwood / Wickliffe / Willowick" posters.
45. **Anatomy-Label Diagram Carousel** — Clean exploded wheel diagram with callouts; send-to-your-teen explainer.
46. **"Plot Twist" Diagnostic Reel** — Obvious-seeming problem, reveal the real (often cheaper) cause.
47. **Soft-CTA Story-Highlight Cover Set** — Branded highlight covers (Tires/Brakes/Hours/Reviews) — a permanent shelf.
48. **Caption-Contest Reel** — Funny freeze-frame, "best caption wins a free check" — floods comments.
49. **"Proof In Motion" Star-Fill Animation** — 4.9★ filling stroke by stroke synced to a beat drop.
50. **Save-Streak Recap Carousel** — Monthly "the 5 things you saved most" round-up.

## TOP 50 MISSING SERIES

1. **"Salt Season Files"** — Winter-long chronicle of what road salt does to Cleveland cars, one part per episode.
2. **"Euclid Ave Autopsy"** — Each episode dissects one common failure found on cars from a specific local road.
3. **"The Penny Test Diaries"** — Micro-episodes starring the Penny-Test Inspector running the test on a new mystery tire.
4. **"Open On Sunday"** — Weekly post showing the shop genuinely open while everyone else is closed.
5. **"1,685 and Counting"** — Animate one real 5-star review per episode against the matching repair; the climbing count is the hook.
6. **"Pothole of the Week"** — The Pothole Investigator awards a trophy to Greater Cleveland's gnarliest crater; comment-sourced nominations.
7. **"Freeze-Thaw Forensics"** — How Cleveland's freeze-thaw quietly breaks specific components; recurs with every cold snap.
8. **"Lift Confessions"** — The most surprising (no-scare) thing found under a car this week.
9. **"Plain English Garage"** — The Cleveland Car Doctor translates one piece of jargon per episode.
10. **"Tread Court"** — The Tire Whisperer puts a worn tire on trial and delivers a soft verdict.
11. **"Sounds Like Trouble?"** — One real car noise decoded per episode; audio-first send-bait.
12. **"The 7-Day Shop"** — Behind-the-scenes time-lapse, one weekday per rotation.
13. **"Dashboard Therapy"** — The Dashboard Light Therapist de-escalates one panic light per episode.
14. **"Cleveland Winters Don't Care"** — One hard truth about lake-effect driving per episode.
15. **"From Our Reviews"** — Recreate the story behind one real review as a mini case study.
16. **"The Long Goodbye"** — Time-lapse retirements of worn parts, eulogized with how they got there.
17. **"First Freeze Watch"** — Annual countdown to Cleveland's first hard freeze with prep tips.
18. **"Bay 1 vs. Bay 2"** — Friendly recurring rivalry between two repair approaches or tire choices.
19. **"Macro Mondays"** — Weekly extreme close-up of one automotive texture; a save-habit ritual.
20. **"What the Salt Took"** — Episodic before/after corrosion reveals by component.
21. **"The Walk-In"** — POV series following the no-appointment, first-come experience step by step.
22. **"Euclid Driver Survival Kit"** — Each episode adds one item to a running, saveable seasonal car-kit list.
23. **"Rotor Rehab"** — Satisfying-restoration series, one grimy part to clean per episode.
24. **"Ask the Lift"** — Faceless reply-series answering one real follower question per episode.
25. **"Two Truths and a Tire"** — Myth-vs-reality game; followers guess which "fact" is fake.
26. **"The Suspension Sessions"** — What Cleveland roads do to struts, shocks, bushings; depth on an underrated service.
27. **"Cold Start Chronicles"** — Winter-morning episodes on batteries, oil, what struggles in single digits.
28. **"Found It Friday"** — Weekly reveal of the most unexpected (safe) thing pulled off a car.
29. **"The Alignment Argument"** — Each episode shows an alignment clue with the Pothole Gremlin as culprit.
30. **"Brake Pad Lifeguard"** — The character rescues one neglected brake situation per episode.
31. **"60 Seconds in the Bay"** — Strict one-minute teach-one-thing format.
32. **"Cleveland vs. Your Car"** — City roads, weather, and salt as recurring antagonists.
33. **"The Save List"** — Monthly recap resurfacing the most-saved post with a fresh angle.
34. **"Tire Whisperer Reads the Room"** — Interpret what a single tire's wear pattern is "saying."
35. **"Euclid Edition"** — Neighborhood-rotating series, one local area spotlighted per episode.
36. **"Wheel Bearing Whodunit"** — A hum/growl is the clue, the bearing the suspect.
37. **"Off the Lift"** — Clean finished-job reveals set to a beat, one per episode.
38. **"Survival Guide: After the Pothole"** — What's worth checking after a bad hit.
39. **"Real Reviews, Real Repairs"** — Pair a verbatim 5-star quote with the matching service explained.
40. **"The Cold Truth"** — Winter myth-busting, one piece of bad advice corrected per episode.
41. **"Tread Tuesday"** — Weekly tread-depth check on a mystery tire with a soft verdict.
42. **"Under Pressure"** — Tire-pressure series tied to Cleveland's temperature swings.
43. **"The Shoreway Diaries"** — Each episode themed around a specific I-90/I-480/Shoreway hazard.
44. **"Battery Roulette"** — Why batteries die in Cleveland cold and the clues that precede it.
45. **"The Quiet Killers"** — Slow, silent wear nobody notices until inspection (no fearmongering).
46. **"Mechanic Myth Court"** — Try one viral internet car-hack per episode; helpful or hogwash.
47. **"AC Season Countdown"** — Spring/summer series prepping cars for the first heat wave.
48. **"Tag, You're It"** — Built entirely from follower-submitted noises, photos, pothole tags.
49. **"The 4.9 Standard"** — Behind-the-scenes look at the specific habits that earn the rating.
50. **"Closing Time, Open Tomorrow"** — Nightly sign-off: "we're back in the morning, every day."

## TOP 50 MISSING HOOKS

1. "Nobody walks in here for fun. So let's make this quick." — honesty cold-open · diagnostics
2. "Your brakes don't squeal to annoy you. They squeal because that's the cheap part talking." — reframe · brakes
3. "The pothole won. Here's the receipt." — show-don't-claim · suspension
4. "You felt the wobble at 60. The wobble has been waiting for you." — personification · alignment
5. "This battery survived one Cleveland winter. It's telling us it won't survive a second." — foreshadow · batteries
6. "Cold start, slow crank, dashboard flicker. Your car is leaving you clues. Stop guessing." — curiosity · diagnostics
7. "That smell when the AC kicks on? It's not the road. Stop by and we'll take a look." — curiosity gap · AC
8. "A bad wheel bearing sounds like a plane taking off. A lot of people just turn up the radio." — humor/shame · bearings
9. "Road salt doesn't ask permission. It just eats." — personification · suspension
10. "You don't need new tires. You needed them in March." — cost-of-delay · tires
11. "The door jamb knows the answer. The sidewall is just bragging." — myth-bust · tires
12. "Your oil isn't black because it's dirty. It's black because it's done." — reframe · oil
13. "E-Check is Tuesday. The light came on today. Funny how that works." — local/dry humor · diagnostics
14. "It pulls right because something on the left gave up." — curiosity gap · alignment
15. "We pulled this out of a customer's tire. We're not going to tell you what it is yet." — open loop · tires
16. "Most 'mystery noises' have a very boring address. Let us find it." — contrarian · diagnostics
17. "POV: you're the brake pad. You've been screaming for two weeks. Nobody listened." — POV · brakes
18. "Your AC didn't break overnight. It quit slowly and you got used to it." — reframe · AC
19. "That clunk over the I-90 expansion joints? It's allowed to clunk once. Not every time." — local · suspension
20. "The light is not the problem. The light is the part of your car that's still honest." — reframe · diagnostics
21. "Open 7 days. No appointment. Yes, even when it's snowing sideways." — expectation flip · shop
22. "Your tires have a date stamp older than some of your group chats." — humor · tires
23. "It started as a tick. Then a knock. Now it has a personality." — escalation · diagnostics
24. "Freeze, thaw, freeze, thaw. The road does this all winter. Your suspension keeps score." — local · suspension
25. "POV: you're the serpentine belt and you've got about a week of dignity left." — POV humor · diagnostics
26. "A free check is free. The thing you ignored to avoid the free check is not." — cost-of-delay · diagnostics
27. "Your steering wheel shouldn't have a heartbeat." — pattern interrupt · alignment
28. "We didn't sell you tires. We let you read the tread yourself." — trust · tires
29. "The grinding stopped. That's not good news. That's a different bill." — false-relief flip · brakes
30. "You can hear lake-effect coming. Your brakes should be ready by then." — local/seasonal · brakes
31. "Two thumbs in the tread groove. If you see both, you already know." — show-don't-claim · tires
32. "Your car is fluent in two languages: normal, and 'pull over soon.' We translate." — authority · diagnostics
33. "It's not the gas. It's not the weather. It's the thing you keep meaning to look at." — elimination · diagnostics
34. "POV: you're the coolant and it's about to be a long, warm summer for everybody." — POV/seasonal · AC
35. "Euclid Ave eats alignments for breakfast. We just put them back." — local/authority · alignment
36. "Your battery doesn't die in summer. It plans the murder in summer and does it in January." — foreshadow humor · batteries
37. "A wobble at 70 is a conversation. A wobble at 30 is an argument." — escalation · alignment/tires
38. "That 'new car smell' you lost? Some of it was the AC working. Stop by and we'll take a look." — curiosity · AC
39. "You topped off the oil. The oil appreciates the gesture. The engine wanted the change." — humor · oil
40. "The brake light on the dash means one thing. The brake light you can't see means another." — curiosity gap · brakes
41. "Cuyahoga winters are undefeated against cheap tires. Let's see your tread." — local · tires
42. "Your car made that noise once to warn you. Now it's just venting." — personification · diagnostics
43. "We don't guess. We put it on the lift and let the car tell on itself." — authority · diagnostics
44. "POV: you're the wheel bearing and the highway is your stage now." — POV humor · bearings
45. "Bald tires don't slide in the dry. That's the trap." — myth-bust · tires
46. "The Shoreway potholes are free. The strut they took out is not." — local/cost-shock · suspension
47. "Your AC blows cold for ten minutes, then gives up. That's not the heat. That's a clue." — curiosity · AC
48. "You scheduled an oil change. Your brakes filed a complaint while you were here." — bundle · brakes
49. "It's not 'just a little shake.' It's a little shake that votes." — humor · alignment
50. "Come in for the free check. Leave knowing exactly what's lying to you." — payoff/trust · diagnostics

## TOP 50 MISSING NARRATIVES

1. **The Part That Cried Wolf, Then Stopped** — a squeal annoyed a driver for weeks; the day it went quiet was the day it got expensive — silence was the warning, not the cure.
2. **The $40 Fix That Almost Became an $1,800 One** — a cheap part flagged early before it took three others down.
3. **The Noise That Was Lying About Its Source** — a "front" sound lived in the back; chasing symptoms wastes money, the lift finds the address.
4. **The Pothole's Long Game** — a February I-90 hit that didn't show up until a summer wobble.
5. **The Tire With a Birthday Older Than the Driver Realized** — looked fine, the date stamp told the real story.
6. **The Winter That Came Back for the Battery** — surviving one season isn't passing; the second winter collected.
7. **The Driver Who Turned Up the Radio** — a growing bearing roar masked daily until it couldn't be.
8. **The Light Everyone Argued With** — the driver insisted the dash was wrong; the car was the honest one in the room.
9. **The Alignment That Ate One Tire** — three even, one bald strip; the tire didn't fail, something else was off.
10. **The Free Check That Paid for Itself in One Look** — skeptic expecting a pitch, left with one finding and no upsell.
11. **The Slow Goodbye of the AC** — cold air faded so gradually the driver forgot the baseline.
12. **The Clunk That Was Allowed Once** — normal over a bad joint, not over smooth pavement; the difference is the diagnosis.
13. **The Oil That Was Done, Not Dirty** — topping off doesn't reset the clock.
14. **The Two-Thumb Test the Customer Did Themselves** — handed the gauge, the driver made their own call.
15. **The E-Check Surprise** — the "bad timing" light was a real, findable heads-up.
16. **The Wobble That Got Louder With Speed** — a symptom that scales with speed points somewhere specific.
17. **The Strut the Shoreway Took** — cumulative pothole tax, no single hit to blame.
18. **The Customer Who Thought It Was the Tires** — chased a vibration with new tires; the real culprit was elsewhere.
19. **The Brake Pad's Two-Week Warning** — the squeal had a deadline the driver didn't know about.
20. **The Mystery Smell With a Boring Answer** — a scary AC odor with a simple, common cause.
21. **The Salt That Worked All Winter** — corrosion building silently while the driver watched only the paint.
22. **The Tick That Grew a Personality** — ignored until it escalated through three stages; cars rarely get quieter.
23. **The Bald Tire That Felt Fine in July** — dry grip hid the danger that showed up in the first wet leaves.
24. **The Pull No One Wanted to Admit** — months of compensating at the wheel, called "just how it drives."
25. **The Belt With a Week of Dignity Left** — spotted during an unrelated visit; the bundled look catches the unexpected.
26. **The Cold Crank That Was a Countdown** — a dismissed slow start was the battery's last few warnings.
27. **The Diagnostic That Ruled Out the Expensive Guess** — testing replaced fear with a number.
28. **The Tire That Held a Souvenir** — an embedded object slow-leaking for weeks.
29. **The Alignment After Euclid Ave** — new tires knocked off true by a rough stretch within a season.
30. **The Grinding That Turned to Quiet** — worn past the squealer into a worse, more expensive chapter.
31. **The Customer Who Came for One Thing and Learned Two** — in for oil, informed about a brake item, no pressure.
32. **The Heartbeat in the Steering Wheel** — a shimmy mistaken for the road; the road shouldn't have a pulse.
33. **The Coolant That Planned the Summer** — a spring issue cashed in during the first heat wave.
34. **The Reads-Its-Own-Tread Convert** — a "tires are fine" diehard shown the wear bars, changing their own mind.
35. **The Two Languages of a Car** — translating "normal" from "pull over soon" for a nervous driver.
36. **The Wobble That Voted** — a "tiny shake" influencing braking, fuel, and tire life at once.
37. **The Winter Wipers-and-Brakes Audit** — pre-lake-effect prep that caught a worn item before the first storm.
38. **The Topped-Off Driver** — proud of full fluids, unaware full isn't fresh.
39. **The Found-Object Reveal** — "we pulled this out of a tire" open-loop with a relatable reveal.
40. **The Slow Leak That Faked a Good Week** — reinflated fine each morning, masking a real puncture.
41. **The Bearing That Took the Stage** — a city-speed hum that opened into a highway roar.
42. **The Skeptic Who Expected the Upsell** — armored against a pitch, disarmed by one honest finding and a walkout option.
43. **The Freeze-Thaw Ledger** — a season of expansion and contraction loosening what was tight.
44. **The Light That Came Back** — a cleared code that returned; clearing isn't solving.
45. **The Brake That Complained While You Waited** — flagged during an unrelated service; the visit you booked reveals the one you didn't.
46. **The Tire That Wore a Map of the Problem** — the wear pattern itself diagnosed the cause.
47. **The "It's Just How It Drives" Driver** — a long-tolerated quirk that was a real, fixable fault.
48. **The Highway Reveal** — a noise that hid at 35 and confessed at 65.
49. **The Cold-Air Cliff** — AC cold for ten minutes then quit; how it fails is the clue.
50. **The Receipt-on-the-Record Pothole** — documenting the road damage so the "trust me" becomes a "look."

## TOP 50 MISSING REELS

1. **The Brake Pad Lifeguard's Last Shift** — macro of a worn pad shrinking frame-by-frame, a tiny orange whistle dangling (part_as_character_drama); loop snaps to a fresh pad.
2. **Squeal Decoder** — HUD overlays a waveform onto a spinning rotor, labeling the squeal type (diagnostic_hud_reveal); loops on flatline.
3. **The Rotor That Rings** — finger-tap on a grooved rotor triggers an alarm-bell ripple (asmr_macro / rotor_alarm_bell).
4. **Pedal Goes Soft** — overhead of a brake pedal sinking too far, freeze red ring; loop resets to firm.
5. **Brake Dust Forensics** — CSI-framed brake dust patterns under evidence lighting, arrows tag uneven wear.
6. **AC Vent Thermometer** — dash vents with a thermometer climbing the wrong way in summer heat; loop drops to cold.
7. **The Cabin Filter Autopsy** — pulling a leaf-clogged filter next to a clean one, dust frozen mid-air.
8. **AC Compressor Clutch Caught Mid-Cycle** — slow-mo of the clutch engaging/skipping, HUD tags the stutter.
9. **Why Your AC Smells** — split-screen "musty = need new car" vs the evaporator-moisture truth (myth_vs_reality).
10. **Summer Cabin Heat Map** — thermal-style graphic of a parked interior glowing red then cooling.
11. **The Battery That Sweats in July** — anthropomorphized battery fanning itself, voltage bar wobbling (battery_heat_victim).
12. **Crank… Crank… Click** — audio-forward slow-crank-to-click with a flickering dash icon.
13. **Corrosion Bloom** — macro of white-green terminal corrosion blooming then cleaned to bare metal.
14. **The Battery Age Tag Reveal** — zoom on the date sticker with an animated calendar counting years.
15. **Voltage Dashboard Drama** — title cards narrate a battery's "12.6… 12.2… 11.9" decline.
16. **The Suspension Bounce Test** — a corner pushed and bouncing too many times, count overlaid.
17. **Strut Mount Whisper** — strut compressing over a curb with an animated creak-line.
18. **The Clunk Locator** — chassis x-ray graphic pinpoints where a pothole clunk lives (pothole_gremlin cameo).
19. **Worn Bushing Time-Lapse** — a rubber bushing cracking under freeze-thaw cycles.
20. **Uneven Tire Wear = Suspension Telltale** — macro pans a cupped tread, arrows link it to a suspension HUD.
21. **The Pothole Gremlin's Cleveland Tour** — the gremlin hops I-90 → I-480 → Euclid Ave on a map line, the tightrope walker wobbling after.
22. **Steering Wheel Off-Center Freeze** — overhead of a wheel held straight but logo tilted, red level overlay.
23. **The Tightrope Walker Slips** — alignment_tightrope_walker loses balance over a misaligned tire then re-centers.
24. **Alignment Laser Grid** — laser lines projecting toe/camber angles onto wheels.
25. **Tread Diary: One Cleveland Winter** — a tire eroding across salt, snow, potholes Nov→Mar.
26. **The Penny Test Inspector's Verdict** — close-up of Lincoln lowering into the tread, a gavel-stamp "check it."
27. **Nail in the Wild** — forensic zoom finds a screw head in the tread under raking light.
28. **Tire Pressure Balloonist Deflates** — the balloonist sinks as a cold front passes, PSI ticking down.
29. **Sidewall Bulge Spotlight** — a single spotlight reveal of a sidewall bubble, freeze red ring.
30. **Valve Stem Traffic Controller's Bad Day** — the controller waves as air escapes a cracked stem.
31. **The Check Engine Smoke Alarm** — the alarm blares as cartoon "codes" float up, a scan tool silences it.
32. **OBD Scan in 4 Beats** — quick cuts: plug in → read → tag category → "worth a diagnostic" (fast_countdown_list).
33. **The Misfire Heartbeat** — an engine EKG line skipping a beat, "rough idle you can feel."
34. **Mystery Dash Light Lineup** — a police-lineup of glowing icons, spotlight lands on one.
35. **Smell Test: Sweet, Burnt, or Rotten** — three vapor-wisp panels tagged to systems.
36. **The Oil That Forgot to Come Back** — fresh amber oil streams in, morphs to sludge and back.
37. **Dipstick Story in 3 Frames** — clean → low → gritty dipstick swipes on a black card.
38. **Oil Life % Countdown** — HUD ticking 40% → 20% → 5% over a glowing engine.
39. **The Sludge Cap Reveal** — forensic lift of an oil cap showing milkshake residue.
40. **Filter Pleats ASMR** — extreme close-up of clean vs saturated oil-filter pleats, slow rack-focus.
41. **The Wheel Bearing That Hums** — a bearing-character hums louder as a speed graphic climbs.
42. **Hub Heat Signature** — thermal graphic showing one wheel hub glowing hotter.
43. **Bearing Play Wobble** — a lifted wheel rocked at 12-and-6, exaggerated wobble lines.
44. **The Roar That Follows You** — captioned audio of a road-roar tied to a turning-direction arrow.
45. **Road Salt Quiet Thief Strikes the Undercarriage** — the thief sprays corrosion along a frame, then a wash rinses it.
46. **Freeze-Thaw Crack Cam** — water seeping into rubber/metal, freezing, expanding a crack over a winter clock.
47. **Shoreway Pothole Ambush** — dashcam-forensic slow-mo of a wheel meeting a Shoreway pothole.
48. **Lake-Effect PSI Plunge** — a temp-vs-PSI dual gauge as a snow band sweeps in, both needles falling.
49. **E-Check Eve Checklist** — silent title cards of 4 things a glowing dash can mean before E-Check season.
50. **The 4.9-Star Constellation** — 1,685+ tiny review stars swarm into a single glowing 4.9 over a tire silhouette (no faces).

## TOP 50 MISSING CAROUSELS

1. **Your Brakes Are Trying to Tell You Something** — slide 1 a giant exclamation rotor; decodes squeal/grind/soft-pedal; recap "3 brake signals worth checking."
2. **Mechanic Translation: 'You Need Brakes'** — "what they say / what it means"; pad → rotor → fluid; recap 4-term glossary.
3. **The Case of the Squealing Wheel** — evidence-board + magnifier on a rotor; pins clues; recap "before it grinds."
4. **Brake Myths on Trial** — gavel over "Brakes last the life of the car?"; 3 verdicts; recap "the one true rule."
5. **Tiny World: Inside a Brake Caliper** — a miniature scene inside the caliper; recap saveable diagram.
6. **Car Body Language: The Brake Edition** — a car "flinching" while stopping; symptom→system table.
7. **What Your AC Is Actually Doing** — "not broken, overwhelmed"; refrigerant→evaporator→filter; recap "3 reasons it blows warm."
8. **Mechanic Translation: 'Your AC Needs a Recharge'** — recharge vs leak vs compressor; recap AC glossary.
9. **The Mystery of the Musty Vents** — evidence board on a vent; moisture + filter clues; recap "before summer."
10. **Cleveland Summer Survival: Cabin Comfort** — red-glowing car on Euclid Ave; AC + filter prep; recap checklist.
11. **Tiny World: The Cabin Filter Forest** — a leaf-jungle behind the glovebox; recap before/after card.
12. **Why Summer Is Hard on Your Battery** — "heat, not cold, is the silent killer"; recap "3 battery signs."
13. **Mechanic Translation: 'Your Battery's Weak'** — voltage vs cold-cranking vs age; recap glossary.
14. **The Case of the Slow Crank** — stopwatch on a starter; corrosion/age/click clues; recap "before it won't start."
15. **Battery Myths on Trial** — "a jump means it's fixed"; 3 verdicts; recap "the real test."
16. **Luxury Part Hero: The Battery** — battery shot like a watch ad; recap "how to read its age."
17. **Your Suspension Speaks in Bumps** — "that clunk is a sentence"; clunk/bounce/lean; recap symptom card.
18. **Mechanic Translation: 'You Need Struts'** — struts vs shocks vs bushings; recap glossary.
19. **The Case of the Cupped Tire** — magnify a wavy tread linked to suspension suspects; recap "what the tread reveals."
20. **Road Villain: The Pothole Gremlin** — a snarling pothole monster on the Shoreway; how one hit ripples; recap "after a big hit, check 3."
21. **Cleveland Survival: Pothole Season Playbook** — a battered Euclid road map; how to drive + check Feb–Apr; recap playbook.
22. **Car Body Language: The Lean and the Bounce** — a car tilting in a turn; motion→meaning table.
23. **Why Your Car Pulls to One Side** — "it's not the road, it's the angle"; recap "3 alignment signs."
24. **Mechanic Translation: 'You're Out of Alignment'** — toe/camber/caster demystified; recap glossary.
25. **The Case of the Crooked Steering Wheel** — a level on a wheel; off-center/pull/wear clues; recap "don't guess."
26. **Tiny World: Walking the Alignment Tightrope** — the tightrope walker on a tire edge; recap diagram.
27. **Alignment Myths on Trial** — "new tires don't need alignment"; 3 verdicts; recap "the rule that saves tires."
28. **Your Dash Lights, Decoded** — "which one is serious?"; plain-English top symbols; recap saveable icon key.
29. **Mechanic Translation: 'It Threw a Code'** — what a code is vs isn't; recap "what a diagnostic finds."
30. **The Case of the Check Engine Light** — pin a glowing CEL; smell/sound/feel clues; recap "before you panic."
31. **Diagnostic Myths on Trial** — "clear the code and it's fixed"; 3 verdicts; recap "what clearing really does."
32. **Car Body Language: The Shakes and Stutters** — a shivering car at idle; rough idle/hesitation; recap symptom→system.
33. **What Your Oil Color Is Telling You** — dipstick swatches amber→black; recap saveable color guide.
34. **Mechanic Translation: 'You're Due for an Oil Change'** — mileage vs oil-life vs condition; recap glossary.
35. **The Case of the Milkshake Oil Cap** — evidence board on a creamy cap; recap "check, not assume."
36. **Tiny World: Life Inside Your Engine on Old Oil** — a gritty world clogged with sludge; recap before/after.
37. **Oil Change Myths on Trial** — "3,000 miles or else"; 3 verdicts; recap "the honest interval rule."
38. **The Sound Your Wheels Make Before They Fail** — "that hum has a name"; decode the bearing roar; recap "3 bearing signs."
39. **Mechanic Translation: 'Your Wheel Bearing's Going'** — what a bearing does + why it hums; recap glossary.
40. **The Case of the Roaring Turn** — sound-meter on a wheel; roar-on-turn + wobble clues; recap "don't guess."
41. **Luxury Part Hero: The Wheel Bearing** — a bearing shot like jewelry; recap "how it signals trouble."
42. **Read Your Own Tires in 60 Seconds** — "your tires keep a diary"; penny test/wear bars/date; recap self-check.
43. **Mechanic Translation: 'Your Tires Are Done'** — tread vs age vs damage; recap 4-term glossary.
44. **The Case of the Nail You Didn't Feel** — magnify a screw in tread; slow-leak/PSI clues; recap "before it goes flat."
45. **Road Villain: Road Salt, the Quiet Thief** — a shadowy salt-villain creeping a frame; winter corrosion; recap "spring check-3."
46. **Cleveland Survival: Winterize Before the First Snow** — a snow-buried driveway; tires/battery/wipers/fluids; recap prep list.
47. **Car Body Language: How It Behaves in the Cold** — a shivering car on a frozen morning; behavior→meaning table.
48. **Warning System: Every Light, Sound & Smell Map** — a car diagram lit like a control panel; one master legend; recap "master signal map."
49. **Tiny World: A Day in the Life of Your Car's Parts** — a miniature city inside the engine bay; recap "meet your car's crew."
50. **Open 7 Days: What a Walk-In Check Actually Looks At** — a glowing "OPEN 7 DAYS" gate + clipboard; plain-English tour; recap "what to ask for."

## TOP 50 MISSING STORY FORMATS

1. **This or That: Tire Edition** — daily two-tap poll ("All-season vs Winter?") that trains the algorithm and surfaces what locals drive.
2. **Open Right Now** — morning sticker with today's hours + "walk in, no appointment"; screenshot-as-reminder.
3. **Pothole of the Week** — real crater photo + "rate this pothole 1-10" slider; Cleveland reply-bait.
4. **Guess the Tread Depth** — worn-tire macro with a "fine → free check" slider; soft diagnostic.
5. **Salt Watch** — morning-after-salt-truck story nudging an undercarriage check.
6. **Freeze-Thaw Alert** — overnight-low countdown ("28°F tonight — your tire pressure just dropped") with a save prompt.
7. **Ask Nick Anything** — weekly Q&A sticker; humanizes the brand, feeds Reel topics.
8. **Bay Cam: What's On The Lift** — quick mid-service clip (no faces) with "guess the job."
9. **Today's Finds** — end-of-day carousel of the gnarliest things pulled off cars today.
10. **Countdown to Winter Tires** — pinned countdown to first hard freeze; urgency builds itself.
11. **Quiz: Do You Know Your Dashboard Lights?** — 3-question quiz routing the "I have that light" crowd to a free check.
12. **Rate My Ride** — repost a customer car (with permission), slider rating; audience as suppliers.
13. **Two-Tap E-Check Reminder** — "E-Check coming up? Yes / Already did it"; captive deadline-driven audience.
14. **Weather Radar Drop** — lake-effect radar screenshot + "snow Thursday — get checked before."
15. **Link Sticker: Book a Free Check** — standing booking link, refreshed daily with a new hook.
16. **Emoji Slider: How's Your Commute?** — "rate today's roads" after every snow/rain event.
17. **Spot the Problem** — photo with a hidden issue + "tap where it's worn."
18. **Meet the Crew (Hands Only)** — mechanics' hands working (no faces) with a name caption.
19. **Before / After Slider** — drag-to-reveal a dirty-then-clean part; the most screenshot-worthy native mechanic.
20. **Walk-In Wins** — "someone walked in 10 min before close and rolled out fixed."
21. **Today's Weather → Today's Service** — forecast matched to a soft tip ("rain all week = check wipers + tread").
22. **Poll: Heard That Noise?** — "Squeal / Grind / Clunk / Nothing"; self-segments problem cars.
23. **First Snow Countdown** — seasonal countdown to first measurable snowfall.
24. **Tool of the Trade** — close-up of one tool + "guess what this does."
25. **DM Us a Pic** — "send a photo of your tire, we'll tell you if it's free-check time."
26. **Lake-Effect Survival Tips** — 5-slide tap-through checklist before a big snow.
27. **This Week at Nick's** — Monday preview of what's busy this week.
28. **Rate the Repair** — finished job + "would you trust this? 👍/👎."
29. **Mystery Part Monday** — extreme macro + "guess what it is," reveal next frame.
30. **Salt-Belt Checklist** — "5 things road salt is doing to your car right now" + save prompt.
31. **Open When Others Aren't** — Sunday/holiday flex that competitors are closed.
32. **Slider: How Cold Is Your Car This Morning?** — temp emoji slider on freezing days.
33. **Caption This** — funny shop/weather photo + "caption it in replies."
34. **Did You Know? (Cleveland Cars)** — one stat per story with a swipe to learn.
35. **Vote the Next Reel** — poll picking the next Reel topic; engagement now, pipeline later.
36. **Quick Fix Friday** — a 15-second behind-the-shop tip every Friday with a save sticker.
37. **Tag a Friend Who Needs This** — relatable "ignored the light too long" prompt.
38. **Pressure Check PSA** — auto-fires the first cold morning each week.
39. **Booked Today** — anonymous "X cars came through today" tally; social proof.
40. **Find the Nail** — tire photo with a hidden nail + "tap to find it."
41. **Two Roads, One Choice** — "highway or surface streets after a storm?" local debate.
42. **Save This for Winter** — "what to keep in your trunk this winter" graphic, built for saves.
43. **Shop Sounds** — impact wrench/lift audio + "tag yourself: that satisfying sound 🔧."
44. **Estimate the Wait** — "walk in now, guess your wait" slider; no-appointment flex.
45. **Real Review Spotlight** — animate one of 1,685+ reviews as a tap-through quote card.
46. **Storm Prep Countdown** — "48h until the snow — get checked."
47. **What's Your Make?** — poll cycling brands; builds audience data.
48. **One-Tap Directions** — map sticker + "tap for directions, we're open."
49. **Myth or Fact** — two-option sticker busting a car myth a week.
50. **End-of-Day Open Sign** — nightly "still open till close, roll in" for after-work commuters.

## TOP 50 MISSING VISUAL STYLES

1. **Caution-Tape Cut** — diagonal #FDB913 hazard stripes on near-black, Anton stencil punched through; warnings/alerts.
2. **Garage Blueprint Negative** — white-line drafting of a part on black, yellow dimension marks; "how it works."
3. **Halftone Pressroom** — heavy yellow CMYK halftone, slight misregistration, vintage print; stats/announcements.
4. **Sodium-Vapor Lot** — orange-amber streetlamp glow, a single lit tire; night / "always open."
5. **Forensic Tag** — evidence markers, ruler bars, yellow placards around a worn part; diagnostic reveals.
6. **Salt-Crust Texture** — white salt speckle + corrosion grain on black, yellow type cutting through; winter content.
7. **Anton Mega-Slab** — one word edge-to-edge, body shrunk to a footnote; single-message punch.
8. **Tire-Tread Emboss** — black-on-black tread debossed background, yellow type floating; quotes/reviews.
9. **Thermal-Cam Read** — false-color heat map (black→red→yellow) on brakes/tires; friction/overheat topics.
10. **Service-Manual Spread** — faux '70s Chilton page, monospace labels, exploded line art; educational series.
11. **Pure Grid Brutalism** — exposed grid, hairline yellow rules, oversized Anton; data/hours/menus.
12. **Hazard-Diamond Signage** — DOT road-sign shapes for car symptoms; warning-light content.
13. **Macro Rubber Noir** — extreme tread close-up, single-source light, deep shadow, yellow rim-light; product hero.
14. **Risograph Yellow** — single-color riso grain, imperfect edges; charming anti-slick local posts.
15. **Snow-Static Overlay** — lake-effect flecks over a dark plate, yellow lower-third; weather alerts.
16. **Oscilloscope Diagnostic** — yellow waveform/EKG across black; "heard that noise?" content.
17. **Reflective-Vest Weave** — hi-vis vest texture + reflective strips; crew/safety posts.
18. **Stencil Crate Stamp** — sprayed shipping-stencil lettering; inventory/"in stock" beats.
19. **X-Ray Amber** — translucent amber x-ray of a wheel/brake; cutaway explainers.
20. **Pothole Topography** — yellow contour-line map of a pothole/road; Cleveland road-damage content.
21. **Welding-Arc Flash** — a blown-out yellow-white flare on black, spark accents; reveal openers.
22. **Receipt-Roll Minimal** — thermal-receipt monospace list, yellow total line; checklists (no prices).
23. **Vintage Speed-Shop Decal** — retro racing badges + pinstripe; brand-pride/anniversary.
24. **Carbon-Fiber Black** — woven carbon near-black + one sharp yellow line; premium-but-gritty.
25. **Frost-Etch Glass** — ice-crystal etched type glowing faint yellow; first-freeze stories.
26. **Inspection-Sticker Collage** — layered Ohio E-Check sticker aesthetic; compliance reminders.
27. **Maximal Anton Wall** — repeated Anton tiled into a textured wall, one word inverted; brand-chant intros.
28. **Diagnostic OBD Terminal** — green-amber CRT terminal reframed in brand yellow; tech/code content.
29. **Spray-Paint Curb Mark** — utility-locator spray scrawl on asphalt-black; raw road-work-adjacent posts.
30. **Torn-Poster Layers** — ripped paste-up with yellow through black tears; gritty announcements.
31. **Schematic Wireframe Spin** — rotating yellow CAD wireframe of a tire/rotor; motion intros/loops.
32. **Heavy-Iron Letterpress** — deep ink-squeeze woodtype in yellow; premium quotes/reviews.
33. **Night-Drive Bokeh** — soft yellow streetlight bokeh, one sharp tire; "open late / drive home."
34. **Caution-Cone Iso** — isometric two-tone cones/lifts/tools; process explainers.
35. **Microscope Slide** — circular vignette + crosshairs on tread rubber; forensic close-ups.
36. **Asphalt Grain Plate** — real road-asphalt macro base, yellow lane-line type; road-condition posts.
37. **Warning-Light Constellation** — dash glyphs scattered like stars + yellow connect-lines; "know your lights."
38. **Snowplow Headlight** — a hard yellow beam through blue-black snow haze; storm-prep stories.
39. **Industrial Tab Index** — filing-tab/ring-binder motif; multi-part educational carousels.
40. **Sparkplug Macro Glow** — one part, tight yellow specular highlight on pure black; parts/battery hero.
41. **Lined Mechanic Notebook** — greasy graph-paper + hand-marked yellow arrows; "Ask Nick" tips.
42. **Hi-Vis Gradient Ban** — hard two-stop yellow-to-black duotone, posterized; unifies mismatched photos.
43. **Lug-Nut Radial** — five-point symmetry from wheel geometry; logo-adjacent dividers.
44. **Sandblast Stencil** — rough sandblasted-metal + masked yellow type; heavy-duty messaging.
45. **Closing-Time Glow** — a warm yellow "OPEN" neon tube with subtle flicker; hours/7-days.
46. **Pressure-Gauge Dial** — a big analog needle in the danger zone; tire-pressure alerts.
47. **Rust-Bloom Overlay** — organic orange-rust bleeding into black + crisp yellow type; salt-damage.
48. **Catalog Cut-Out** — hard-edged product cut-out + yellow offset shadow; tire/wheel product grids.
49. **Strobe Bay Light** — black + a single overhead shop-light bloom, dust motes in the beam; cinematic reveals.
50. **Ticket-Stub Perforation** — perforated tear-off coupon shape (no price — "free check" only); free-check CTAs.

## 100 NEW USEFUL-ABSURDITY CONCEPTS

1. **The Tire Tread Defendant** — a worn tire stands trial, the penny test is the star witness; tread below 2/32" loses wet grip (claymation courtroom).
2. **Brake Fluid: A Breakup Text** — fluid texts "I've absorbed too much moisture, I'm not the same"; brake fluid is hygroscopic and gets spongy, worth checking.
3. **Alignment Horoscope** — "Mercury's in retrograde and so is your steering wheel"; pulling to one side may indicate alignment is off.
4. **The Serpentine Belt Conga Line** — pulleys dance, one cracked dancer falls out of step; a glazed/cracked belt squeals and is worth checking.
5. **Coolant's Nature Documentary** — a hushed narrator tracks "the elusive coolant"; low/rusty coolant can point to overheating risk.
6. **Cabin Air Filter Support Group** — clogged filters reminisce about letting everyone breathe; a dirty filter weakens AC airflow.
7. **Spark Plug Speed-Dating** — fouled plugs get rejected each round; worn plugs cause rough idle and misfires.
8. **The Wheel Bearing Hum Choir** — one rising note louder with speed; a hum that changes when you turn may indicate a bad bearing.
9. **Wiper Blades: A Yelp One-Star** — "Smeared my whole windshield, zero stars"; chattering blades should be swapped before lake-effect snow.
10. **TPMS Light's Weather Forecast** — "cold front incoming, expect pressure drops"; pressure falls ~1 PSI per 10°F.
11. **The Oil Dipstick Crime Scene** — a detective dusts the dipstick; dark gritty oil is a clue it may be overdue.
12. **Battery's Retirement Party** — a 5-year-old battery's farewell speech in the cold; most fade after 3–5 years.
13. **Rotor Warp Figure-Skating Judge** — scoring a brake "wobble"; a shimmy when braking can point to warped rotors.
14. **The Lug Nut HR Meeting** — lug nuts file an "over-torqued and stressed" complaint; proper torque prevents warped rotors/stuck wheels.
15. **Shock Absorber Trampoline Park** — a worn shock adds three bounces; the bounce test reveals tired shocks.
16. **AC Compressor's Sweat Lodge** — the cabin schvitzes; warm-blowing AC can point to low refrigerant or a tired compressor.
17. **The Pothole Gremlin's Cousin Visits** — a rim-bending specialist; one hard Euclid pothole can crack a wheel or knock alignment.
18. **Tire Rotation Musical Chairs** — four tires scramble for seats; rotation evens wear so the set lasts.
19. **Coolant Hose's Midlife Crisis** — a "bulgy and soft" hose; swollen hoses can fail, check before a road trip.
20. **The Check Engine Light: A Misunderstood Roommate** — "I'm not yelling, I'm informing"; it's a hint to scan codes, not an instant emergency.
21. **Brake Pad Lifeguard's Apprentice** — a rookie learns the squealer whistle; the wear indicator squeals on purpose when thin.
22. **The Air Filter Boxing Match** — clean vs dust-clogged, round by round; a choked filter hurts power and mileage.
23. **Transmission Fluid Wine Tasting** — a sommelier frowns at "burnt notes"; dark/burnt fluid is worth a look.
24. **The Tire Sidewall's Tattoo Tour** — reading the cryptic codes like ink; find your size and the manufacture date.
25. **Headlight's Cataract Surgery** — foggy lenses get restored vision; oxidized headlights cut night visibility and can be restored.
26. **The Exhaust System Drum Solo** — a rattling heat shield bangs a beat; a rattle at idle is often a loose heat shield.
27. **Power Steering Fluid's Whisper Network** — a faint whine spreads gossip; a groan when turning can mean low fluid.
28. **The Winter Tire Snow Day Pep Rally** — winter tires cheer their soft compound; all-seasons harden below ~45°F.
29. **Differential's Family Reunion** — gears argue about whining; a whine that changes with speed can mean the diff needs attention.
30. **The Engine Mount's Yoga Class** — a torn mount can't hold the pose; extra shudder at idle/in gear can point to a worn mount.
31. **Tire Pressure Balloonist's Rival** — an over-inflated balloon brags about a hard ride; overinflation wears center tread.
32. **The Fuel Filter Bouncer** — a clogged filter stops "VIP gasoline"; restriction causes hesitation and stumbling.
33. **Cabin Smell Forensics: The Mildew Mystery** — tracing a musty AC smell; can point to a clogged evaporator drain or moldy filter.
34. **The Valve Stem Traffic Controller's Day Off** — a missing cap lets dirt in; the tiny cap keeps grime out and helps the seal.
35. **Brake Caliper's Stuck Handshake** — a seized caliper won't let go; a hot wheel or pull when braking can mean a sticking caliper.
36. **The Antifreeze Color Wheel** — colors aren't interchangeable; mixing wrong coolant can cause sludge.
37. **Tire's Online Dating Profile** — "Bald, 6 years old, loves wet roads (badly)"; age + low tread = a poor safety match.
38. **The Oil Light vs. Reminder Sibling Rivalry** — which is scarier; the red oil-pressure light is urgent, the reminder is a schedule nudge.
39. **Serpentine Belt's Last Will and Testament** — "I bequeath my squeak"; a cracked belt can snap and kill the alternator/water-pump drive.
40. **The Wheel Weight Tightrope Act** — a missing balance weight wobbles the high-wire; highway vibration can mean a rebalance.
41. **Battery Terminal's Beard of Corrosion** — a fuzzy terminal gets a shave; corrosion causes weak starts and is cleanable.
42. **The Strut Mount's Creaky Door Impression** — a clunk "answers the door"; knocking over potholes can mean worn strut mounts.
43. **CV Joint's Click Track** — a torn boot clicks in turns; clicking while turning can indicate a failing CV joint.
44. **The Thermostat's Thermostat War** — a stuck thermostat won't set the temp; slow warm-up or running hot can point to it.
45. **Tire Cupping: A Topographic Map** — a geographer surveys "scalloped mountains"; cupping can mean worn suspension or imbalance.
46. **The Spare Tire Backup Singer's Solo Disaster** — a sour underinflated note; check spare pressure since it sits ignored for years.
47. **Mass Airflow Sensor's Allergy Season** — a dusty MAF "sneezes" wrong readings; can cause rough running and a CEL.
48. **The Brake Line's Rust Belt Confession** — "Cleveland salt got me"; road salt rots brake/fuel lines, worth a winter inspection.
49. **Tire Plug vs. Patch Debate Stage** — two repairs argue qualifications; the right repair depends on where and how big the puncture is.
50. **The Idle Air Control's Hiccups** — a rough idle hiccups at the light; a surging/stalling idle has many causes worth scanning.
51. **Windshield Washer Fluid's Empty Threat** — bluffing during a salt-spray drive; keep winter fluid topped so grime doesn't blind you.
52. **The Heater Core's Cold Shoulder** — silent treatment in January; no cabin heat can point to coolant-flow problems.
53. **Tire Bead's Trust Fall** — clinging to the rim; a slow leak can come from a corroded bead seat, common with salt.
54. **The Oxygen Sensor's Lie Detector** — a lazy O2 sensor fails the polygraph; hurts mileage and can trip the CEL.
55. **Brake Dust's Reality TV Confessional** — heavy dust tells all; can be normal or hint at soft pads worth a glance.
56. **The Sway Bar Link's Rattle Rap Battle** — worn links rattle over bumps; a clunk on rough roads can mean bad end links.
57. **Antilock Brake Light's Stage Fright** — the ABS light freezes up; means the safety system may be offline, worth checking.
58. **The Radiator Cap's Pressure Diary** — a tired cap can't hold pressure; a weak cap can cause overheating and coolant loss.
59. **Tire Dry Rot: A Skincare Routine** — cracked sidewalls need moisture they'll never get; UV and age crack sidewalls even at low mileage.
60. **The Clutch's Friendship Slipping Away** — losing its grip on the relationship; rising RPMs without speed can indicate clutch wear.
61. **Glow Plug's Cold Morning Excuses** — a diesel glow plug isn't a morning person; hard cold diesel starts can point to glow plugs.
62. **The Tie Rod End's Wobbly Handshake** — a limp grip; loose steering or uneven wear can mean worn tie rod ends.
63. **Cabin Fan Blower's One-Speed Strike** — only works on full blast; a failing resistor loses fan speeds.
64. **The Engine Air Intake's Snorkel Story** — breathing through a crack; unmetered air leaks cause rough running and codes.
65. **Tire Feathering Detective Lineup** — a cop fingers "feathered edges"; feathered tread points to toe misalignment.
66. **The PCV Valve's Pressure Cooker** — building bad pressure; a clogged PCV can cause oil leaks and rough idle.
67. **Brake Pedal's Mood Ring** — a sinking pedal shows low confidence; spongy can point to air or moisture in the fluid.
68. **The Headlight Aim Archery Range** — misaimed beams miss the target; crooked/low beams cut night safety and can be adjusted.
69. **Coolant Reservoir's Bathtub Ring** — a brown crust marks the tide; low coolant or rust scale points to neglect.
70. **The Wheel Lock Key Hide-and-Seek** — a missing key wins forever; keep it in the glovebox or a flat fix becomes a saga.
71. **Tire Pressure's Goldilocks Bedtime Story** — too high, too low, just right; the door-jamb sticker (not sidewall max) sets correct PSI.
72. **The Muffler's Laryngitis** — a rusted muffler loses its voice and gets louder; sudden loud exhaust can mean corrosion.
73. **Serpentine Belt Tensioner's Arm-Wrestling Loss** — a weak tensioner can't hold tension; squeal can come from the tensioner, not the belt.
74. **The Fuel Cap's Loose-Lipped Gossip** — leaking secrets; a loose gas cap is a common evap-related CEL cause.
75. **Tire Bubble's Hernia Confession** — admitting an injury; a sidewall bubble means internal damage, check promptly.
76. **The Brake Rotor's Pizza-Cutter Grooves** — slicing like a wheel; deep scoring comes from metal-on-metal worn pads.
77. **A/C Cabin Filter's Pollen Apocalypse** — drowning in Ohio spring pollen; a fresh filter restores airflow in allergy season.
78. **The Engine Coolant Temp Gauge's Lie-Flat Seat** — stuck on cold, too relaxed; a gauge that never warms can point to a sensor or thermostat.
79. **Tire Valve Core's Tiny Bouncer Sequel** — a leaky core lets air sneak past; a slow leak with no nail can be a worn valve core.
80. **The Drive Shaft's Vibrating Massage Chair** — a worn U-joint buzzes at speed; vibration growing with speed can mean a failing U-joint.
81. **Battery Load Test Game Show** — "will it hold the charge?"; a load test reveals a battery that reads fine but fails under start load.
82. **The Oil Sludge Haunted House** — sludge haunts the hallways; skipped oil changes build sludge that starves parts.
83. **Tire Storage Closet's Hibernation Diary** — naps upright vs stacked; store tires cool, dry, out of sunlight to slow aging.
84. **The Wheel Alignment Bowling Lane** — drifting into the gutter; drifting on a straight level road can point to misalignment.
85. **Brake Booster's Lost Breath** — a hard pedal can't catch its breath; a failing vacuum booster makes braking weaker.
86. **The Spark Plug Wire's Lightning Leak** — leaking lightning in the rain; arcing wires cause misfires, worse when damp.
87. **Tire Load Index's Weightlifting Meet** — an underrated tire fails the heavy lift; load index must match the vehicle.
88. **The Engine's Morning Cough** — clearing its throat; prolonged rough cold starts can point to plugs, fuel, or sensors.
89. **Brake Hardware's Pit Crew** — overlooked clips and shims fix the squeal; new pads need fresh hardware to avoid noise.
90. **The Wiper Linkage's Tango Misstep** — wipers fall out of sync; parking wrong or jerking can mean worn linkage.
91. **Tire Speed Rating's Drag Strip** — a low-rated tire redlines too soon; the rating reflects heat tolerance, not a dare.
92. **The Catalytic Converter's Honeycomb Detective** — a clogged cat traps the bees; sluggish power + certain codes can point to it.
93. **Battery Ground Strap's Loose Handshake** — won't complete the deal; weird electrical gremlins can trace to a bad ground.
94. **The Tread Wear Bar Lighthouse** — signaling the rocks ahead; tread flush with the bars means the tire is at the limit.
95. **Suspension Bushing's Crumbling Cookie** — losing its crunch; clunks/loose handling can mean worn bushings, sped by salt.
96. **The Engine Oil Viscosity Dating Profile** — "5W-30 seeks compatible engine"; the right weight matters for cold starts (the W is winter).
97. **Brake Fade Marathon Wall** — pads hit the wall on a long downhill; overheated brakes fade and need cool-down + good condition.
98. **The Tire Rotation Pattern Choreographer** — FWD vs RWD learn different steps; rotation patterns differ by drivetrain.
99. **A/C Refrigerant's Disappearing Magic Act** — refrigerant vanishes but mass doesn't; AC needing frequent recharges likely has a leak.
100. **The 7-Days-a-Week Walk-In Bat Signal** — a car flashes a help-signal into the Euclid night and the shop is already open; odd noises and lights are worth a same-day free check, no appointment.

---

## CONTENT UNIVERSE AUDIT — per core service

For each service: honest current depth, the missing angles, and the missing narrative spine that turns "tips" into a world worth following. Today the account is a **tire monoculture** — ~80% of shipped/sample content is tires/pressure/pothole. The other 8 services are near-empty universes.

### 🛞 Tires — *depth: HIGH (over-served)*
- **Have:** pressure (door-jamb vs sidewall), tread/penny test, age/date stamp, slow leaks, pothole damage, rotation.
- **Missing angles:** load/speed rating literacy, plug-vs-patch, dry rot, all-season-vs-winter compound science, used-tire honesty, balance/wheel-weight, storage, spare neglect, "feathered/cupped" wear → suspension link.
- **Missing narrative:** the tire as a *diary that records every other problem* — "your tread is a confession." Make tires the lens that exposes alignment/suspension, not its own silo.

### 🛑 Brakes — *depth: LOW (high-margin, under-served)*
- **Have:** squeal-as-warning, metal-on-metal cost.
- **Missing angles:** soft/spongy pedal (fluid moisture), grinding stages, warped rotor shimmy, brake fluid hygroscopy, caliper seizure, brake hardware (clips/shims), ABS light, brake fade on hills, dust meaning.
- **Missing narrative:** the **Brake-Pad Lifeguard** living one shift, wearing thinner with each save — character drama on the most profitable service.

### 🎯 Alignment — *depth: MEDIUM*
- **Have:** pulling, crooked wheel, pothole timing.
- **Missing angles:** toe/camber/caster in plain English, "new tires need alignment" myth, wear-pattern reading (inner/outer/feather), the steering-wheel "heartbeat," post-curb checks.
- **Missing narrative:** the **Tightrope Walker** thrown off by one pothole and leaning forever after — and the Pothole Gremlin as the recurring cause.

### 🔧 Suspension — *depth: VERY LOW*
- **Have:** almost nothing shipped.
- **Missing angles:** bounce test, strut vs shock vs bushing, clunk localization, freeze-thaw bushing cracking, sway-bar links, ride-height/sag, the "pogo" stopping-distance cost.
- **Missing narrative:** "**What the Shoreway Took**" — cumulative small pothole taxes adding up to one big repair; salt + freeze-thaw as the silent ledger.

### 🩺 Diagnostics — *depth: LOW (most feared by customers)*
- **Have:** check-engine mentions.
- **Missing angles:** "a code is a hint not a verdict," the smoke-alarm metaphor, smell test (sweet/burnt/rotten), misfire heartbeat, "cleared code came back," mystery-noise triangulation, scanner/HUD reveal.
- **Missing narrative:** the **Dashboard Light Therapist** calmly de-escalating one panic light per episode — own the calm lane in a fear-based category.

### 🛢️ Oil Changes — *depth: LOW*
- **Have:** sludge ("gave up weeks ago").
- **Missing angles:** color-reads-condition, topping-off ≠ changing, conventional vs synthetic lifespan, the W = winter viscosity, oil-life % vs mileage myth, filter pleats, milkshake cap (coolant intrusion).
- **Missing narrative:** "**The Oil That Was Done, Not Dirty**" — and a life-inside-the-engine tiny-world on old oil.

### 🔋 Batteries — *depth: LOW (seasonally huge)*
- **Have:** cold-morning failure.
- **Missing angles:** **heat is the real killer** (summer cooks, winter exposes), 3–5yr lifespan, load-test-vs-voltage, terminal corrosion, parasitic draw, ground-strap gremlins, date-tag literacy.
- **Missing narrative:** "**The murder planned in July, committed in January**" — the battery as a victim whose fate is sealed in summer.

### ❄️ AC / Cooling — *depth: NEAR-ZERO (whole summer wasted)*
- **Have:** essentially nothing.
- **Missing angles:** "blows cold then quits" = clue, refrigerant leak (vanishing-magic), compressor clutch stutter, cabin-filter airflow, musty smell (evaporator drain/mold), pollen season, coolant/thermostat/heater-core overlap.
- **Missing narrative:** "**The Slow Goodbye of the AC**" — you adapt to failing cold until shown the baseline. Build the entire summer calendar here.

### ⚙️ Wheel Bearings — *depth: NEAR-ZERO (easy diagnostic wins)*
- **Have:** nothing.
- **Missing angles:** the airplane-takeoff roar, roar-changes-when-you-turn tell, hub heat signature, 12-and-6 wobble play, "people just turn up the radio."
- **Missing narrative:** "**Wheel Bearing Whodunit**" — the hum is the clue, the bearing the suspect; a recurring whodunit that makes an invisible part bingeable.

**Universe verdict:** you have one rich world (tires) and eight ghost towns. The fastest authority + reach gain is **forcing per-service coverage** (quota in the reserve system) and giving each underserved service its own character + narrative spine (above). That alone roughly **9×'s your content surface** without lowering the bar.

---

## PRIORITIZED ROADMAP (sequence to go from 56 → 88)

### Phase 0 — Make "great" mean something (Week 1) · *unlocks everything*
1. **Replace self-scoring with an independent critic** (2nd-model call + 1-tap human rating in admin). Gate on the critic.
2. Add `scrollStop` + `distinctiveness` dimensions; re-weight Authority/Local to 0.15.
3. Write the **ops arming runbook** + render the reel backlog (9–30) before touching switches.

### Phase 1 — Turn the engine on, safely (Week 1–2) · *turns 0 into 1*
4. Chain gen→VO→assemble→publish in `dailyReelPost`; make the index atomic; add failure alerting.
5. Arm `REEL_GENERATION_ENABLED` → `REEL_AUTOPOST_ENABLED` → `REEL_PUBLISH_ENABLED` in that order, watching each.
6. Ship **Instagram Stories** by hand daily (3 templates) while the studio is built.
7. Turn the comment responder on (dry-run → live on top reel) with a first-hour velocity bonus.

### Phase 2 — Make it want to be shared (Weeks 2–4) · *reach + engagement*
8. Share-CTA bank + tag-bait templates + saveable recap cards (scored as first-class goals).
9. Fix the 6 cold hooks; add a visual CTA card to the final loop frame.
10. Ship one before/after reel + one non-tire myth-court carousel + one diagnostic-HUD reel weekly.
11. Trending-audio integration (manual to start); branded meme format.
12. Highlight-cover shelf + animated 4.9★ proof beat + "Today's Finds" weekly.

### Phase 3 — Break the tire monoculture (Weeks 3–6) · *authority + surface*
13. Per-service coverage **quota** in the reserve system (no week >50% tires).
14. Instantiate all 6 franchises as named, scheduled series.
15. Stand up the **generative Useful-Absurdity Engine** (seed with the 100 concepts above).
16. Give each underserved service its character + narrative spine (per the universe audit).

### Phase 4 — Build the visual factory (Weeks 4–8) · *quality + throughput*
17. Wire `visualPrompt → image/video gen → hosted URL` in the studios.
18. Real product-shot library (10–15 parts); fit-mapped visual style (kill `Math.random()`).
19. Unify brand tokens to one source; roll out 3–4 signature visual styles.

### Phase 5 — Close the measured flywheel (Weeks 6–10) · *compounding*
20. Save/share-rate signals into generation; multi-touch + decaying attribution with a holdout.
21. A/B harness on hooks/CTAs/styles; competitor content intelligence for white space.
22. Unify GBP + IG from one brief; seasonal urgency engine fires weather-matched content.

---

## RECOMMENDED MOVE (right now)

**Bottom Line:** You don't have a content problem. You have an **operationalization + measurement** problem wearing a content problem's clothes. The IP is A-grade and idle.

**What's Really Going On:** Three silent killers — (1) the scoring system grades its own homework, (2) every autonomous switch is off, (3) the only content that beats entertainment (absurdity/characters) isn't being produced. Fix those three and the existing machine becomes a genuine growth engine.

**Do This Week (in order):**
1. Build the **independent critic** — until "great" is externally verified, every other metric is fiction.
2. **Render the reel backlog, then arm the engine** in the safe sequence with alerting.
3. **Ship Stories daily** and **fix the 6 cold hooks** — fastest visible quality lift.
4. Stand up the **absurdity generator** from the 100 seeds — your only real answer to "why watch us over TikTok."

**Brutal Truth:** A disabled, self-graded engine producing tire-only education is *indistinguishable from no engine at all* to the algorithm and to a Cleveland driver mid-scroll. The sophistication you built is invisible until it runs and until it can prove it's good. **Turn it on. Make it measurable. Make it funny. Make it local.** That's the whole game.

**Recommended Move:** Greenlight Phase 0 + Phase 1 now (1–2 days of focused work, mostly wiring + one critic). Everything else compounds off that.

---

*Audit grounded in read-only inspection of the live codebase (5 recon scouts + line-by-line verification of `contentManufacturing.ts` and `facelessReelStudio.ts`). No files other than this report were modified. All impact figures are labeled modeling estimates, not telemetry.*



