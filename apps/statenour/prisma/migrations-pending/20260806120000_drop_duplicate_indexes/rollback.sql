-- ROLLBACK for 20260806120000_drop_duplicate_indexes
--
-- Captured from pg_indexes.indexdef on the production branch immediately
-- BEFORE the drops were applied (2026-08-06). These are the exact definitions
-- Postgres held, not reconstructions — running this file restores all 42
-- dropped indexes byte-for-byte.
--
-- Note what these definitions prove about the safety argument: every one is a
-- plain btree over the same column list as its surviving snake_case twin.
-- No UNIQUE, no partial predicate, no expression index, no differing opclass
-- or sort order. That is why dropping them cannot change a query plan — the
-- twin covers the identical access path.
--
-- Only needed if a plan regression appears. Indexes are pure derived data;
-- recreating them costs a rebuild and nothing else.

CREATE INDEX "Mission_deletedAt_idx" ON public."Mission" USING btree (deleted_at);
CREATE INDEX "Task_deletedAt_idx" ON public."Task" USING btree (deleted_at);
CREATE INDEX "agent_traces_errorClass_createdAt_idx" ON public.agent_traces USING btree (error_class, created_at);
CREATE INDEX "agent_traces_provider_createdAt_idx" ON public.agent_traces USING btree (provider, created_at);
CREATE INDEX "agent_traces_source_createdAt_idx" ON public.agent_traces USING btree (source, created_at);
CREATE INDEX "ai_generations_model_createdAt_idx" ON public.ai_generations USING btree (model, created_at);
CREATE INDEX "ai_generations_status_createdAt_idx" ON public.ai_generations USING btree (status, created_at);
CREATE INDEX "api_request_logs_statusCode_createdAt_idx" ON public.api_request_logs USING btree (status_code, created_at);
CREATE INDEX "automation_policy_fires_firedAt_idx" ON public.automation_policy_fires USING btree (fired_at);
CREATE INDEX "brain_bus_events_topic_createdAt_idx" ON public.brain_bus_events USING btree (topic, created_at);
CREATE INDEX "brain_dumps_date_actionsTaken_idx" ON public.brain_dumps USING btree (date, actions_taken);
CREATE INDEX "brain_dumps_deletedAt_idx" ON public.brain_dumps USING btree (deleted_at);
CREATE INDEX "brain_memories_category_createdAt_idx" ON public.brain_memories USING btree (category, created_at);
CREATE INDEX "brain_memories_category_deletedAt_idx" ON public.brain_memories USING btree (category, deleted_at);
CREATE INDEX "brain_memories_category_updatedAt_idx" ON public.brain_memories USING btree (category, updated_at);
CREATE INDEX "brain_memories_expiresAt_idx" ON public.brain_memories USING btree (expires_at);
CREATE INDEX "brain_memories_lastSeen_idx" ON public.brain_memories USING btree (last_seen);
CREATE INDEX "chat_conversations_missionId_idx" ON public.chat_conversations USING btree (mission_id);
CREATE INDEX "chat_conversations_starredAt_idx" ON public.chat_conversations USING btree (starred_at);
CREATE INDEX "chat_messages_conversationId_branchId_idx" ON public.chat_messages USING btree (conversation_id, branch_id);
CREATE INDEX "chat_messages_feedbackScore_idx" ON public.chat_messages USING btree (feedback_score);
CREATE INDEX "chat_messages_parentMessageId_idx" ON public.chat_messages USING btree (parent_message_id);
CREATE INDEX "chat_messages_provider_createdAt_idx" ON public.chat_messages USING btree (provider, created_at);
CREATE INDEX "chat_messages_streamingState_createdAt_idx" ON public.chat_messages USING btree (streaming_state, created_at);
CREATE INDEX "commitments_deletedAt_idx" ON public.commitments USING btree (deleted_at);
CREATE INDEX "device_commands_status_createdAt_idx" ON public.device_commands USING btree (status, created_at);
CREATE INDEX "entity_audits_action_createdAt_idx" ON public.entity_audits USING btree (action, created_at);
CREATE INDEX "entity_audits_actor_createdAt_idx" ON public.entity_audits USING btree (actor, created_at);
CREATE INDEX "entity_audits_createdAt_idx" ON public.entity_audits USING btree (created_at);
CREATE INDEX "goal_events_kind_createdAt_idx" ON public.goal_events USING btree (kind, created_at);
CREATE INDEX "identity_snapshots_deletedAt_idx" ON public.identity_snapshots USING btree (deleted_at);
CREATE INDEX "life_goals_deletedAt_idx" ON public.life_goals USING btree (deleted_at);
CREATE INDEX "mastery_decisions_deletedAt_idx" ON public.mastery_decisions USING btree (deleted_at);
CREATE INDEX "mastery_decisions_reviewDate_idx" ON public.mastery_decisions USING btree (review_date);
CREATE INDEX "memory_edges_targetType_targetId_idx" ON public.memory_edges USING btree (target_type, target_id);
CREATE INDEX "person_profiles_trustScore_idx" ON public.person_profiles USING btree (trust_score);
CREATE INDEX "reflections_deletedAt_idx" ON public.reflections USING btree (deleted_at);
CREATE INDEX "scheduled_actions_entityType_entityId_idx" ON public.scheduled_actions USING btree (entity_type, entity_id);
CREATE INDEX "schema_change_ledger_environment_appliedAt_idx" ON public.schema_change_ledger USING btree (environment, applied_at);
CREATE INDEX "system_metrics_createdAt_idx" ON public.system_metrics USING btree (created_at);
CREATE INDEX "system_metrics_source_createdAt_idx" ON public.system_metrics USING btree (source, created_at);
CREATE INDEX "task_events_kind_createdAt_idx" ON public.task_events USING btree (kind, created_at);
