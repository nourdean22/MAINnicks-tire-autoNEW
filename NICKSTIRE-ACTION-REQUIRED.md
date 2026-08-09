# nickstire campaign — operator decisions

Companion to [`AUDIT/nickstire-2026-08-09.md`](AUDIT/nickstire-2026-08-09.md). Cross-app items live
in [`NOUR-ACTION-REQUIRED.md`](NOUR-ACTION-REQUIRED.md).

1. **`DRY_RUN` kill-switch — decide the default before it is built.** The mandate says default it
   **ON for the whole campaign**. That would stop every outbound SMS on deploy — including
   **appointment reminders and confirmations**, which causes customer no-shows at a live shop. It is
   also a production behaviour change nobody would see until a customer didn't show up.
   **Recommended shape:** build the switch, default it **OFF in production and ON in dev/test**, so
   you get a verifiable one-flip emergency stop without changing today's behaviour. Say which you
   want and it ships that way.
2. **Per-page traffic evidence is the gate on all public-page deletion.** No public URL was touched
   this pass because per-URL traffic could not be read here (Ahrefs/Supermetrics unauthenticated;
   the in-house `search_performance` table is prod and operator-gated). To unblock stage 3.1, either
   authorize a read-only prod query against `search_performance`, or connect the Ahrefs/Supermetrics
   connectors in claude.ai settings.
3. **"Moe's Tire" — do NOT let any agent execute the mandate's stage 5.1 as written.** The site-side
   references are a deliberate legacy-brand capture asset (`/moes-tire-euclid`, cited at **242 clicks
   / position 4.5 over 90 days**), correctly 301'd and `sitemap:false` on the aliases. A real NAP
   conflict, if one exists, is in **GBP and third-party directory listings** — your console, not the
   repo. Worth confirming your GBP business name/address/phone match the site exactly.
4. **Index and table hygiene is unstarted by design.** It needs prod introspection plus the
   mandate's own INVISIBLE canary period before any drop.
5. Standing cross-app items (GitHub PAT revocation, Deepgram key, LiveKit billing, arming
   `SMS_CONSENT_GATE`) remain in `NOUR-ACTION-REQUIRED.md`.
