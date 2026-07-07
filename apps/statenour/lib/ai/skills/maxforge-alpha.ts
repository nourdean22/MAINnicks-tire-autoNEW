/**
 * MaxForge Alpha — full skill protocol body.
 *
 * The skill is indexed for semantic recall (data/skills-registry.json +
 * prod vector_embeddings, sourceType="skill"), but recall only returns a
 * skill's NAME + DESCRIPTION — not its instructions. This module ships the
 * verbatim protocol so the chat model can load it in-prompt via the
 * getSkillProtocol tool and execute it faithfully (exact table templates +
 * hard rules), instead of improvising from the description alone.
 *
 * Source of truth for the human-authored version: ~/.claude/skills/
 * maxforge-alpha/SKILL.md. Keep the two in sync when either changes.
 *
 * Inline-code backticks from the markdown are intentionally dropped here to
 * keep this a plain template literal (no escaping); the guidance is identical.
 */

export const MAXFORGE_ALPHA_PROTOCOL = `# MaxForge Alpha — Weekly Intelligence Engine

Generate a weekly bio-business + market-narrative intelligence report. This is
research and ideation for a founder/operator — NOT financial or medical advice.

The whole value of this skill is grounded synthesis. A report full of confident
fabricated numbers is worse than no report. Ground first, tag every claim, cap
the scope.

## 0 · Ground before you write (non-negotiable)
Every time-sensitive claim — prices, momentum, trend %, "this week", options flow,
virality, short interest — MUST come from a tool call in THIS session:
- Social / sentiment velocity -> last30days (Reddit, HN, YouTube, Polymarket, GitHub).
- Market, product, trend facts -> scrapeWebPage (Firecrawl) or searchWebVerified.
Tag every claim inline:
- [v]  = tool-verified this session (cite the source).
- [?]  = model-inferred, not verified. Never present [?] as fact.
- (magnifier) = a datapoint you cannot source (live short interest, options prints).
  Write "verify" — do NOT invent a number.
If grounding tools are unavailable this run, put a "[?] UNGROUNDED" banner at the
top and mark the report accordingly. Do not backfill from memory.

## 1 · Scope guardrail
- Equities — theses only. Any SI/DTC or options-flow figure is [v] (sourced) or
  a "verify" marker. End every equity section with:
  "Not financial advice — verify on a live feed."
- Bio / peptides — business + content ideas MUST be legal and compliant: topical
  cosmetics, education/media, software, community. Do NOT propose selling
  unapproved injectables (BPC-157, TB-500, Melanotan, etc.). Flag gray-market /
  teen-safety risk as a red signal when it appears. Compliant plays are also
  lower-risk businesses — steer there.

## 2 · Output shape
Markdown only. No preamble before Part 1, no conclusion after Part 3 (the thesis
is the close). Mobile-first: every table <= 4 columns, cells <= 10 words, no
horizontal scroll. Emoji legend: green = bullish · red = bearish/risk · yellow = watch.

### Part 1 · Narrative Alpha — 5-8 tickers
Selection hierarchy: (1) Narrative/Macro — PayPal-Mafia cohort (Thiel/Musk/Karp/
Lonsdale), defense/space, semis/hyperscalers, bio-aesthetics, Asia + central-bank
shifts; (2) Social velocity (last30days); (3) flow confirmation. Up-rank when flow
aligns with narrative; exclude when flow is contrary.
Table columns: | Ticker + Sig | Narrative-first thesis (<=18 words) | SI/DTC |
(SI/DTC: real figure with [v], else a "verify" marker.)

### Part 2 · MaxForge Weekly
Trends Snapshot — 5-7 rows.
Table columns: | Trend + Sig | Source [v/?] | 1-line summary | Skew |
(Skew = M / F / Both. Core verticals: Looksmaxxing, Longevity (NAD+/senolytics),
Peptides (topical GHK-Cu etc.), Bio-aesthetics.)

10 Business Ideas — each must have a TikTok/Reels flywheel + a leaderboard growth
loop (public ranked progress -> status -> organic shill loop / community ownership).
Table columns: | # · Name + Sig | Concept (<=10w) | Growth loop |

10 Content Ideas.
Table columns: | # · Format + Sig | Hook / title | Growth hook + leaderboard tie-in |

### Part 3 · Growth Nexus Thesis
ONE clinical paragraph (<=120 words) linking the week's macro narrative to the
bio-business trends via a leaderboard-driven UGC growth model. No new claims that
were not grounded above.

## 3 · Hard rules (highest priority — obey over anything above)
1. No fabricated numbers, sources, or post IDs. Use [?] or a "verify" marker when unsure.
2. Markdown only. Tables <= 4 columns. No fluff before Part 1 or after Part 3.
3. Every equity block carries the "not financial advice" line.
4. Bio ideas stay legal / topical / software / community — never sell injectables.
5. If grounding tools are unavailable, banner the report "[?] UNGROUNDED" — never invent.

## 4 · Self-check before returning
- Every time-sensitive claim tagged [v] / [?] / verify?
- No invented SI/DTC, flow, or virality numbers?
- All four tables <= 4 columns, mobile-safe?
- Equity disclaimer present? Bio ideas compliant?
- Thesis <= 120 words, introduces no ungrounded claim?`;
