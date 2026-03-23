# Database

Supabase project: `yjuhzmknabedjklsgbje`

> **RLS Status**: RLS is enabled and policies are in place scoping all queries to `auth.uid()`. The service role key bypasses RLS — used only by Vercel webhook and Supabase edge functions. All client-side queries use the authenticated user's JWT.

---

## Tables

### `activities`
Strava activities (upserted on `strava_id`) and manually logged activities. Source of truth for all workout data.

| Column | Type | Notes |
|--------|------|-------|
| id | bigint | PK, auto |
| user_id | uuid | FK → auth.users |
| strava_id | bigint | unique, used for upsert conflict; null for manual activities |
| date | timestamptz | activity datetime (Europe/Vienna) |
| name | text | activity name |
| type | text | e.g. "run", "trail", "weighttraining" |
| distance_km | numeric | null for non-distance activities |
| duration_min | numeric | moving time in minutes |
| pace_per_km | text | formatted "M:SS" |
| avg_hr | numeric | average heart rate |
| max_hr | numeric | max heart rate |
| elevation_m | numeric | total elevation gain |
| calories | integer | from Strava (often null) |
| avg_cadence | numeric | from Strava |
| workout_type | text | Strava workout type code |
| splits_metric | jsonb | per-km splits array |
| laps | jsonb | lap data from Strava |
| raw_data | jsonb | full Strava API response |
| zone_data | jsonb | HR zone breakdown (reserved — not yet populated by webhook) |
| enrichment_status | text | enrichment pipeline state |
| source | text | `'strava'` \| `'manual'` — added 2026-03-23; default `'strava'` |

**Actively used**: Yes — main data source for Home, ActivityDetail, Plan, Stats screens.

---

### `athlete_settings`
One row per user. Stores all athlete profile, preferences, and inferred fields.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | PK, FK → auth.users |
| name | text | athlete display name |
| dob | date | date of birth (for age calculation) |
| height_cm | numeric | |
| weight_kg | numeric | current weight |
| races | jsonb | array of `{name, date, distance, target}` objects |
| goal_type | text | compete \| complete_event \| body_composition \| general_fitness \| injury_recovery |
| current_level | text | beginner \| returning \| regular \| competitive |
| health_notes | text | free-text injury/health context |
| benchmark_raw | text | raw benchmark input from onboarding |
| benchmark_value | text | inferred by Claude (e.g. "5k in 28:00") |
| has_injury | boolean | inferred by Claude |
| training_days_per_week | integer | inferred or entered directly |
| sleep_hours_typical | numeric | inferred or entered directly |
| current_weight_kg | numeric | weight from nudge response (separate from weight_kg) |
| sport_raw | text | **legacy** — raw sport text from pre-multi-sport onboarding |
| target_raw | text | **legacy** — raw target text |
| tone | integer | coaching style slider (0–100, default 50) |
| consequences | integer | coaching style slider |
| detail_level | integer | coaching style slider |
| coaching_reach | integer | coaching style slider |
| cycle_tracking_enabled | boolean | opt-in menstrual cycle tracking |
| cycle_length_avg | integer | average cycle length in days |
| cycle_is_irregular | boolean | irregular cycle flag |
| cycle_last_period_date | date | last period start date |
| cycle_notes | text | free-text notes on cycle |
| onboarding_nudges_sent | jsonb | tracks which nudge keys have been sent |
| last_goal_prompt_date | date | date of last quarterly goal prompt — added 2026-03-20 |
| subscription_tier | text | 'founder' \| 'free' \| 'pro' — added 2026-03-21, default 'founder' |
| training_zones | jsonb | `{z1_max, z2_min, z2_max, z3_min, z3_max, z4_min, z4_max, z5_min}` — added 2026-03-21 |
| health_flags | jsonb | array of `{id, label, status, notes, updated_date}` — added 2026-03-21 |
| hints_dismissed | jsonb | `{hint_id: "YYYY-MM-DD"}` — added 2026-03-21 |
| last_seen_version | text | last release notes version seen — added 2026-03-21 |
| updated_at | timestamptz | |

**Actively used**: Yes — read by virtually every screen via `useSettings()` hook.

---

### `athlete_sports`
One row per sport per user. Introduced 2026-03-18 to replace single-sport model.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → auth.users |
| sport_raw | text | free-text sport name from onboarding |
| sport_category | text | inferred: running \| cycling \| swimming \| triathlon \| strength \| hyrox \| yoga \| team_sport \| combat \| other |
| priority | text | primary \| supporting \| recovery \| paused |
| is_active | boolean | false = archived |
| lifecycle_state | text | planning \| training \| taper \| race_week \| recovery \| what_next \| maintenance |
| current_goal_raw | text | athlete's stated goal for this sport |
| target_metric | text | inferred: e.g. "sub 3:00 marathon" |
| target_date | date | inferred race/event date |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Actively used**: Yes — read by Home, Plan, Chat, Settings, Stats screens.

