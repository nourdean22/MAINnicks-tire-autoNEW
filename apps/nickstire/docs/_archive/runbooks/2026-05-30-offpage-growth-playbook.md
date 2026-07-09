# Off-Page Growth Playbook — Nick's Tire & Auto (2026-05-30)

**Why this exists:** the site's on-page SEO is mature (full schema, tuned titles, AEO blocks, deep internal linking, prerender coverage being restored). For a **<60-day-old domain with near-zero authority, on-page is no longer the lever** — off-page is. Per the AI-citation research mined this session: **brand mentions correlate ~3× stronger with AI citations than backlinks**, and for *local* search, **Google Business Profile + reviews + citations** outweigh almost everything on-site. These are the actions that actually move traffic now. None require code; all require an operator (you) or shop staff.

Canonical NAP (use byte-identical everywhere):
> **Nick's Tire & Auto** · 17625 Euclid Ave, Cleveland, OH 44112 · **(216) 862-0005** · Mon–Sat 8a–6p, Sun 9a–4p

---

## TIER 1 — Do this week (highest ROI, lowest effort)

### 1. Google Business Profile — the #1 local asset
GBP outranks the website for local-pack + Maps, and it's a top AI-citation source for "near me" queries. Make it complete + active:
- [ ] **Primary category:** `Auto Repair Shop`. **Add secondary categories:** `Tire Shop`, `Brake Shop`, `Oil Change Service`, `Wheel Alignment Service`, `Auto Tune Up Service`, `Used Tire Shop`, `Smog Inspection Station` (E-Check). Secondary categories are a known, under-used ranking lever.
- [ ] **Services:** list every service **with a 1-line description + price** (mirror the site: brakes from $149/axle, used tires from $40, oil from $39, etc.).
- [ ] **Seed the Q&A section yourself** — post the top 10 FAQs (from the site's FAQ schema) as questions *and* answer them from the business account. Owner-seeded Q&A is non-obvious and high-signal.
- [ ] **Photos:** exterior/sign, interior, bays in action, the team (humanizes — strong trust signal), logo. Add a few **weekly** — Google reads photo recency as an "active profile" signal.
- [ ] **GBP Posts:** post weekly (a tip, a seasonal offer, "open Sunday 9–4", a recent job). Keeps the profile active + surfaces in Maps.
- [ ] **Respond to EVERY review**, especially negative ones — owner responses are a trust + freshness signal.

### 2. Review velocity — the top local-pack signal you can manufacture
Review **count + recency** is the single biggest thing offsetting a young domain in the local pack, and AI assistants cite review sentiment.
- [ ] Use the existing **SMS infra (F25e gateway)** to send a post-service review ask. Target a **steady 5–10/week** (steady beats a burst — bursts look manipulated).
- [ ] **SMS template (TCPA-safe, opt-out aware):**
  > "Thanks for trusting Nick's Tire & Auto today! If we did right by you, a 30-sec Google review means the world to a local shop: [SHORT_GOOGLE_REVIEW_LINK]. Reply STOP to opt out."
- [ ] Generate the **Google review short-link** (Business Profile → Ask for reviews → copy link, or `g.page/r/...`). Bake it into the SMS template above.
- [ ] Train staff to mention it verbally at pickup ("we'd love a quick Google review") — verbal + SMS double-touch lifts conversion.

### 3. Bing + AI-crawler indexing (currently MISSING — only Google is wired)
The site has Google Search Console but **nothing for Bing/Copilot/Claude.** Quick wins:
- [ ] **Bing Webmaster Tools** — add + verify nickstire.org (you can import directly from Google Search Console in one click). This feeds **Copilot** and **ChatGPT** (Bing-indexed).
- [ ] **Enable IndexNow** (Bing Webmaster → IndexNow) — instant index submission, big for a new/changing site.
- [ ] **Verify presence in Brave Search** (search.brave.com for "tire shop euclid ohio" + "nicks tire auto") — Brave is **Claude's** search backend. If absent, Bing/IndexNow above usually fixes it.

---

## TIER 2 — Do this month (compounding)

### 4. NAP citations — claim + make byte-identical
Citation consistency is a direct local ranking factor; mismatched NAP on a new site actively suppresses it. Claim/verify the canonical NAP (above) on:
- [ ] **Apple Maps** (Apple Business Connect) — iPhone users + Siri.
- [ ] **Bing Places** (if not auto-created with #3).
- [ ] **Yelp** — claim + complete (don't pay; just claim).
- [ ] **Facebook Business Page** — NAP + hours must match.
- [ ] **Auto-industry directories:** RepairPal, Mechanic Advisor, NAPA AutoCare / AAA Approved (if eligible), CarTalk Mechanics Files, Nextdoor (local neighbor recommendations are gold for a shop).
- [ ] Confirm the site's `LocalBusinessSchema` NAP matches GBP **exactly** (it's driven from `shared/business.ts` — already consistent; just confirm GBP equals it).

### 5. Reddit / community presence — strongest AI-citation influencer
The AI-visibility research flagged **Reddit/community mentions as among the strongest influences on what AI assistants recommend**, and they need zero domain authority.
- [ ] Genuinely participate (real account, real help — NOT spam) in **r/Cleveland**, r/ClevelandMechanics-type threads, and local Euclid/East-side Facebook groups when someone asks "good honest mechanic near Euclid?" Earn **organic mentions** of Nick's (open Sundays, written estimate, used tires).
- [ ] Same for Nextdoor neighborhood recommendations.

---

## TIER 3 — Higher effort, durable (earns the backlinks a young domain lacks)

### 6. Publish ONE linkable original-data asset
A piece of **original local data** is the kind of asset that earns backlinks + gets cited by AI — almost no local shop has one.
- [ ] From real ticket data, publish **"Average Auto Repair & Tire Prices in Cleveland / Euclid, 2026"** (brakes, oil, tires, alignment, E-Check) with the NAP + ASE creds in the footer. Pitch it to local news / Reddit / community groups. (This is on-site content but its value is the *off-site* links/citations it earns.)

### 7. E-E-A-T trust signals the shop genuinely has
For a new domain, Google leans on trust proxies to decide whether to rank you at all.
- [ ] Get a **named, ASE-certified tech bio** (name + cert) onto the About/Team page and as a blog `author` (then we can wire `Person`/author schema — *needs you to provide a real name + cert #; we won't fabricate credentials*).

---

## What's already handled on-site (so you don't double-spend effort here)
Schema suite (LocalBusiness/FAQPage/Breadcrumb/Service/OfferCatalog/AggregateRating), CTR-tuned titles + descriptions, AEO answer-blocks, deep internal linking, dynamic sitemap+robots, `llms.txt`/`ai.txt`, 120 blog articles, prerender coverage (being restored 2026-05-30). The on-site machine is built — **these off-page actions are what feed it traffic.**

## Priority order
**① GBP completeness + secondary categories + seed Q&A** → **② review-velocity SMS** → **③ Bing Webmaster + IndexNow** → **④ NAP citations** → **⑤ Reddit/Nextdoor** → **⑥ original-data asset** → **⑦ ASE-tech E-E-A-T**.

Tiers 1 are the 80/20 — GBP + reviews + Bing indexing will move the needle faster than any further on-site work for the next 60–90 days.
