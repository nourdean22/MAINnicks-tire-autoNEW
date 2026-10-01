# Creative Intelligence OS — Research Evidence Book

Compiled 2026-10-01. Every claim carries a source, a date, a sample size where one exists, and
one tag: **OG** official guidance · **LSC** large-sample correlation · **CO** creator observation ·
**IC** industry claim · **HYP** hypothesis · **UNKNOWN** not found. Creator-level numbers are
third-party estimates; providers disagree by 0.3–0.5 pts routinely. Nothing here is a rule;
Nick's first-party data (`ig_metric_snapshots`, `search_performance`) outranks all of it.

Companion documents: [`README.md`](./README.md) (blueprint) · [`PROMPT-PACK.md`](./PROMPT-PACK.md) ·
[`EXAMPLE-OUTPUTS.md`](./EXAMPLE-OUTPUTS.md).

## A. Platform official guidance (Meta)

| # | Finding | Source · date | Tag |
|---|---|---|---|
| A1 | Instagram's 2024 Reels originality protections now apply to photos and carousels. Accounts that "primarily post unoriginal content" lose recommendation eligibility (not follower delivery), judged at account level over a rolling **30-day** window. "75% of recommendations in the US now coming from original posts." Original = photos/videos you took, content you designed, content you *materially* edited (unique on-screen text adding context, creative graphics adding information, remix). Not original = re-upload with only a border, watermark, subtitles, or caption credit. | creators.instagram.com/blog/rewarding-original-creators-on-instagram · **30 Apr 2026** (the March item is Facebook's) | OG — no sample size for the 75% |
| A2 | Facebook: "duplicative or involves minor edits to another creator's post will be considered unoriginal and deprioritized" in Feed and Reels. Low-value edits named: borders, speed changes, inserted captions. Reaction formats count as original only with "an on-screen presence… presenting something genuinely new." | creators.facebook.com/blog/supporting-original-content-on-facebook · **13 Mar 2026** | OG |
| A3 | Reels ranking: Mosseri (Jan 2025) names **watch time, likes, sends** as the top three; "average watch time, likes per reach, sends per reach." Likes weigh more for connected delivery, sends for unconnected. Meta Transparency Center "IG Reels Chaining" (updated 11 Nov 2025) lists the prediction models: <3 s short-view probability, extended viewing (>95th pct for that length), reshare, off-platform share, comment, follow, audio-use, "Interested" click. | fanpagekarma / creatorlanehq quoting Mosseri; transparency.meta.com/features/explaining-ranking/ig-reels-chaining | OG (Mosseri via secondary quotation) |
| A3b | "DM sends weigh 3–5× likes" is **not** Meta's number; attributed to third-party calculators. | socialday.live, creatorlanehq, reeldrop.io | IC |
| A4 | Trial Reels: non-followers only, off-grid, metrics after 24 h, optional auto-share if performing (launch 10 Dec 2024). 2026: scheduling added (Apr 2026, Mosseri on "regional engagement times"); desktop support and a per-30-day cap reported. "40% of creators post more / 80% higher non-follower reach" and a 1,000-follower threshold are secondary-only. | techcrunch.com 10 Dec 2024; socialmediatoday 2 Apr 2026; socialbee/socialchamp | OG for mechanics; IC for the stats |
| A5 | Facebook Creator Assistant (4 Jun 2026): conversational AI in Professional Dashboard that "turns performance insights into actionable ideas" — "why did this reel perform better", "when should I post", "what are people saying in my comments"; brainstorms from trending audio/moments; learns stated goals. US/Canada/India. | about.fb.com/news/2026/06/creator-assistant-…; creators.facebook.com/blog/meet-creator-assistant | OG |
| A6 | Reels ads: 9:16 video with audio and key elements in the safe zone had **34.5% lower cost per result** than image ads on Reels; "global meta-analysis of **15 split tests**", 99.9% confidence; 2× delivery to Reels placement. Safe zone: top 14%, bottom 35%, 6% each side; Mar 2026 unified FB/IG Stories+Reels 9:16 safe zone. | facebook.com/business/ads/facebook-instagram-reels-ads (login-walled; corroborated by campaignbuilder.io, billo.app) | OG — n=15, verticals exclude auto services |

**Implication for a faceless account:** A2 privileges on-screen presence only for *transformed third-party footage*. Fully self-produced faceless content is not penalised. The rule to encode: never repost supplier/manufacturer/creator clips with only a caption; every asset is self-generated, real-shop, or materially transformed.

