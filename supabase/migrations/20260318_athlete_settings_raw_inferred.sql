-- Extended athlete_settings: raw free-text inputs + AI-inferred structured fields.
-- Drops three constraints with changed enum values, adds 12 new columns,
-- backfills Richard's row, then reinstates updated constraints.

-- ── Step 1: Drop constraints with changed enum values ───────────────────────
alter table athlete_settings
  drop constraint if exists chk_as_goal_type,
  drop constraint if exists chk_as_current_level,
  drop constraint if exists chk_as_lifecycle_state;

-- ── Step 2: Add new columns ──────────────────────────────────────────────────
-- target_event_name and target_date already exist from prior migration — IF NOT EXISTS no-ops.
alter table athlete_settings
  add column if not exists sport_raw              text,
  add column if not exists sport_category         text,
  add column if not exists target_raw             text,
  add column if not exists target_event_name      text,
  add column if not exists target_date            date,
  add column if not exists target_metric          text,
  add column if not exists benchmark_raw          text,
  add column if not exists benchmark_value        text,
  add column if not exists health_notes_raw       text,
  add column if not exists has_injury             boolean,
  add column if not exists training_days_per_week integer,
  add column if not exists sleep_hours_typical    numeric,
  add column if not exists current_weight_kg      numeric,
  add column if not exists onboarding_nudges_sent jsonb default '{}';

-- ── Step 3: Backfill Richard's row ──────────────────────────────────────────
-- Must precede new constraints: old lifecycle_state 'base_build' not in new enum.
update athlete_settings
set
  sport_raw       = 'marathon running',
  sport_category  = 'running',
  goal_type       = 'compete',
  lifecycle_state = 'training'
where user_id is not null;

-- ── Step 4: Add updated + new constraints ───────────────────────────────────
alter table athlete_settings
  add constraint chk_as_goal_type
    check (goal_type in ('compete','complete_event','body_composition','general_fitness','injury_recovery') or goal_type is null),
  add constraint chk_as_sport_category
    check (sport_category in ('running','cycling','swimming','triathlon','strength','hyrox','yoga','team_sport','combat','other') or sport_category is null),
  add constraint chk_as_current_level
    check (current_level in ('beginner','returning','regular','competitive') or current_level is null),
  add constraint chk_as_lifecycle_state
    check (lifecycle_state in ('onboarding','planning','training','taper','race_week','recovery','what_next','maintenance') or lifecycle_state is null);