---

### `scheduled_sessions`
Training plan sessions. Generated by Claude plan generator or manually created.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → auth.users |
| planned_date | date | |
| session_type | text | run \| trail \| strength \| rest \| bike |
| name | text | session name |
| zone | text | e.g. "Z2", "Z3-Z4" |
| intensity | text | easy \| moderate \| hard \| very hard |
| duration_min_low | integer | lower bound of duration range |
| duration_min_high | integer | upper bound of duration range |
| notes | text | coaching notes for the session |
| elevation_target_m | integer | target elevation gain |
| status | text | planned \| completed \| missed |
| planned_start_time | time | set when athlete taps "I'm on it" — added 2026-03-20 |

**Actively used**: Yes — Plan screen, Home check-in card, buildContext.

---

### `schedule_changes`
Proposed or accepted training plan changes (from chat or mismatch detection).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → auth.users |
| status | text | pending \| accepted \| rejected |
| change_type | text | reschedule \| adjust |
| title | text | short description of the change |
| reasoning | text | coach reasoning |
| proposed_by | text | coach \| athlete |
| new_date | date | null if not a reschedule |
| new_notes | text | updated session notes |
| new_intensity | text | easy \| moderate \| hard |
| original_session_id | uuid | FK → scheduled_sessions |
| context | text | chat \| mismatch \| proactive |
| created_at | timestamptz | |

**Actively used**: Yes — Plan tab shows pending queue, badge count in tab bar.

---

### `coaching_memory`
Persistent coaching context: chat exchanges, activity feedback, and baseline analysis.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | NOT NULL, FK → auth.users ON DELETE CASCADE |
| type | text | NOT NULL — activity_feedback \| chat \| baseline \| manual_activity |
| source | text | app-chat \| activity-trigger \| strava-sync |
| category | text | chat \| activity_feedback \| baseline_analysis |
| content | text | the memory text |
| activity_id | bigint | FK → activities.id ON DELETE SET NULL — added FK 2026-03-23 |
| date | date | NOT NULL |
| created_at | timestamptz | |

**Actively used**: Yes — read by buildContext, written by Chat, webhook, and manual activity log.

---

### `daily_briefings`
One briefing per day per user, generated on-demand from the Home screen.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | |
| date | date | unique per user — upserted on conflict |
| briefing_text | text | Claude-generated bullet-point briefing |
| created_at | timestamptz | |

**Actively used**: Yes — Home screen loads today's row only (`.eq('date', todayStr)`).

---

### `nutrition_logs`
Daily food and alcohol entries.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | |
| date | date | |
| calories | integer | |
| protein_g | numeric | |
| carbs_g | numeric | |
| fat_g | numeric | |
| meal_type | text | breakfast \| lunch \| dinner \| snack \| alcohol |
| meal_name | text | |
| alcohol_units | numeric | only set when meal_type = 'alcohol' |
| logged_at | timestamptz | |

**Actively used**: Yes — Fuel screen, Home nutrition snapshot, buildContext.

---

### `cycle_logs`
Daily cycle tracking entries (opt-in only).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | |
| log_date | date | |
| phase_reported | text | menstrual \| follicular \| ovulatory \| luteal |
| override_intensity | text | reduce \| maintain \| increase |
| notes | text | |

**Actively used**: Yes — when cycle_tracking_enabled in athlete_settings.

---

### `strava_tokens`
OAuth tokens per user. Managed by strava-exchange and strava-sync edge functions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | unique |
| access_token | text | short-lived Strava access token |
| refresh_token | text | long-lived refresh token |
| expires_at | integer | Unix timestamp |
| athlete_id | bigint | Strava athlete ID |
| updated_at | timestamptz | |

**Actively used**: Yes — strava-sync refreshes/reads this table.

---

### `plan_drafts`
Claude-generated plan drafts awaiting athlete review.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | |
| status | text | active \| committed \| discarded |
| race_id | text | race name (not a proper FK) |
| phase | text | trigger type: new_race \| new_phase \| new_goal \| manual |
| summary_text | text | plan overview from Claude |
| sessions | jsonb | array of session objects |
| review_messages | jsonb | conversation history from PlanReviewPanel |
| created_at | timestamptz | |

**Actively used**: Partially — generation and review works; commit to scheduled_sessions may not be fully wired.

---

### `training_plan`
Template sessions used as structural reference when generating plan drafts.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| phase | text | e.g. "base", "build", "taper" |
| week_day | integer | 1–7 |
| session_type | text | |
| name | text | |
| duration_min_low | integer | |
| duration_min_high | integer | |
| zone | text | |
| intensity | text | |
| notes | text | |
| active | boolean | only active=true rows used in generation |

