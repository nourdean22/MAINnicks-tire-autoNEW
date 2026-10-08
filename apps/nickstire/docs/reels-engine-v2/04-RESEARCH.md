# Reels Engine v2 — Research, 2026-10-08 (evidence classes kept apart)

Classes: **A platform-established** (Meta/Instagram's own pages, read today) · **B independent
finding** (a study with a stated method) · **C creator/vendor observation** (practitioner claim,
unmeasured or self-reported) · **D untested hypothesis** (ours). A number in class C is not a
target; it is a lead.

## A. Platform-established

| Fact | Source (read 2026-10-08) | Note |
|---|---|---|
| Reels ads: keep "roughly 14% of the top, 35% of the bottom, and 6% on each side" free of text, logos and key creative; 9:16; recommended 1440×2560; primary text 44 characters | Meta Ads Guide, Instagram Reels (image) — `facebook.com/business/ads-guide/update/image/instagram-reels` | verbatim. The organic Reels UI has no published zone; building to the ad zone is the conservative choice (`02-PRODUCTION-DOCTRINE.md` §4) |
| Reels upload: aspect ratio from 1.91:1 to 9:16; minimum 30 fps; minimum 720 pixels | Instagram Help Center `help.instagram.com/1038071743007909` | the page body did not render through the fetcher today; figures are from the search excerpt of that page — re-read in a browser before quoting as spec. Third-party API guides cite 23–60 fps for API publishing, which is looser |
| Originality (2026-04-30, "Rewarding original creators on Instagram"): original = "work that you wholly created or reflects your unique perspective"; adding "a border, watermark, subtitles, or a caption credit" does not qualify; accounts that mostly post unoriginal content "will no longer be shown in places where we recommend content" (reels, photos and carousels); followers still see them; 75% of US recommendations are original posts; rolling 30-day window; no numeric threshold published | `creators.instagram.com/blog/rewarding-original-creators-on-instagram` | this is the strongest reason for the real-evidence-first doctrine: a Reel built on the shop's own footage is original by definition; a template-stock backdrop reel is not *unoriginal* (it is ours) but is also nothing Instagram can call unique |
| Trial reels: a toggle on the share screen; shown to non-followers first, hidden from followers and the grid; ~24–72 h window; Creator/Business accounts, ≥ 1,000 followers | vendor guides (Publer, Postfast, Inro, May 2026) + TechCrunch on the earlier "Experiment mode" | **class C for the specifics** — no Meta page was reachable; Mosseri is quoted (unverified) that trial reels reach less than regular reels because followers' early engagement is missing. Useful for the 8-Reel pilot: a trial is a cold-audience read, not a follower read |

## B. Independent findings (method stated)

| Finding | Source | Transfer to a 15–35 s automotive explainer |
|---|---|---|
| Short-video narrative structure: suspenseful, question-based openings with a delayed reveal; a middle driven by tasks (goals/obstacles) and rhythm; closings that lift the meaning and cue a behaviour | Frontiers in Communication 2026, `10.3389/fcomm.2026.1746478` — **single-case** qualitative study (one Bilibili travel vlogger, top 500 videos, NVivo coding); the authors state the effects are "not … empirically verified from the audience's perspective" and call for experiments | supports the Evidence-diagnosis family's symptom → evidence → "what the inspection decides" → one action shape; it does not license any claim that the shape *causes* retention |
| Sound-off viewing: ~75% of people say they often keep phones muted during video (self-reported; 85% Millennials, 64% Gen X) | Sharethrough research relayed by Digiday (sponsored); platform view-share figures (≈75% silent on Facebook/Instagram/LinkedIn) are second-hand (HubSpot via a glossary); TikTok is reported mostly sound-on | class B- (self-report). Enough to keep muted-first clarity a hard rule: every beat carries text, the VO is the spine, never the only carrier |

No peer-reviewed study with a stated sample on "the first three seconds" surfaced in today's searches;
every retention percentage found (70% three-second retention, 22% lift from question openers,
0.3–0.8 s decision window) is a vendor figure with no method shown. They are listed under C.

## C. Creator and vendor observations (leads, not facts)

- Name the topic in the first three seconds with on-screen text; keep text near the middle of the
  frame (Marketing360, Nestscale). Matches the editorial contract.
- Openers of 10–15 words delivered inside two seconds; no "hey guys" (hook guides). Our readability
  gate (> 3 words/s warns) is stricter than this.
- Pay the hook off: the promise and the payoff must match (hook guides; the TikTok newsroom's
  "one tangible object, then build outward"). For a repair channel the tangible object is the worn
  part on the bench — the Evidence-diagnosis opening.
- Trust claims for shops: real technicians, real cars, warning-light and maintenance topics make a
  shop look helpful (repairshopwebsites.com; Enright Auto's YouTube growth story, self-reported:
  trust/transparency, iPhone + wireless mic, trending sounds banked in advance).
- Reviral (2026, via GoFaceless): 86.6% of "high-performing" clips use word-level animated
  captions; question openers +22% five-second retention — **sample and definitions not shown**.
- Safe-zone measurements by third parties disagree with Meta's figures (Adkit, measured March
  2026: 13% top / 23.4% bottom / 3.2% sides plus a right-edge action column; Billo: Stories and
  Reels share one zone since March 2026). Meta's 14/35/6 stays the conservative contract.