## B. Large-sample studies (2025–2026) and where they conflict

| Source (date, n) | Metric | Finding | Author caveats | Tag |
|---|---|---|---|---|
| Socialinsider Reels-length, 14 Jul 2026, **6M Reels Jan–Jun 2026**, brand accounts | ER by length | 0–30 s 0.28% · 30–45 s 0.30% · **45–60 s 0.35%** · 60–90 s 0.30% · 90–120 s 0.30% · 120–180 s 0.33% · 180 s+ 0.15%. Median views: 1–30 s 4,700 · 45–60 s **10,374** · 60–90 s 9,790 · 180 s+ 4,428 | "aggregate numbers"; 45–60 s is "a baseline, not a rule"; >3 min loses non-follower recommendation | LSC |
| Socialinsider reach, 3 Sep 2026, **872,075 posts Jan 2025–Aug 2026** | reach/followers | IG: carousel **4.50%**, Reels **4.10%**, image 4.00%; IG overall 3.20%, **−14% YoY**. FB: image 1.20%, album 1.15%, status 0.80%, Reels 0.55%, link 0.20% | Small pages reach far higher; under 50K followers Reels still lead (5–10K: Reels 7.55% vs carousel 7.40%) | LSC |
| Socialinsider IG benchmarks, 20 Feb 2026, **35M posts, 447,613 pages, 2025** | (likes+comments)/followers | Carousel 0.55%→0.50% (Q2-26); Reels 0.52%→0.48%; image 0.37%→0.33%; overall −24% YoY. Saves (100K–1M accts): carousel 98 vs Reels 96 vs image 43 | "2026" label is 2025 data | LSC |
| Socialinsider FB benchmarks, 23 Mar 2026, **25M posts, 130,683 pages** | (reactions+comments+shares)/followers | 2025: status 0.20%, album 0.18%, Reel 0.18%, image 0.15%, link 0.05%. **Q2 2026**: Reel 0.13%, album 0.11%, image 0.10%, status 0.08% (steepest drop) | Organic only; 2026 partial | LSC |
| Metricool IG Study, 16 Jun 2026, **24.36M posts, 375,118 accounts**, Jan–Feb 2025 vs Jan–Feb 2026 | format comparison | Reels >4× interactions of single images; Reels avg watch time doubled to **8.5 s**; carousels **9× saves** vs single image, ~2× reach/views of images, views ~1.69% above Reels; Stories replies **+88% YoY** (reach −1.77%); Reels capture ~65% of views in the early window | Two-month windows; mixed brand/creator | LSC |
| Rival IQ 2025, 25 Feb 2025, 150 companies × 14 industries | ER/post/followers | IG engagement −16% YoY; carousels beat Reels in most industries; **Facebook: photos strongest** | Random brand sample | LSC |
| Metricool Social Media Study 2026 (via sotrender, Aug 2026), ~1.06M accounts | reach | Reels reach **−35% YoY**, overall −31% | Secondary citation; different window | LSC |

**Conflicts logged (do not average them away):**
1. *Reach direction* — Metricool IG (Jan–Feb windows) says up; Metricool SMS and Socialinsider say down 14–35%. Different windows/populations.
2. *Carousel vs Reels reach* — all-accounts carousel 4.50% > Reels 4.10%, but Reels lead under 50K followers. Nick's is in the small band: **Reels lead reach, carousels lead saves/ER.**
3. *Facebook best format* — status (2025 ER), images/albums (reach), photos (Rival IQ), Reels (Q2-26 ER). Converges on: albums/images for local reach, Reels for engagement, status collapsing.
4. *Reel length* — 45–60 s ER peak vs 8.5 s average watch time: both can be true. Secondary sites merge a separate "30–60 s = 5.60% reach" page into this study; do not.
5. *Rival IQ "carousels 1.87% / Reels 2.35%"* quoted by apaya.com is not in the fetched report — IC.

**What this licenses for Nick's:** not "make 60-second Reels" but "a 20-second-only grammar is unjustified" → the duration experiment in the blueprint (18–24 / 30–40 / 45–60 s, concept family held constant, 3-s skip + watch ratio + sends primary).

## C. Google / SEO (official)

