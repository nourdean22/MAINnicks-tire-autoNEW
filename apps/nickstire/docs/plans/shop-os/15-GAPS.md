# Shop OS 15: gaps (what the plan, the research and Nour's asks have not covered)

Job 2026-10-30-shop-os-gaps. Built 2026-10-30 from files 01-11, sibling docs 12 (local AI), 13 (toolkit), 14 (mechanisms,
in progress), SHOP-SOUL, truth_os and agent memory. Every row was grepped against this folder and 08-IDEAS first; a
gap 08 already lists is marked "listed, not scheduled", not new. Angles: a = Nour's words, b = the shop's day, c = data,
d = integrations, e = operations, f = research never run. Owners: Nour, a session, the manager, a vendor.

## a. Nour's words vs what the plan writes down

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| a1 | Google ruling contradicts the plan: Nour wants Drive and Sheets on the shop account with his CEO account viewing; 01 section 9 and 09 section 3 forbid copying customer data to Sheets from /system | each session follows one rule and breaks the other; customer rows in Sheets widen the leak surface | 01-DESIGN.md:131-133, 09:62-64; `server/sheets-sync.ts` already writes a CRM sheet; doc 13 section 2b covers only the folder share | Nour | one ruling: reports and exports to Sheets yes, customer rows yes or no |
| a2 | "dont worry about safeguards" is not written into the plan: README fact 5, 06 row 6 and 09 section 3 still treat the FTC rule as a gate | sessions keep building to a rule Nour retired | README.md:37-38, 06:17, 09:53-58 (read 2026-10-30) | manager | mark those rows "good practice, not a gate (Nour 2026-10-30)" |
| a3 | "alg is the protype" vs roadmap v3, which defaults to buying a core and spends days 8-12 on a crew bake-off | the bake-off costs about 5 crew days for a choice Nour may have already made | 05-ROADMAP.md:30-47; memory shop-os-planning-manager-2026-10-30 ruling 2 | Nour | answer now: is the bake-off still on, or is ALG the baseline to rebuild |
| a4 | "everything interconnext my apps, comps, websites": no plan file names StateNour / NOUR OS or the bridge that already exists | the owner dashboard and alerts get built twice, in two apps | grep `statenour|bdnick|NOUR OS` in this folder: 0 files; `server/_core/statenour-bridge-routes.ts`, `cron/jobs/statenourSync.ts`; SHOP-SOUL section 9 split | session (doc 16 is closest) | one map: which /system events cross the bridge, which stay |
| a5 | "the alg scrape should be happening every day": it does (3 AM, 8 PM, admin page loads at most 1 per 30 min, chat), and every probe logs the counter out of ALG; the plan counts only the per-ticket pull as a login risk | in a parallel run each admin refresh can kick the counter mid-ticket; nobody counts those logouts | truth_os.md:133-137, `server/services/algProbeBudget.ts:15-16`; plan names only 01:38-40, 04:58 | server lane | count probes per shop hour in `alg_probe_log` before the parallel run starts |
| a6 | "how many ompleyees ... edit whenever": doc 13 has the Settings DECIDE row, but 10-UI-BUILD's screen list has no Settings route | the screen is decided but never scheduled | 10-UI-BUILD.md:24-32 (7 routes, none for settings) | session | add /system/settings to the screen list after Nour's yes |

## b. The shop's day, open to close

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| b1 | No opening routine: sign-in on the counter PC, cars left overnight, open ROs, parts due today, drawer start | only the close exists (08 #28); the first hour runs on memory | grep `opening|open the shop|morning`: 0 relevant hits | session | 5-line opening card spec in 01 section 5 |
| b2 | Status texts during the job (approved, started, ready) and where a customer's reply lands | "how's my car" calls interrupt the counter; a reply nobody sees is a lost approval | 08 #16 lists "ready car not texted" as a blocker only; grep `inbound|reply`: 0 relevant hits; SMS lane is live (SHOP-SOUL section 9) | session | map inbound shop texts onto the ticket card |
| b3 | The tire fast lane: the manager quotes at the car window and techs work outside, about 20 minutes; the plan's quick quote is a keyboard counter screen | the most common sale happens on a phone outside, not at the desk | SHOP-SOUL.md:82-86 and open question 5; 10-UI-BUILD.md:26 | Nour (q5), then session | time a window quote on a phone in the bake-off scripts |
| b4 | The site's discount programs (students, seniors, school and health staff, rideshare drivers, performers; each needs proof) and 20% off labor up to $250 have no counter line or proof field | a discount given without proof, or promised online and missed at checkout | `shared/business.ts:293-370`, PR 3352; grep `teacher|nurse`: 0 | session | discount line type with a proof field in 01 section 4 |
| b5 | The free checks (brake, battery, E-Check readiness, alignment pull, 27-point) have no recorded template | a check with no record gives no finding to quote or follow up | SHOP-SOUL.md:68-71 (Nour 2026-10-30); grep `27-point|brake check|E-Check`: 0 | Nour, then session | photograph the paper 27-point sheet; it becomes the template |
| b6 | No plan for the first-snow tire rush (board, stock, staffing); the weather text lane is already live | the busiest money days of the year | grep `season|winter|snow|weather`: 0; USER.md "Weather SMS stays on" | manager (query f2) | run f2, then a surge section in 05 |
| b7 | A paid online tire order (payment tracked) has no handoff into an RO when the customer arrives | double charge or a lost order at the counter | 01-DESIGN.md:28 names online orders as an asset only; memory shop-data-meanings rule 1 | session | one flow line in 01 section 4 |
