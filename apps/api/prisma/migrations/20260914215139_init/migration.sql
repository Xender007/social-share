-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "FeatureScope" AS ENUM ('GLOBAL', 'PLATFORM');

-- CreateEnum
CREATE TYPE "OverrideEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('GOOGLE', 'META');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'REFRESH_FAILING', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'NOT_ELIGIBLE', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROBING', 'READY', 'INVALID', 'DELETED');

-- CreateEnum
CREATE TYPE "MediaVariantKind" AS ENUM ('H264_SDR');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'NEEDS_ATTENTION', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING_MEDIA', 'QUEUED', 'IN_PROGRESS', 'WAITING_PROVIDER', 'RETRY_SCHEDULED', 'UNKNOWN_OUTCOME', 'NEEDS_USER_ACTION', 'PAUSED', 'PUBLISHED', 'FAILED_FINAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('TRANSIENT', 'RATE_LIMITED', 'PROVIDER_LIMIT', 'UNKNOWN_OUTCOME', 'AUTH', 'MEDIA_INVALID', 'PERMISSION', 'VALIDATION', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('ADVANCED', 'WAITING', 'SUCCEEDED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MetricEntity" AS ENUM ('ACCOUNT', 'PUBLICATION');

-- CreateEnum
CREATE TYPE "MetricGranularity" AS ENUM ('SNAPSHOT', 'DAILY');

-- CreateEnum
CREATE TYPE "MetricAggregation" AS ENUM ('SUM', 'LATEST', 'AVERAGE');

-- CreateTable
CREATE TABLE "access_levels" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "access_level_id" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_name" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expo_push_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "app_version" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platforms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "FeatureScope" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_features" (
    "id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "feature_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_level_capabilities" (
    "id" UUID NOT NULL,
    "access_level_id" UUID NOT NULL,
    "platform_id" UUID,
    "feature_id" UUID NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "access_level_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_capability_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform_id" UUID,
    "feature_id" UUID NOT NULL,
    "effect" "OverrideEffect" NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_capability_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switches" (
    "id" UUID NOT NULL,
    "platform_id" UUID,
    "feature_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pause_queued_jobs" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "activated_by_id" UUID,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "kill_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "code_verifier" TEXT,
    "platform_codes" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "external_user_name" TEXT,
    "scopes" TEXT[],
    "access_token_enc" BYTEA,
    "refresh_token_enc" BYTEA,
    "token_key_version" INTEGER,
    "access_token_expires_at" TIMESTAMP(3),
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_refreshed_at" TIMESTAMP(3),
    "last_validated_at" TIMESTAMP(3),
    "last_error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "handle" TEXT,
    "avatar_url" TEXT,
    "destination_token_enc" BYTEA,
    "token_key_version" INTEGER,
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'INACTIVE',
    "status_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_metrics_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "multipart_upload_id" TEXT,
    "original_filename" TEXT,
    "declared_mime_type" TEXT NOT NULL,
    "declared_size_bytes" BIGINT NOT NULL,
    "size_bytes" BIGINT,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "invalid_reason" TEXT,
    "container" TEXT,
    "video_codec" TEXT,
    "audio_codec" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "rotation" INTEGER,
    "duration_ms" INTEGER,
    "frame_rate" DOUBLE PRECISION,
    "is_variable_frame_rate" BOOLEAN,
    "is_hdr" BOOLEAN,
    "bit_depth" INTEGER,
    "has_audio" BOOLEAN,
    "probe" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMP(3),
    "delete_after" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_variants" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "kind" "MediaVariantKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "VariantStatus" NOT NULL DEFAULT 'PROCESSING',
    "size_bytes" BIGINT,
    "probe" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHING',
    "scheduled_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "media_variant_id" UUID,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "title_override" TEXT,
    "caption_override" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "current_step" TEXT,
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "waiting_since" TIMESTAMP(3),
    "external_id" TEXT,
    "external_url" TEXT,
    "error_category" "ErrorCategory",
    "error_code" TEXT,
    "provider_error_code" TEXT,
    "error_message" TEXT,
    "resolved_manually" BOOLEAN NOT NULL DEFAULT false,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_metrics_synced_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_attempts" (
    "id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "job_id" TEXT,
    "step" TEXT NOT NULL,
    "outcome" "AttemptOutcome",
    "error_category" "ErrorCategory",
    "http_status" INTEGER,
    "provider_error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "publication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "key" TEXT NOT NULL,
    "platform_id" UUID,
    "entity" "MetricEntity" NOT NULL,
    "granularity" "MetricGranularity" NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'count',
    "aggregation" "MetricAggregation" NOT NULL,
    "provider_metric" TEXT,
    "comparable_group" TEXT,
    "is_derived" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deprecated_at" TIMESTAMP(3),

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "account_metric_points" (
    "id" BIGSERIAL NOT NULL,
    "social_account_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_metric_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_metric_points" (
    "id" BIGSERIAL NOT NULL,
    "publication_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_metric_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_raw_responses" (
    "id" BIGSERIAL NOT NULL,
    "social_account_id" UUID,
    "publication_id" UUID,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_raw_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_quota_usage" (
    "id" UUID NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "quota_name" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "units_used" INTEGER NOT NULL DEFAULT 0,
    "units_limit" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_quota_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "social_account_id" UUID,
    "status" TEXT NOT NULL,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_levels_code_key" ON "access_levels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_expo_push_token_key" ON "devices"("expo_push_token");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_code_key" ON "platforms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "features_code_key" ON "features"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_features_platform_id_feature_id_key" ON "platform_features"("platform_id", "feature_id");

-- CreateIndex
CREATE INDEX "access_level_capabilities_access_level_id_idx" ON "access_level_capabilities"("access_level_id");

-- CreateIndex
CREATE INDEX "user_capability_overrides_user_id_idx" ON "user_capability_overrides"("user_id");

-- CreateIndex
CREATE INDEX "kill_switches_active_idx" ON "kill_switches"("active");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_user_id_provider_external_user_id_key" ON "provider_connections"("user_id", "provider", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_user_id_platform_id_external_account_id_key" ON "social_accounts"("user_id", "platform_id", "external_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_key_key" ON "media"("storage_key");

-- CreateIndex
CREATE INDEX "media_status_delete_after_idx" ON "media"("status", "delete_after");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_storage_key_key" ON "media_variants"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_media_id_kind_key" ON "media_variants"("media_id", "kind");

-- CreateIndex
CREATE INDEX "posts_user_id_created_at_idx" ON "posts"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "posts_user_id_idempotency_key_key" ON "posts"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "publications_status_next_attempt_at_idx" ON "publications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "publications_social_account_id_published_at_idx" ON "publications"("social_account_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_post_id_social_account_id_key" ON "publications"("post_id", "social_account_id");

-- CreateIndex
CREATE INDEX "publication_attempts_publication_id_started_at_idx" ON "publication_attempts"("publication_id", "started_at");

-- CreateIndex
CREATE INDEX "account_metric_points_social_account_id_metric_key_bucket_s_idx" ON "account_metric_points"("social_account_id", "metric_key", "bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "account_metric_points_social_account_id_metric_key_bucket_k_key" ON "account_metric_points"("social_account_id", "metric_key", "bucket_key");

-- CreateIndex
CREATE INDEX "publication_metric_points_publication_id_metric_key_bucket__idx" ON "publication_metric_points"("publication_id", "metric_key", "bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "publication_metric_points_publication_id_metric_key_bucket__key" ON "publication_metric_points"("publication_id", "metric_key", "bucket_key");

-- CreateIndex
CREATE INDEX "provider_raw_responses_captured_at_idx" ON "provider_raw_responses"("captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_quota_usage_provider_quota_name_day_key" ON "provider_quota_usage"("provider", "quota_name", "day");

-- CreateIndex
CREATE INDEX "sync_runs_kind_started_at_idx" ON "sync_runs"("kind", "started_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_access_level_id_fkey" FOREIGN KEY ("access_level_id") REFERENCES "access_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_features" ADD CONSTRAINT "platform_features_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_features" ADD CONSTRAINT "platform_features_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_level_capabilities" ADD CONSTRAINT "access_level_capabilities_access_level_id_fkey" FOREIGN KEY ("access_level_id") REFERENCES "access_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_level_capabilities" ADD CONSTRAINT "access_level_capabilities_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_level_capabilities" ADD CONSTRAINT "access_level_capabilities_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_capability_overrides" ADD CONSTRAINT "user_capability_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_capability_overrides" ADD CONSTRAINT "user_capability_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_capability_overrides" ADD CONSTRAINT "user_capability_overrides_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_capability_overrides" ADD CONSTRAINT "user_capability_overrides_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_media_variant_id_fkey" FOREIGN KEY ("media_variant_id") REFERENCES "media_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_metric_points" ADD CONSTRAINT "account_metric_points_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_metric_points" ADD CONSTRAINT "account_metric_points_metric_key_fkey" FOREIGN KEY ("metric_key") REFERENCES "metric_definitions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_metric_points" ADD CONSTRAINT "publication_metric_points_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_metric_points" ADD CONSTRAINT "publication_metric_points_metric_key_fkey" FOREIGN KEY ("metric_key") REFERENCES "metric_definitions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_raw_responses" ADD CONSTRAINT "provider_raw_responses_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_raw_responses" ADD CONSTRAINT "provider_raw_responses_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
