# NCSOS post-deploy verification checklist

Verify the Nick Customer Service OS arc (PRs #982–#999, merged to `main` at
`8d6865b21`) is live in production after Railway deploys. Work top to bottom.
Everything needing `$ADMIN_API_KEY` uses `Authorization: Bearer <key>`.

## 0 · Confirm the deploy landed

- [ ] Railway → `MAINnicks-tire-auto` service shows a **successful** deploy of
      commit `8d6865b21` (or later). If the build failed, stop here.
- [ ] In the deploy logs, confirm the boot services started:
  - `SMS response-job processor started`
  - `Seeded N business facts` (from `seedBusinessFacts`)
  - `SMS delayed queue processor started` (pre-existing — sanity that boot ran)

## 1 · Apply the schema (creates 3 tables + 1 column)

`handleRunMigrations` is idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN
IF NOT EXISTS`). Safe to run more than once.

```bash
curl -X POST https://nickstire.org/api/admin/run-migrations \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

- [ ] Response is `{ "success": true, ... }` with an **empty `errors`** array.
- [ ] On the **first** run, `applied` includes (later runs list them in `skipped`):
  - `sms_response_jobs` (durable inbound-response spine, #986)
  - `business_facts` (facts/claims store, #992)
  - `expected_arrivals` (voice/SMS "coming today", #997)
  - the `edit_categories_json` `ALTER` on `nickgpt_training_examples` (#999)

## 2 · Immediate smoke checks (no test customer needed)

- [ ] **Engine consolidation (#994)** — the retired divergent SMS bot is gone:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://nickstire.org/api/sms-webhook
  ```
  Expect **404** (route removed). The live inbound path is the Capevace gateway → `orchestrateSms`.
- [ ] **Health** — `GET https://nickstire.org/api/health` returns healthy (no integration in a hard-error state).
- [ ] **Crons registered** — `GET https://nickstire.org/api/admin/cron-status`
      (Bearer auth) lists `sms-learning-digest` and `dashboard-sync`.
- [ ] **Warranty truth (#996)** — open `https://nickstire.org/warranties` and a
      service page (e.g. `/brakes`). Copy reads **"12-month parts / 90-day labor"**;
      `Ctrl-F "12,000"` finds **nothing**. Check the page source (View Source) too
      — the JSON-LD `laborWarranty` should say `90 days`, not `12 months / 12,000 miles`.

## 3 · Live capture spot-checks (use a test phone, not a customer)

- [ ] **Expected arrival from SMS (#998)** — from a phone that is NOT opted out,
      text the shop line **"coming by today"**. Then, in the admin, load the
      Expected Arrivals view (`dispatch.expectedArrivals` / Today screen). A row
      should appear with your number, `source = sms`, `status = expected`.
      - Negative control: text **"can't make it today"** → **no** new row (declines are not arrivals).
- [ ] **Expected arrival from voice (#997)** — on a test call, tell the AI you'll
      drop off. After the call, the same Expected Arrivals view shows a
      `source = voice` row. (This also clears the auditor's old "dropoff not persisted" alert.)
- [ ] **Customer memory (#988)** — text an inbound question as a known customer;
      the AI's reply/draft should reference their vehicle by name where relevant,
      not answer cold.
- [ ] **Human takeover (#987)** — reply to a live SMS conversation manually from
      the admin, then have the customer text again within an hour. The AI should
      **draft** (not auto-send) — you stay in control of that thread.

## 4 · Over the next few days (crons do the work)

- [ ] **Arrival reconcile** — after a customer who was "expected" gets a paid
      invoice, the `dashboard-sync` cron (every 2h) flips their row to `arrived`
      and links the invoice. Their status stops being `expected`.
- [ ] **Training digest (#999)** — the `sms-learning-digest` cron runs weekly.
      Once enough approved training examples accrue, it files a **`pending`**
      `fine_tune_ready` recommendation (with the top operator-edit pattern). It
      **never** auto-triggers a fine-tune — you review and run it.

## Rollback

Every change is on `main` and git-revertible. The new tables are additive; the
riskiest change (retiring `/api/sms-webhook`) only removed a **dormant** Twilio
route (you use Capevace), so a `404` there is expected, not a regression. If
anything misbehaves, revert the specific PR — no data migration to undo.