| Finding | Source · date | Tag |
|---|---|---|
| "Are you writing to a particular word count because you've heard or read that Google has a preferred word count? (No, we don't.)" AI used "for the primary purpose of manipulating search rankings" violates spam policy. E-E-A-T; "trust is most important." | developers.google.com/search/docs/fundamentals/creating-helpful-content · updated 10 Dec 2025 | OG |
| Scaled content abuse: "many pages… generated for the primary purpose of manipulating search rankings and not helping users", incl. generative AI "without adding value" and stitching others' content. | …/essentials/spam-policies | OG — risk: templated per-tire-size / per-neighbourhood pages |
| Links: crawlable only as `<a href>`; anchors "descriptive, reasonably concise, and relevant"; no "click here"; "every page you care about should have a link from at least one other page"; "no magical ideal number of links." | …/crawling-indexing/links-crawlable | OG |
| AI features: no new files/markup needed ("You don't need to create… AI text files"); structured data must match visible text; high-quality images/videos help; internal links aid findability; AI Overviews traffic is inside the Web Performance report. Google disclaims llms.txt. | …/appearance/ai-features · updated 10 Dec 2025 | OG |

## D. Model landscape (1 Oct 2026)

**Artificial Analysis blind-preference leaderboards** (recruited panel + public arena votes) — LSC, general-purpose, not automotive:
- *Text-to-image (T2I v2.0):* 1 GPT Image 2.5 Sunburst (max) 1197 (n=14,023) · 2 GPT Image 2.5 Flare 1190 · 3 GPT Image 2 (high) 1172 · 4 Grok Imagine Image 2.0 1155 · 5 MAI-Image-2.6 1150 · **6 Gemini 3.1 Flash Image (Nano Banana 2) 1125** (n=18,454) · 7 Muse Image 1114 · 8 GPT Image 1.5 1107.
- *Text-to-video (T2V v2.0):* 1 Wan 3.0 1157 · 2 Utopai X (MiniMax H3) 1150 · 3 Dreamina Seedance 2.5 1143 · 4 MiniMax H3 1139 · 5 FLUX 3 1127 · 6 Seedance 2.0 1117 · 7 Gemini Omni Flash 1.1 1117.
- *Image-to-video (I2V v1.0):* 1 MiniMax H3 Max 1195±9 · 2 MiniMax H3 1181 · 3 Gemini Omni Flash 1178 · 4 Seedance 2.0 720p 1176 · 5 HiDream-O1-Video 1175 · 6 Wan 3.0 1164. **Seedance 2.5 not yet on the I2V board.**

**Pricing (OG, provider pages):**
- OpenAI GPT-Image-2.5 (released 8 Sep 2026): `gpt-image-2.5-flare` (fast) and `gpt-image-2.5-sunburst` (most capable, editing); quality tiers low→max; inpainting. Text in $5/M, image in $8/M, **image out $30/M tokens** ($15/M batch). Tokens-per-image not published → **per-image cost UNKNOWN until measured** (5 generations per tier).
- Gemini 3.1 Flash Image: **$0.045 (512px) · $0.067 (1K) · $0.101 (2K) · $0.151 (4K)** per image; batch 50% off; input $0.50/M. Gemini 3 Pro Image $0.134 (1K/2K). Gemini 2.5 Flash Image $0.039. (ai.google.dev/gemini-api/docs/pricing)
- Higgsfield API Seedance 2.5: T2V, I2V, video-edit, video-extend, **reference-to-video** (image + video + audio references; image/audio refs not billed as video input); 480p–1080p, 4–30 s; `tokens = ceil(H×W×(in_dur+gen_dur)×24/1024)` at $0.01284/1K (≤720p) or $0.01404/1K (1080p). Effective: T2V/I2V **$0.21–$1.14/s**; edit/extend/reference **$0.25–$1.36/s**. Secondary per-second tables run ~40% lower (older/16:9) — re-read the playground at purchase time.

**Current prod (from the 2026-10-01 code audit, not these pages):** static images route to `gemini-3.1-flash-image` after Higgsfield (`not_enough_credits`) and OpenRouter (402) fail; Reels: Higgsfield CLI `seedance1_5` 9:16 4 s 1080p, Veo `veo-3.1-fast-generate-preview` as alternate; critic `gemini-2.5-flash` vision, 2 calls per reel. The bakeoff in the blueprint (§L) scores *automotive* defects (rotor geometry, tread continuity, lug count), not these general arenas.

## E. Creator Intelligence Matrix

Follower counts: third-party snapshots Jul–Sep 2026 (HypeAuditor / Social Blade / CreatorDB / press). "Transfer" = what a faceless tire shop can adopt. "Do not copy" = what breaks on a faceless local account or crosses the originality line.

