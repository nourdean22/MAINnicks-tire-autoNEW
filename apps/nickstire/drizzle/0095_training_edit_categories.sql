-- nickgpt_training_examples.edit_categories_json — the training-loop edit taxonomy.
--
-- When an operator edits the AI's draft before sending, trackDraftFeedback already
-- captures the (draft, final) pair. This column stores WHY it was changed — a JSON
-- array of edit categories (too_long, too_robotic, unnecessary_price, price_changed,
-- added_invitation, too_aggressive, full_rewrite, minor_edit) from the pure
-- classifier in server/services/editClassifier.ts. The weekly digest aggregates
-- these so a prompt/fine-tune decision is evidence-based. Additive + nullable;
-- fine-tunes remain operator-gated (the digest only RECOMMENDS).

ALTER TABLE `nickgpt_training_examples` ADD COLUMN IF NOT EXISTS `edit_categories_json` text NULL;
