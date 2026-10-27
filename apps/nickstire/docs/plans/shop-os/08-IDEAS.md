# Shop OS 08: smarter ideas (Nour: "n smarter ideas max creativity")

Job 2026-10-26-shop-os. Each idea reuses something the shop ALREADY has, names where it was stolen from (research R11,
thread e749ce76, unless noted), and says how we would know it works. Ranked by money per hour of build, best first.
None of these is approved; they feed the roadmap.

## Tier 1: we already own 80% of the parts

| # | Idea | Built from | Stolen from | Proof it works |
|---|---|---|---|---|
| 1 | **Plate-triggered arrival card.** The lot camera reads a plate, /system opens an internal card before the customer reaches the counter: last visit, open estimate, declined work, last phone call. Staff confirm the match; nothing is texted automatically. | lot vision plate reads + customers + alg_estimates + call logs | dealership service drives (LPR greeting with Xtime/CDK) | seconds from arrival to ticket open; repeat questions asked |
| 2 | **"Unserved arrival" report.** A car that pulls in, stays a few minutes and leaves with no ticket gets flagged for review (walked because of the wait? no tire in stock? price?). | lot car counter + tickets | original combination (R11) | walkaways per day, and their reasons |
| 3 | **Receptionist reads the live board.** The Vapi receptionist quotes the real wait ("tire work about 60-90 minutes right now") from the same queue the crew sees, and its call becomes a draft ticket waiting at the counter. | Vapi receptionist + /system board | Toast order throttling; vet-clinic digital intake | calls that turn into tickets; wrong wait quotes |
| 4 | **Dental-style deferred work.** Every declined line keeps its finding, photo, price and the reason (price, time, second opinion). One follow-up at a sensible time; it stops on completion, opt-out or "fixed elsewhere"; it shows up again at the next visit. | alg_estimates + declined-work texts (live) | Dental Intelligence unscheduled treatment; Xtime declined services | recovered paid gross profit, not texts sent |
| 5 | **"Approved but not started" watchdog.** Board alert: "Approved 42 minutes ago, nobody assigned or no part ordered." | board + approvals | original combination (R11) | approval-to-start minutes |

## Tier 2: new but cheap

| # | Idea | Built from | Stolen from | Proof |
|---|---|---|---|---|
| 6 | **Lane-based first come, first served.** Same arrival order, but a flat repair is not stuck behind a 3-hour diagnosis: the oldest READY job the free tech and bay can do goes next. Published so customers see it is fair. | board | Waitwhile/Qminder lanes, Valvoline express (R13, thread 6ea43a76) | waiter turnaround, walkaways. NEEDS NOUR'S RULING: it changes how FCFS is explained |
| 7 | **Waiting-room TV** with ticket numbers only (no names or phones), lane, status, estimated start range. | board | Qminder lobby display | lobby questions to the counter |
| 8 | **Real wait ranges, not guesses.** Estimate start from the actual techs, bays and jobs ahead, using our own job-time history per job type. | time clocks + board | Waitwhile; dispatch simulation (R13) | promised vs actual start |
| 9 | **"Cheaper together" bundles** only where labor really overlaps (new tires + alignment check, brakes + related part), with the real labor saving shown, technician-approved rules only. | MOTOR labor + canned jobs | Amazon frequently-bought-together, done honestly | add-on approval rate, complaints |
| 10 | **Next-visit capture at checkout** without appointments: "want a text when the rotation is due?" stored per vehicle with permission. | reminders lane (live) | salon rebooking (Phorest) adapted to walk-ins | paid return visits from the reminder group |
| 11 | **Tire wear forecast.** Two tread readings on different visits give a wear rate per vehicle: "these hit 4/32 in about 3 months". Becomes a pointer and a reminder. | tech tread entries | Discount Tire standardized inspection | tire sales from forecasts |
| 12 | **Supplier lateness score.** Every part order logs promised vs actual arrival; the parts drawer ranks stores by their real record. | parts drawer | original | late parts per week |

## Tier 3: later, after the base works