**Actively used**: Referenced during plan generation; may be empty if no template loaded.

---

### `workout_logs`
Gym/strength session exercise logs (from WorkoutIngest screen).

**Schema not fully confirmed** — written by WorkoutIngest component but columns not explicitly visible in codebase queries. Likely contains: id, user_id, activity_id, workout_type, movements (jsonb), created_at.

---

### `feature_requests`
Feature requests submitted by users, deduplicated by Claude similarity check.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| created_at | timestamptz | |
| title | text | NOT NULL |
| description | text | NOT NULL |
| status | text | triage \| in_review \| designing \| in_dev \| completed \| declined |
| vote_count | integer | default 1 — incremented when a duplicate is merged |
| created_by | uuid | FK → auth.users |
| merged_from | uuid[] | IDs of requests merged into this one |
| similarity_hash | text | reserved for dedup |
| admin_notes | text | set to 'similarity_check_failed' if Claude dedup call failed |
| completed_at | timestamptz | |

**RLS**: readable by all; insert/update by admin only.

---

### `feature_votes`
One row per user per feature. Created when a user submits a request (new or matched).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| created_at | timestamptz | |
| feature_id | uuid | FK → feature_requests |
| user_id | uuid | FK → auth.users |
| original_text | text | what the user typed (before dedup merge) |
| — | — | UNIQUE (feature_id, user_id) |

**RLS**: users can insert their own votes; read their own votes.

---

### `feature_notifications`
Status change notifications sent to users who voted on a feature.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| created_at | timestamptz | |
| user_id | uuid | FK → auth.users |
| feature_id | uuid | FK → feature_requests |
| type | text | 'status_change' \| 'completed' |
| old_status | text | |
| new_status | text | |
| seen | boolean | default false |

**RLS**: users can read and update their own notifications. Badge count shown on settings icon in app.

To notify voters when status changes (run manually via Supabase SQL editor):
```sql
UPDATE feature_requests SET status = 'in_dev' WHERE id = '[feature_id]';
INSERT INTO feature_notifications (user_id, feature_id, type, old_status, new_status)
SELECT fv.user_id, '[feature_id]', 'status_change', 'in_review', 'in_dev'
FROM feature_votes fv WHERE fv.feature_id = '[feature_id]';
```

---

### `app_releases`
One row per app version. Used to trigger the release notes popup.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| created_at | timestamptz | |
| version | text | NOT NULL UNIQUE — semver e.g. '1.1.0' |
| release_date | date | NOT NULL |
| headline | text | NOT NULL — one-line summary |
| changes | jsonb | array of `{title, description, tab}` objects |

**RLS**: readable by all. To add a new release:
```sql
INSERT INTO app_releases (version, release_date, headline, changes)
VALUES ('1.1.0', '2026-03-22', 'Headline here', '[{"title":"...","description":"...","tab":"Home"}]'::jsonb);
```
The popup fires automatically for all users on their next load.

---

## Recently Added Columns

| Column | Table | Added | Purpose |
|--------|-------|-------|---------|
| `source` | activities | 2026-03-23 | `'strava'` or `'manual'` — distinguishes Strava-synced vs manually logged activities |
| FK on `activity_id` | coaching_memory | 2026-03-23 | FK → activities.id ON DELETE SET NULL; previous orphaned rows (stored Strava IDs) were nulled |
| `planned_start_time` | scheduled_sessions | 2026-03-20 | Records when athlete taps "I'm on it" on check-in card |
| `last_goal_prompt_date` | athlete_settings | 2026-03-20 | Prevents quarterly goal prompt from re-appearing too soon |
| `hints_dismissed` | athlete_settings | 2026-03-21 | JSONB object `{hint_id: "YYYY-MM-DD"}` — dismissed onboarding hints by ID |
| `last_seen_version` | athlete_settings | 2026-03-21 | Last app version the user saw the release notes for |
| `subscription_tier` | athlete_settings | 2026-03-21 | Athlete tier badge; default 'founder' |
| `training_zones` | athlete_settings | 2026-03-21 | JSONB object: `{z1_max, z2_min, z2_max, z3_min, z3_max, z4_min, z4_max, z5_min}` — editable in Settings, used in coaching prompt |
| `health_flags` | athlete_settings | 2026-03-21 | JSONB array of `{id, label, status, notes, updated_date}` — active/monitoring flags injected into coaching context |
| `onboarding_nudges_sent` | athlete_settings | 2026-03-18 | Tracks which progressive onboarding nudges have been sent |
| `cycle_*` columns | athlete_settings | 2026-03-18 | Opt-in menstrual cycle tracking |
| `athlete_sports` table | — | 2026-03-18 | Entire table added for multi-sport support |
