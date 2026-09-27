-- Nullable platform_id must still be unique (Postgres 15+)
ALTER TABLE access_level_capabilities
  ADD CONSTRAINT access_level_capabilities_uniq
  UNIQUE NULLS NOT DISTINCT (access_level_id, platform_id, feature_id);

ALTER TABLE user_capability_overrides
  ADD CONSTRAINT user_capability_overrides_uniq
  UNIQUE NULLS NOT DISTINCT (user_id, platform_id, feature_id);

-- A kill switch must target something
ALTER TABLE kill_switches
  ADD CONSTRAINT kill_switches_scope_chk
  CHECK (platform_id IS NOT NULL OR feature_id IS NOT NULL);

-- Only one active kill switch per scope
CREATE UNIQUE INDEX kill_switches_one_active_per_scope
  ON kill_switches (
    COALESCE(platform_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(feature_id,  '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE active;

-- At most one ACTIVE destination per user+platform while multi_account is off
CREATE UNIQUE INDEX social_accounts_one_active_per_platform
  ON social_accounts (user_id, platform_id)
  WHERE status = 'ACTIVE';

-- A PUBLISHED publication must have an external id unless resolved manually
ALTER TABLE publications
  ADD CONSTRAINT publications_published_has_ref_chk
  CHECK (status <> 'PUBLISHED' OR external_id IS NOT NULL OR resolved_manually);