| # | Idea | Note |
|---|---|---|
| 13 | Camera VIN, plate and tire DOT scanning on the tech phone (Anyline web SDK, quote only) | prove manual entry first (R14, thread 698aff51) |
| 14 | Caller-ID screen pop: shop line forwarded through Twilio so the customer card opens when the phone rings | needs a forwarding test on the Spectrum line (R10) |
| 15 | Capacity-aware recovery: when tomorrow's alignment rack is light, staff approve a small batch of follow-ups to customers with a recorded alignment need | depends on 4 and 8 |
| 16 | Shop "kitchen display": a wall screen of blockers only (approval unanswered, part late, ready car not texted) | Toast KDS; same data as the board |
| 17 | Voice notes from techs turned into the finding text, reviewed before it goes to the customer | AutoLeap Magic Notes pattern; noise test first |

## From the outside review (11-REVIEW, 2026-10-27): ideas we had not listed

| # | Idea | Mechanism | Measure |
|---|---|---|---|
| 18 | Quote-to-sale tracking | every quote kept with total, stock, offered financing, bought or not, and why not | conversion and lost reasons by price band |
| 19 | Finance-to-cash queue | per program: approved, sale done, submitted, funded, fees, reversals; "approved" never means "paid" | unfunded completed sales, days to funding |
| 20 | Core and supplier-credit ledger | each return tied to its purchase, proof of return, expected and received credit | credit dollars outstanding and recovered |
| 21 | Pre-job readiness check | before a car takes a bay: approval, right part on the shelf, hardware, tools | bay minutes lost to "not ready" |
| 22 | Vehicle custody and key log | key tag, parking spot, existing damage, wheel-lock key, release status | key-search minutes, damage disputes |
| 23 | Release check | short job-specific final check with the name of who did it before keys go back | problems caught before release |
| 24 | Comeback ledger | a return visit linked to the original job with cause and cost; original invoice untouched | comeback rate and cost |
| 25 | Tech interruption shield | status questions go to the counter lead; short protected work blocks | interruptions per job |
| 26 | Canned-job margin guardrails | each package lists labor, consumables, disposal, TPMS parts and cost; flag silent giveaways | margin per job family |
| 27 | Small fast-moving shelf | stock only the few parts that repeatedly cause a supplier run | supplier runs per week |
| 28 | 10-minute daily close | invoices vs Maverick batch, cash, refunds, financing funded | minutes to close, unexplained differences |

## From the deep research round (2026-10-27, money and owner-time first)

| # | Idea | Why it pays | Measure |
|---|---|---|---|
| 29 | Standard paid diagnostic policy | stops giving skilled tech time away for free | diagnostic $/month, unpaid diag minutes, diag -> repair conversion |
| 30 | Gross profit per constrained hour, by job family, tech and bay | a 45% margin job that eats 4 hours can be worse than a 35% job done in 30 minutes | GP per tech hour, per bay hour, effective labor rate |
| 31 | Tech-to-counter blocker button: NEED PART / NEED APPROVAL / NEED INFO / READY QC | the tech taps and keeps working instead of walking up, yelling or texting | interruptions per day, blocked minutes per RO |
| 32 | Demand-based staffing from camera and phone data | plate arrivals + calls + tickets by 15-30 minute slot put lunches and breaks into the quiet troughs | unserved arrivals, queue time, owner counter coverage |
| 33 | Missed-demand tire purchasing list | stock the 10-20 sizes and price points that would have closed the most lost same-day sales | same-day tire fill rate, lost tire sales from no stock |
| 34 | Final-payment item check | compare work done and parts used against invoice lines before checkout | omissions caught, added gross profit |
| 35 | Before-purchase fitment check | a short check of vehicle, part or tire attributes and return rules before ordering or mounting | wrong-part rate, remounts |
| 36 | Owner-intervention log and target | every "need Nour" moment logged with the reason; goal under 2 avoidable a day | interventions per day, owner minutes after closing |

## Ideas we will NOT build (and why)
- Auto-texting a customer because the camera saw their plate: plate is not identity; creepy; consent.
- AI that writes labor hours, torque or maintenance intervals: licensed data only (R8).
- Review flywheel: rejected by Nour (USER.md settled list).
- A second card processor just to have "integrated payments": the register stays (shop data rules).