| Creator | Platform · followers (est.) | 3rd-party ER | Hook grammar | Structure | Visual grammar | Proof | Transfer | Do not copy | Tag |
|---|---|---|---|---|---|---|---|---|---|
| ChrisFix | YT 11.2M | 4.07% (HypeAuditor) vs 4.4% (CreatorDB) | "Here's how to [fix] in [N] steps" + money saved | problem → tools → steps → result | **Faceless POV** chest/hand cam; the task is the star | before/after on the real car; cost vs quote | Faceless-by-design at scale; POV hands + tire close-ups; "what the shop charges vs why" transparency | Promising DIY the shop sells (teach diagnosis, not replacement) | CO |
| Engineering Explained | YT 4.2M (+IG, 4.7M combined) | 4.5% (CreatorDB) | "Why does X actually happen?" | question → whiteboard → real test | diagrams, host on camera | physics, data plots | Mechanism + drawn diagram (tread, hydroplaning, TPMS); numbers on screen | Long derivations; host dependency | CO |
| The Car Care Nut | YT ~1.7M, ~3/wk | UNKNOWN | "What your dealer won't tell you about [model]" | walkaround → what fails → what to do | shop bay, lift, parts in hand | real customer cars, mileage, failed parts | **Independent-shop credibility**: honest tiering (critical / nice-to-have / skip); shop-floor B-roll | Face-led trust; brand-specialist scope | CO |
| Donut Media | YT 9.3M · IG 1.79M | UNKNOWN | punchline cold open | fast-cut explainer; **named recurring formats** | meme-pace, graphics, hosts | tests, comparisons | Named recurring formats build return viewers; fast on-screen text | Personality, meme density, budget | CO |
| Cars Explained @carexplained | IG 279K, 2,724 posts | UNKNOWN (one DB: ~0.09% likes/comments — low) | "How [part] works" | single-concept micro-explainer | cutaway/animation, faceless | animation | Direct faceless analogue for mechanism animations | Generic stock-animation look → originality risk | CO |
| @thewayeverythingworks · @carhacksai | UNKNOWN (profile 429; no index) | — | — | — | — | — | capture manually from the operator's phone | — | UNKNOWN |
| NHTSA @nhtsagov | IG ~30K; TireWise | UNKNOWN | PSA statement | fact → instruction | flat institutional graphics | federal stats (~11,000 tire-related crashes/yr, ~200 deaths — NHTSA est.) | **Cite NHTSA numbers as proof** (public domain); TireWise themes: pressure, tread, age | PSA tone; zero hook | OG (stats) |
| Cleo Abram | YT 8.1–8.6M · IG 3.23M | 4.8% (CreatorDB) | "Huge if true: [optimistic claim]" | three-column script; **visuals drive narration**; one idea per episode | one big visual metaphor per beat | expert interviews, demos | **Plan the visual beat first, then write VO** — exactly the AI-visual pipeline's constraint; optimism framing | Journalistic scope, expert access | CO |
| Zack D. Films | YT 28.5M (+600K Jul–Sep) | 4.715% (HypeAuditor) | shocking **visual** premise in frame 1 | curiosity loop: every line opens a question | hyper-real 3D cutaways, clean backgrounds, rapid VO | simulation | **Cross-section of a tire failing, bald tread in rain, nail in sidewall** — faceless, high-retention; one open loop per sentence | Body-horror tone; disaster bait | CO |
| Mercury Stardust | TikTok 2.6M · IG 1M+ | UNKNOWN | "You deserve to know how to…" | reassure → simplest tool → steps | face-led, warm | hands-on | **Anti-gatekeeping voice** for drivers intimidated by shops | Persona | CO |
| Royalty Auto Service (GA shop) | TikTok 1.1M · IG ~440K | UNKNOWN | "Customer said / we found…" | real diagnostic walk-through | real bay footage | the actual broken part; customers drive from other states (Ratchet+Wrench 26 Jun 2025) | **A local shop grew on real floor footage**; show the diagnosis, not the sale | Owner on camera | CO/IC |
| Genuine Automotive (Austin) · Clancy's Auto Body (FL) | 8.7M-view TikTok, $7K job attributed (linkinbio.news 13 Jun 2024); Clancy's 200K+, 60M views/wk | UNKNOWN | conversation-starter questions ("highest mileage you've seen?") | tiny-mic Q&A; **batch 20 ideas/day, 3×/wk** | shop floor, humour | customer stories | **Batch cadence; comment-driving question hooks** | Staff-on-camera humour | CO |
| South Main Auto · Rainman Ray's | YT ~1.0M / ~660K | UNKNOWN | "Customer states…" | full diagnostic narrative | bay cam, hands + voice | scan-tool readings | Hands-and-voice is faceless-adjacent; narrate the readout | 30–60 min runtime | CO |
| Scotty Kilmer | YT 6.67M, daily | growth 0.10%/mo | "Rev up your engines" + contrarian claim | rant → list → verdict | face, driveway | anecdote | Contrarian "never buy X" hooks test well | Anecdote-as-proof; brand bashing (liability) | CO |
| Project Farm | YT ~3.9M, 532 videos | UNKNOWN | "Which [product] is best? Let's find out." | controlled multi-product test rig | **faceless hands + jigs, numbers on screen** | measured, repeatable | **Best proof template for tires**: tread gauge, 30-day pressure drop, wet-stop distance | Buying many products; lab builds | CO |
| Veritasium | YT ~21M | UNKNOWN | "Everything you know about X is wrong" | misconception → confrontation → correction (PhD thesis: confront prior belief first) | interviews + demos | experiment | **Confront the myth first** (penny test vs 4/32 wet-grip data) | Documentary budget | CO |
| Steve Lehto | YT ~600K | UNKNOWN | "What the law actually says" | case → statute → takeaway | talking head | citations | Consumer-rights angle: warranty, road-hazard, "shop quoted me…" with citations | Legal-advice tone | CO |
| Dental Digest | YT 17.2M · TikTok 9.9M | UNKNOWN | visible-proof device (plaque disclosing tablet) | test → reveal → rating | **one repeatable visual device** | instant visible proof | **Find Nick's "disclosing tablet"**: tread gauge in the groove, chalk test, water bottle on bald tread | Gross-out; product shilling | CO |
| Humphrey Yang | TikTok 3.4M · YT 2M | UNKNOWN | "What $X actually costs" | number → comparison → decision | props, text overlays | arithmetic on screen | **Cost-math Reels** ("alignment vs the tires it saves") — numbers only from SSOT | Personality | CO |
| ThatDudeCanCook | TikTok 4.3M | UNKNOWN | aggressive "stop doing X" | mistake → fix → payoff | face, high energy | taste test | "Stop doing this to your tires" mistake-first hooks | Shouting persona | CO |
| Vancouver Carpenter | YT ~770K | UNKNOWN | "The right way to [task]" | mistake vs correct side-by-side | hands + tool close-ups | finished surface | **Side-by-side wrong/right** (over-torqued lug vs torque stick) | Trade depth | CO |
| Electrician U | UNKNOWN | UNKNOWN | "Why your [thing] does that" | code → why → demo | face + bench | meter readings | Standards as authority (DOT date code, UTQG, TPMS regs) | — | CO |
| Visual Capitalist | UNKNOWN | UNKNOWN | ranked-list title slide | one stat per slide, 7–10 slides | data-infographic carousel | sourced footers | **Carousel grammar**: slide 1 headline number, one fact per slide, last slide source + CTA | Dense charts unreadable on phone | CO |

