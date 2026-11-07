# Shift rules: text line, forwarded calls, COMING IN

One page for the counter. Hours and prices live in `shared/business.ts`. Paths are under `apps/nickstire/`.

**One phone gets all three.** Forwarded calls, TEXT WAITING pages and COMING IN texts go to the number
set as the receptionist's transfer destination (`server/services/vapi.ts:2409-2468`, `server/services/eventBus.ts:630-654`).
Change it in Admin, Voice, transfer destination (`client/src/pages/admin/voice/TransferDestinationCard.tsx:48`);
texts follow within 5 minutes (`vapi.ts:2423`). Whoever holds that phone runs this page for the shift.

## 1. Text line

What the system does:
- A customer text with no reply for 15 minutes, shop open, sends one text to that phone
  (`server/services/smsWaitPage.ts:24,58,93,121`). After-close texts under 24 hours old page at opening (`smsWaitPage.ts:26,58,80`).
- It reads `TEXT WAITING 15m, no reply yet`, then the name, number, the customer's words and
  `Reply: nickstire.org/admin` (`smsWaitPage.ts:46-54`). One page per waiting text, no repeats (`smsWaitPage.ts:9-11`).
- Any reply from the admin or the shop line closes it (`smsWaitPage.ts:65-66,81-84`).

What the crew does:
1. Open nickstire.org/admin and find the text in the Today list.
2. A Suggested reply shows? Read it, then tap Send draft (`client/src/pages/admin/today/QueueRow.tsx:99-108`).
3. No draft, or it is wrong: tap Reply and write your own (`client/src/pages/admin/today/queueActions.ts:63-70`).
4. Already called them? Tap No reply needed (`queueActions.ts:71-73`).

Owner: ______________________

## 2. Forwarded calls

What the system does:
- The receptionist forwards the call to that phone. The caller hears a ring tone, not music (`server/services/vapi.ts:625-626`).
- You hear one line: "Nick's customer on the line. Connecting you now." Any live voice (hello, Nick's,
  yeah) connects the caller. Nobody is asked to say yes (`server/services/vapi.ts:606-621`).
- No answer in about 25 seconds, voicemail, busy, or 10 seconds of silence: the caller hears "Sorry,
  nobody could grab the phone up front." and goes back to the receptionist (`vapi.ts:614-615,629-631,703`).
  The live receptionist gets this only after Push Latest Config in the admin (`vapi.ts:602-604`).

What the crew does:
1. Answer and talk right away. "Nick's" is enough. Do not wait for a question.
2. Can't take it? Say "I can't take a call right now." The caller goes back to the receptionist (`vapi.ts:621`).
3. Leaving the counter or ending your shift: move the transfer number to whoever covers, before you go.
4. Hear "say yes" or any question before the caller? Tell Nour: the live setup is out of date.

Owner: ______________________

## 3. COMING IN

What the system does:
- A caller coming today or now, or a tow on its way: the receptionist texts that phone once per call
  and books nothing. First come, first served (`server/routers/voiceAgent.ts:614-623,637-643`).
- The text: `COMING IN (phone)` or `TOW COMING (phone)`, then name and number, `For:` the job, the
  vehicle, and `ETA:` when the caller gave one (`voiceAgent.ts:157-171`).
- Asked for work but not booked, while the shop is open: `ASKED, NOT BOOKED (phone)`, ending
  `Not booked by the assistant` (`voiceAgent.ts:258-265`, `server/services/voiceIntentSafetyNet.ts:84-89`).

What the crew does:
1. COMING IN: tell the bay the name, the job and the ETA.
2. TOW COMING: clear a spot for the truck.
3. ASKED, NOT BOOKED: call the number back while the shop is open.
4. The car never shows: nothing to undo. No slot was held.

Owner: ______________________

Something on this page is wrong (no page came, wrong phone, the old "say yes" line): text Nour the time and what you saw.
