# Shop OS 14: stolen mechanisms, screen by screen

Job 2026-10-30-shop-os-stolen-mechanisms. PLANNING, nothing built. The table Nour's screenshots slot into (his words,
2026-10-30: "steal like n artist ... put alot of it togather"). Ruling (Nour, 2026-10-30): "alg is kind of like the
protype set up i want because its fast n simple but smart too", so row 1 of every screen is ALG / ShopDriver Elite
(baseline: keep) and every other row says what it adds or loses against it. Last row is "ours": shop data ALG cannot
show ("be fully aggressive in incorperating our stuff").

Rules: public pages only, all read 2026-10-30 (no login, trial, form or order). Mechanisms, not code; nothing copied.
AIP = already in plan (01-DESIGN, 08-IDEAS); those rows extend it. Build hours are INFERENCE. In the buy branch
(05-ROADMAP days 8-12) each adopted row is also a bake-off check: does the finalist do this?

Columns: Who | Mechanism (data flow, trick, failure avoided) | vs ALG | Call, cost, kill | Benchmarked against

## 1. Search and open ticket

| Who | Mechanism | vs ALG | Call, cost, kill | Benchmarked against |
|---|---|---|---|---|
| ALG | One account: every user's saved tickets and customer history land in one shared record; one device per login | baseline: keep | keep; screen-level mechanism not public, screenshots pending | ALG FAQ (autolaborexperts.com/faq) 2026-10-30 |
| Shopmonkey | One box on every page (Cmd K): name, phone, email, plate, VIN, order no., and page names; plate/VIN match on a 3-char prefix; filter tabs; arrows + Enter. Create keys: Cmd Shift E estimate, Cmd Shift C customer | adds search from anywhere and page jump | ADOPT (AIP s4 Ctrl+K); new: 3-char plate/VIN prefix, pages in results; ~4 h; kill if crew search-to-open is slower than ALG | Shopmonkey (support.shopmonkey.io/hc/en-us/articles/38743836463892, .../40875473817492) 2026-10-30 |
| Mitchell 1 SE | Per-screen function-key map (one key per counter action) | adds one-key actions | ADAPT to Alt letters (AIP s4); key list is a PDF I could not read; 0 h extra | Mitchell 1 KB (kb.mitchell1.com/articles/id-239/) 2026-10-30 |
| ours | Ringing call (receptionist line) and lot plate read pre-fill the box and open the card before anyone types | ALG cannot | ADOPT (AIP 08 #1, #14); staff confirm the match; kill if wrong-customer opens >1/week | repo `server/services/aiReceptionist.ts`, `lotBriefRead.ts` 2026-10-30 |

## 2. Quick tire quote

| Who | Mechanism | vs ALG | Call, cost, kill | Benchmarked against |
|---|---|---|---|---|
| ALG | Labor guide gives High / Average / Low time per job; no supplier link ("we do not connect to any parts suppliers") | baseline: keep the H/A/L range | keep range; loses live tire price and stock | ALG FAQ (autolaborexperts.com/faq) 2026-10-30 |
| Tekmetric | One-time Smart Canned Job: labor flat or per tire, parts with a Per Tire box (1 stem becomes 4), fees with method Tires ($5 disposal becomes $20). Quantity is set FIRST and drives every price. Tabs: Inventory / Vendors (PartsTech) / Other Shops. Out-the-door price on pick; markup on cost; cost and tire spec locked, retail editable; below-OE load/speed warns, never blocks; 3 options side by side, toggling Selected moves the job total live; customer screen hides cost | adds live price, fees that cannot be forgotten, screen flip | ADOPT per-tire multipliers, qty-first, locked spec, 3-option toggle (AIP s4 Quick Quote; new: the multipliers). Closed beta, Tire Suite add-on; ~2 days; kill if the crew's timed walk-in quote is slower than ALG plus a phone call | Tekmetric (support.tekmetric.com/hc/en-us/articles/41576721439255) 2026-10-30 |
| PartsTech | Tire comparison sheet (cost, specs, rebates) sent by text or email; customer picks by replying; preferred brands sort first | adds a quote that travels | ADAPT: send from our quote, reply lands in the inbox; ~1 day; kill if fewer than 1 in 10 sent quotes get a reply | PartsTech (partstech.com/software/) 2026-10-30 |
| ours | Website tire-size searches and online orders show which sizes people want; D&K live price and stock already wired | ALG cannot | ADOPT as the quote's default source and the missed-demand list (AIP 08 #33); 0 h to reuse | repo `server/services/gatewayClient.ts` 2026-10-30 |

## 3. Estimate with approval (at the counter or by phone)

| Who | Mechanism | vs ALG | Call, cost, kill | Benchmarked against |
|---|---|---|---|---|
| ALG | A part typed once is "remembered" for next time; tax-exempt box on the ticket; estimates and tickets are separate screens | baseline: keep part memory | keep; screenshots pending for the estimate-to-ticket step | ALG FAQ (autolaborexperts.com/faq) 2026-10-30 |
| Tekmetric | Status is derived from events, never typed: Requires authorization -> Pending (sent by text, email or link) -> Declined; approval moves the RO from Estimates to Work-in-progress. Quick Action "Approve all" records a phone yes without opening the estimate | adds state nobody has to remember | ADOPT; the quick action must still write who/when/how/total (07-COMPLIANCE); ~1 day; kill on any approval without that receipt | Tekmetric (support.tekmetric.com/hc/en-us/articles/360039292193) 2026-10-30 |
| ours | Every past decline with its reason (decline captures, alg_estimates) and Ask-assistant pointers sit beside the estimate | ALG cannot | ADOPT (AIP s7); kill if pointers are dismissed >80% after 4 weeks | repo `server/services/declineCaptures.ts` 2026-10-30 |

## 4. Job board and queue

| Who | Mechanism | vs ALG | Call, cost, kill | Benchmarked against |
|---|---|---|---|---|
| ALG | No board on the public pages | baseline: keep simple | screenshots pending; if ALG has none, ours must stay one screen | ALG product page (autolaborexperts.com/ShopDriverElite) 2026-10-30 |
| Tekmetric | Two layers: fixed system statuses per column, moved by events; plus shop labels per column (max 20, 22 chars) that reset to the column default when the RO moves; payment status overlays the card | adds who-is-waiting-on-what | ADOPT the split (machine state vs human label) for the express board (05 brain #1); ~2 days; kill if a paper or whiteboard list is still kept after 2 weeks | Tekmetric (support.tekmetric.com/hc/en-us/articles/360039292193) 2026-10-30 |
| Toast KDS | Clock from send (ticket time) and from fire (fire time); held items show HELD in italics; tickets change color as they age; changes flash until someone touches them | adds aging you can see across the room | ADAPT: one age clock per blocker ("waiting approval 12 min"), flash on change (AIP 08 #16); ~4 h; kill if nobody looks at the wall screen in week 2 | Toast (doc.toasttab.com/doc/platformguide/adminInterpretingTicketTimes.html, .../adminKdsConfigQuickRef.html) 2026-10-30 |
| Waitwhile | Wait = staff available x summed service durations x serve capacity, or a model trained on past visits; re-estimates every time the line changes | adds an honest wait | ADAPT for the receptionist's wait quote and the lobby TV (AIP 08 #3, #8); ~1 day; kill if quoted vs actual start misses by >30 min on half the cars | Waitwhile (help.waitwhile.com/en/articles/6762645-how-wait-time-is-estimated) 2026-10-30 |
| ours | Lot camera gives true arrival order (first come, first served) and "pulled in, left, no ticket"; receptionist calls become draft cards | ALG cannot | ADOPT (AIP 08 #1, #2, #3); kill if plate-to-ticket match is wrong >1 in 20 | repo `server/services/lotBriefRead.ts` 2026-10-30 |