**Cross-creator patterns (HYP, derived):** (1) Faceless successes share a *stable visual device* (POV hands, 3D cutaway, test rig, disclosing tablet). (2) Proof beats persona for trades — measured results transfer; personality formats do not. (3) Every local-shop growth case ran on *real floor footage + conversation-starter hooks*; none grew on stock/AI visuals alone. AI assets must anchor to real Euclid-bay evidence to satisfy both the originality policy (A1/A2) and the "layman trust" mechanic.

## F. Open questions / UNKNOWN

1. Meta's 75% figure: no methodology; whether AI-generated originals score as "original" is UNKNOWN — test with Trial Reels before scaling.
2. "3–5× sends vs likes": unconfirmed by Meta.
3. Trial Reels 40%/80% stats, 1,000-follower threshold, per-30-day cap: unverified.
4. Mosseri Jan-2025 statement: consistent across sources; original video URL not retrieved.
5. Socialinsider Reels-length ER formula on that page: not stated.
6. Meta Reels-ads 34.5%: n=15, no dates, no auto-services vertical.
7. @thewayeverythingworks, @carhacksai, Cars Explained TikTok, Visual Capitalist IG, Electrician U YT: no indexed data.
8. GPT-Image-2.5 per-image cost: measure before budgeting.
9. Seedance 2.5 I2V arena position: unlisted.
10. No 2025–2026 study isolates *local service businesses* on Facebook albums/status; Stories completion/sticker-rate figures circulating (55–75% / 12–18%) have no n — IC.
