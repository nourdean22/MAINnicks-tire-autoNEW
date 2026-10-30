# Know Nour, the shop and the money (job start)

Nour, 2026-10-30, asking for v4: "make smarter more detailed so i have to do less and it will make my life easier know more about
us me our stuff and continue making us more money". A fresh manager session has no agent memory loaded for the area and no
history; these files are the shortest path to the context he expects without re-explaining it. Read them; never copy changing
facts (prices, hours, counts) out of them into a brief or a doc: point to the file instead.

## The files, in order

| File | What it gives the manager | Where it bites |
|---|---|---|
| `.agents/core/USER.md` | who Nour is, how he reads (phone, mid-task), the four protected classes, the shop data meanings, settled decisions | every relay (step 8), every question you are about to ask, every brief that reads shop data |
| `.agents/core/SOUL.md` | the voice: answer first, plain words, calm, no hype | every reply and report |
| `apps/nickstire/docs/SHOP-SOUL.md` | how the shop operates and what the site may promise | any customer-facing copy, offer or claim a session writes |
| `apps/nickstire/shared/business.ts` | the shop's facts as code (`BUSINESS`: hours, walk-in model, prices, warranty, financing, languages, reviews) | any claim about hours, prices, walk-ins or warranty |
| `docs/agent-os/NOUR-RUNTIME-KERNEL.md` | the money list for Nick's Tire and the outcome list for StateNour | the money frame below; ranking work |
| memory `MEMORY.md` plus the area's RESUME HERE file | open jobs, owed reads, Nour's recent rulings, the parked register | step 1 Recover state |

Shop data meanings (USER.md is the source; rule `brief-shop-data` refuses a shop-data brief without them): a ShopDriver counter
invoice is a closed job, a sale, and its payment status means nothing; an estimate with no matching invoice most likely means the
customer walked (declined work) and stays an inference; follow-ups key to invoices, not bookings. Monthly ticket counts and sales
dollars never go into repo docs: the repo is PUBLIC (they go to agent memory only).

## The money frame (one line per job, in the spec and the PR body)

```
Money frame: <the job> moves <one or two items from the kernel list> through <the mechanism>; the read that shows it: <source>, due <date>.
```

Nick's Tire items (kernel): profitable cars, calls, bookings, tire and repair sales, recovered declined work, repeat customers,
satisfaction and reviews, local visibility, throughput, staff effectiveness, cash collection, marketing ROI, owner visibility.
StateNour items (kernel): task completion, accuracy, memory and retrieval quality, autonomous execution, lower owner cognitive load,
time returned to Nour. Platform and agent-setup jobs count in hours returned to Nour (fewer questions, fewer taps, fewer re-explains).

Examples of the shape (no figures; the numbers live in memory or production reads):
- "Money frame: the estimate follow-up fix moves recovered declined work through texts keyed to estimates with no invoice; the
  read: the follow-up rows and their replies in production (a SELECT-only read), due two weeks after deploy."
- "Money frame: manager skill v4 moves hours back to Nour through fewer questions and finished-and-archived sessions; the read:
  his taps per job and the number of sessions he had to ask about, next manager job."

If no item fits, say so in the line: a job that moves nothing on the list is a candidate to cut or park, and that is a Ruling.

## How Nour reads (USER.md, SOUL.md, the i-have-adhd skill)

1. On an iPhone, mid-task, often while something is broken: lead with what finished or what he must do, one line each.
2. "go", "yes", "do it", "merge it" are orders; ALL CAPS is emphasis; typos are speed.
3. Ask only for spend, customer-facing sends, production writes and credentials. Everything else inside his order is done, then
   reported (memory `feedback-stop-asking-one-little-step.md`, `feedback-decide-simple-calls.md`).
4. Report what finished in plain words, one line per piece, no process talk (memory `feedback-finish-archive-report-simply.md`).
5. A newer explicit correction from him beats every file here; fix the file in the same PR.
