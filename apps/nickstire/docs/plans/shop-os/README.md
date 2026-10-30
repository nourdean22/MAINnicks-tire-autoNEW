# Nick's Shop OS: plan folder (nickstire.org/system)

Job 2026-10-26-shop-os. Status: PLANNING, nothing built. Nour asked (2026-10-26) for his own shop system to replace
ALG/ShopDriver Elite, with parts vendors, an AI copilot and everything done from the estimate and invoice screens, at
nickstire.org/system. He approved approach A on 2026-10-26, then paused. ChatGPT and Perplexity each scored the v1
plan 4/10 on 2026-10-27; after a deep-research round (v2: 6.5/10 and 7/10) and Nour's "more money, easier life" steer,
the roadmap is v3: find the money leaks, take the free money (PartsTech free plan, pricing, tire packages, finance
funnel), bake off the real tiers, then "buy the ledger, build the brain" unless the evidence says build. Mockup (sample data):
https://claude.ai/artifact/TWqsphTCiJFqigPcxxd1f5 (private until Nour shares it).

To pick it back up: read 11-REVIEW (round 2 first), then 05-ROADMAP v3 days 1-7, then 06-OPEN-QUESTIONS.

## Read in this order

| File | What it answers |
|---|---|
| [11-REVIEW](11-REVIEW.md) | what ChatGPT and Perplexity said (both 4/10), what we changed, where we disagree |
| [06-OPEN-QUESTIONS](06-OPEN-QUESTIONS.md) | the decisions waiting on Nour, the unknowns, and the vendor email to send |
| [01-DESIGN](01-DESIGN.md) | what we build, the three options and what each costs, the counter screen, parts, copilot |
| [10-UI-BUILD](10-UI-BUILD.md) | the /system screens, look and feel, how it plugs into the existing app |
| [05-ROADMAP](05-ROADMAP.md) | v3: money leaks (days 1-3), free money (4-7), bake-off (8-12), decision (13-14), configure, break it, gates, then build the brain |
| [08-IDEAS](08-IDEAS.md) | 17 ranked ideas that reuse what the shop already has (lot camera, receptionist, texts) |
| [03-VENDORS](03-VENDORS.md) | every parts, tire, labor, payment and phone vendor and how each plugs in |
| [04-DATA-MAP](04-DATA-MAP.md) | production numbers today and how ALG's data moves over |
| [07-COMPLIANCE](07-COMPLIANCE.md) | Ohio estimate, invoice, tax, tire and used-tire rules as screen behaviour |
| [09-ACCESS-AND-SECURITY](09-ACCESS-AND-SECURITY.md) | crew logins and roles, MFA, audit log, FTC and Ohio data duties |
| [02-RESEARCH](02-RESEARCH.md) | the 16 research runs with sources and labels |
| [13-TOOLKIT](13-TOOLKIT.md) | every account, key name, API, MCP, plugin, skill and device the build needs: have, missing, Nour's call |
| [17-ALG-LEDGER-STUDY](17-ALG-LEDGER-STUDY.md) | every mirrored ALG ticket and estimate: how, why, what, who, when; ten execution rules; five blind spots (figures private) |

## Five facts that shape everything
1. The shop closes a few mid-to-large tickets a day (production read; exact figures stay out of this public repo).
2. The repair-order, inventory, tech and inspection tables already in the code are EMPTY in production: there is a
   skeleton, not a system.
3. One parts aggregator (PartsTech) covers all five parts suppliers the shop uses and also carries MOTOR labor times;
   O'Reilly also offers a direct API to single shops.
4. Ohio's repair rule (OAC 109:4-3-13) dictates the estimate and invoice screens: estimate choice, the 10% approval
   line, tech name on labor, replaced parts offered back.
5. Sending customers to finance programs may make the shop an FTC "financial institution": staff get their own logins
   with the app's own MFA and an audit trail from day one (09-ACCESS lists the P0 tasks that make crew logins possible).

## Labels used everywhere
FACT = read this session from code, production or the primary page. CLAIM = a research report cites a source we did not
open. INFERENCE = reasoning. UNKNOWN = not known yet; never treated as zero.
