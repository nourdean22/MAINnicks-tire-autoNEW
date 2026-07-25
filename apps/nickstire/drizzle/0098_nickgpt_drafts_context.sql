-- ROS-058 close-out: full decision context captured AT DRAFT TIME.
-- Training examples used to store conversationContextJson={} (later, a few
-- draft fields) because the context the drafter actually used was never
-- persisted anywhere. This column stores it on the draft row itself:
-- conversation turns, customer facts, the router decision, the reply plan,
-- and provider/model — so the learning engine copies REAL context into
-- nickgpt_training_examples and a future fine-tune learns why a reply was
-- appropriate, not just what it said. Additive, one change (TiDB rule).
ALTER TABLE nickgpt_drafts ADD COLUMN context_json TEXT NULL;