### The "30 public examples" requirement — not met, and why

Web search from this container cannot open Instagram posts or profiles; every query returned
guides, patents and vendor pages. Two usable references: the Tire Industry Association consumer
videos (a camera inside a tire watching a nail puncture in slow motion — the strongest faceless
mechanical-evidence device found, 5–6 min long, YouTube), and Enright Auto (YouTube). The honest
route to the 30-example study is the operator's own app: Instagram search for `tread depth`,
`penny test`, `rotor`, `alignment`, `pothole Cleveland`; save 30 to a collection; Pattern Lab
(`?igview=patterns`) already ingests saved references for hook/structure analysis. Until then, the
production methods below are grounded in the platform facts, the shop's own data and the two
references — not in a corpus.

## D. Transferable production methods (ranked for this shop)

| # | Method | Why it works (mechanism) | Class | Cheapest production |
|---|---|---|---|---|
| 1 | Open on the evidence under a raking light (worn edge, nail head, scored rotor) | the subject is unmistakable muted; originality by definition | A (originality) + C | real macro, phone + LED |
| 2 | Put the number on screen (gauge, balancer, tester) | a measurement is a claim the viewer can verify | C + packets | real close-up + deterministic card |
| 3 | Matched before/after from a clamped camera | comparison is the payoff; no narration needed | C | tripod, same exposure |
| 4 | A question the inspection answers, not the video | preserves trust; packets forbid diagnosis-by-video | A (brand/claims) | script rule |
| 5 | Text as the spine, VO as the explanation, sound as energy | ~75% muted viewing (B-) | B- | assembly captions + TTS |
| 6 | Camera-inside-the-object reveal (TIA device) | surprise with mechanical truth intact | C | a GoPro in a scrap tire; $0 after the camera |
| 7 | Three-cause card instead of one verdict | honest uncertainty reads as expertise | packets | deterministic card |
| 8 | Local condition as the opening (Cleveland pothole, salt, freeze-thaw) | relevance in frame one | C | real road still + motion |
| 9 | One CTA, last beat, ≤ 2 s | the end card never eats the opening | A (ad zone) + C | assembly |
| 10 | Trial reel for each pilot Reel before the grid | cold-audience read for a $0 experiment | A/C | the share-screen toggle |
| 11 | Deterministic typography only; no AI text | generated text is the top visual defect code | QA registry | assembly |
| 12 | Still + deterministic move before I2V before T2V | preserves the approved composition; cheapest accepted | doctrine | `templateStockStudio` |

## E. Models and prices (third-party trackers, Aug–Sep 2026; verify on the vendor page before spend)

| Route | Price | Capabilities | Failure modes to QA |
|---|---|---|---|
| Veo 3.1 (Gemini API) | $0.40/s standard 720/1080p, $0.60/s 4K; Fast $0.10–0.12/s; Lite $0.05–0.08/s (benchlm.ai, read 2026-09-11) | native 9:16 for reference-image generations since Jan 2026 (TechCrunch); first/last frame; up to 3 reference images; native audio | reference images + 9:16 rejected in at least one forum report; audio surcharge claims unverified |
| Runway Gen-4.5 | $0.12/s (12 credits at $0.01; Creatify checked Aug 2026; OpenRouter) | 720×1280 vertical, 5/10 s, image-to-video, no sound | 720p only; no audio |
| Video Forge (self-hosted) | compute estimate only | LTX-2.5 profiles: text/image-to-video, first/last frame; Wan 2.2 no first/last | never run on a GPU (`VIDEO-FORGE.md`) |
| `templateStockStudio` | $0 | still + six camera moves, 1080×1920@30 | cannot publish (stock guard) |

Cost per *accepted* shot is unknown for every paid route until the pilot records attempts
(`07-PRODUCTION-METRICS.md`).

## F. Hypotheses worth an A/B on this account (the decision metric for each)

1. Evidence-first opening vs question-first opening → `shares_per_reach` (experiment 1).
2. Real opening frame vs AI opening frame → `skip_rate` (experiment 2; needs the wiring).
3. Three-cause card vs single-cause narration → saves per reach (honesty as save-worthiness).
4. Measurement on screen vs narrated only → `avg_watch_time`.
5. Trial-reel first vs grid-first for pilot Reels → cold reach at 72 h (platform read, not ours).
