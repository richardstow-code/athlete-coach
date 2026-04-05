# Athlete Coach — Strategic Handover
*Last updated: 2026-04-05.*

---

## CURRENT STATE SUMMARY

### What the app does

An AI-powered personal coaching app for a single athlete (Richard Stow, 79kg male, marathon training, sub-3:00 target at Munich Marathon 12 Oct 2026). The app:

- Automatically ingests Strava workouts via a two-stage webhook pipeline (Vercel Stage 1 → Supabase Stage 2 enrichment)
- Shows a time-aware home dashboard (morning briefing / afternoon check-in / evening summary)
- Provides conversational coaching via a Chat tab (Claude Haiku)
- Tracks nutrition with AI-assisted logging
- Manages a training plan with mismatch detection and coach-proposed changes
- Shows training progress split by goal type (macro overview / micro event detail)
- Supports multi-sport coaching with per-sport lifecycle states

### What is working reliably

- Strava webhook → activity ingestion (Vercel serverless function)
- **Two-stage enrichment pipeline** — trigger fires on INSERT **and UPDATE** (upsert path) when enrichment_status = 'pending' (fixed 2026-03-30)
- Activity coaching feedback → coaching_memory (written on each new activity)
- Per-km splits included in coaching context via `raw_data.splits_metric`
- Auth (email/password via Supabase)
- Chat coaching with context (buildContext layer is solid, includes active injury reports)
- Nutrition logging with AI macro + fibre/sodium/UPF parsing, manual timestamps, weekly digest
- Plan tab: week view, session status, mismatch detection, sport-aware metrics
- Onboarding flow (5-step, multi-sport — Strava connect at step 2)
- Settings: profile, sliders, race management, Strava connection, **sport preferences (editable post-onboarding)**
- PostWorkoutPopup after new activity
- Cycle tracking (opt-in)
- Injury reporting workflow with rehab session type in SessionDetail
- Daily briefing includes last 7 days planned vs actual session data

### What is partially built or known to be buggy

- **Plan commit from draft**: generating a plan draft works; committing it to scheduled_sessions may not be fully wired in all paths (unconfirmed — verify in code)
- **Evening readiness note**: persists only to localStorage, not to DB; lost on hard refresh
- **n8n workflows**: two workflows at https://lifeassistant.app.n8n.cloud are still active but now superseded — deactivation pending
  - Daily Briefing: `Dsws6deZc9bAlXkl`
  - Strava Sync: `RNTJRELH2Mj7rQtX`
- **cadence_stats.avg**: enrich-activity stores raw Strava cadence (84 spm, one foot) rather than total spm (168). The `activities.avg_cadence` column correctly doubles the raw value via strava-sync; cadence_stats is consistent internally but note the unit difference

### Recently completed (2026-04-05)

- **HealthKit → Supabase pipeline (native app)**: `lib/healthKitSync.ts` pulls 6 months of workout history and passive metrics into Supabase on first launch. Workouts gap-fill `activities` (source='healthkit', dedup by date+type). Passive metrics go to new `health_metrics` table (resting HR, HRV, sleep, steps). `buildContext.js` now queries `health_metrics` and surfaces 7d avg resting HR, latest HRV, last sleep, yesterday's steps in the HEALTH METRICS coaching context section.
- **Schema additions**: `activities.source`, `activities.healthkit_uuid`, `health_metrics` table (full schema in `docs/database.md`), `athlete_settings.healthkit_sync_enabled`, `athlete_settings.healthkit_last_synced_at`.
- **Multi-user support**: removed hardcoded `ATHLETE_USER_ID` from `api/strava-webhook.js`. Webhook now reads `owner_id` from the Strava event body, looks up the matching user in `strava_tokens` by `athlete_id`, and fetches/refreshes their per-user token from that table. No env-var refresh token. `buildActivityRow()` now takes `userId` as a parameter. `STRAVA_REFRESH_TOKEN` Vercel env var is now unused (can be removed from dashboard).

### Recently completed (2026-04-04)

- **SVG chart redesign (native app)**: `ActivityTrendChart`, `HeartRateChart`, `PaceChart`, `ElevationChart` all rewritten with `react-native-svg`. Elevation silhouettes, zone-coloured HR segments, inverted pace axis, cubic bezier volume line. `constants/Colors.ts` centralises the brand palette.
- **Post-activity subjective capture flow (native app)**: 4-step full-screen modal (`app/activity-capture.tsx`) captures injury flag, leg feel, RPE, and notes. AI coaching response (claude-proxy, 250 tokens) covers Recovery / Fuelling / Sleep / Tomorrow and conditionally proposes a reschedule. Evening check-in modal (`app/evening-checkin.tsx`) follows 3h later with injury feel + refuel questions. Home screen shows prompt cards when check-ins are pending. Morning briefing now injects yesterday's subjective data; injury escalations surface as priority lines.
- **Notification settings (native app)**: "Training Notifications" section in Settings with post-activity, evening check-in, morning reference toggles, and hours-after stepper. Persists to `athlete_settings.notification_prefs`.
- **`lib/notifications.ts` (native app)**: AsyncStorage-backed pending-state abstraction, Phase 2 ready for Expo Notifications. All calling code uses stable API.
- **Schema additions**: 6 new columns on `activities` (rpe, feel_legs, injury_flag, subjective_notes, subjective_captured_at, evening_checkin_data) and 2 on `athlete_settings` (notification_prefs, last_evening_checkin_date).

### Recently completed (2026-04-01)

- **Native app Phase 2 complete**: Push notifications, Apple HealthKit, Polar H10 BLE workout recording, and functional Plan screen all built and committed to `athlete-coach-native`. EAS project created (`61b032df-e637-47e2-9d58-70ca5df6603a`), dev build submitted to TestFlight.
- **Three new DB tables for native app**: `health_snapshots` (resting_hr, hrv_ms, sleep_hours, sleep_quality — one row per user per day), `native_activities` (full workout recording with hr/rr/gps streams), `expo_push_token` column on `athlete_settings`.
- **Recovery metrics in coaching context**: `buildContext.js` and `formatContext()` now query `health_snapshots` and surface resting HR, HRV, and sleep as a `RECOVERY METRICS` section in all coaching prompts (chat, briefing, activity feedback).
- **BLE config plugin fix**: `@config-plugins/react-native-ble-plx` only supports Expo ≤49. Both `react-native-ble-plx` and `react-native-health` ship their own `app.plugin.js` — referenced directly in `app.json`.

### Recently completed (2026-03-30)

- **Fixed enrich-activity trigger not firing on upsert (Fix 1A)**: Strava webhook uses `ON CONFLICT (strava_id) DO UPDATE`, which takes the UPDATE path in Postgres. The old `AFTER INSERT` trigger never fired for existing activities. Replaced with `AFTER INSERT OR UPDATE` trigger (`trigger_enrich_activity`) that only fires when `enrichment_status = 'pending'` — prevents infinite loops when enrichment itself updates the row. Also updated `enrich-activity` edge function to accept both `INSERT` and `UPDATE` payloads.
- **Added per-km splits to coaching context (Fix 1B)**: `buildContext.js` now fetches `raw_data` and `enrichment_status` in the activities query. `formatContext()` includes per-km split lines (`km1: 4:32 @152bpm | km2: ...`) when `raw_data.splits_metric` is present. Coaching memory limit raised from 3 to 5 and category labels added (`[Run feedback]`, `[Baseline analysis]`, `[Chat]`).
- **Sport preferences editable post-onboarding (Fix 2)**: Added a dedicated "Sport Preferences" section to Settings (between Personal and Goals & Races). Shows active sports with priority badges and an "Edit sports & priorities" button that opens the existing `SportsPriorities` overlay. Sports list refreshes after the overlay closes.
- **Daily brief reflects actuals not just plan (Fix 3)**: `buildContext.js` now fetches last 7 days of scheduled_sessions (with status) and includes a "LAST 7 DAYS — PLANNED vs ACTUAL" section in `formatContext()`. `daily-briefing` edge function also queries this data and the system prompt explicitly instructs Claude to reference actual completions and call out missed sessions.

### Recently completed (2026-03-24)

- **Fixed enrich-activity pipeline (critical bug)**: The Postgres trigger `trigger_enrich_activity()` was sending the raw activities row as the pg_net body (`to_jsonb(row_to_json(NEW))`). The `enrich-activity` edge function expects a Supabase webhook envelope `{type, table, record}` and has an early-exit guard `if (payload.type !== 'INSERT') return 200`. Since `payload.type` resolved to the Strava activity type (e.g. `"Run"`), the function exited immediately on every trigger-fired call — streams were never written and `enrichment_status` stayed `pending`. Fixed by updating the trigger to wrap the body: `jsonb_build_object('type', 'INSERT', 'table', 'activities', 'record', to_jsonb(row_to_json(NEW)))`.
- **Deactivated stale pg_cron jobs**: Two leftover cron jobs (jobid 1 and 2) were firing daily via pg_net — `strava-sync` at 05:15 and `daily-briefing` at 05:30 — both timing out at 5s. These were superseded by the Vercel webhook (Stage 1) and on-demand briefing generation. Removed with `cron.unschedule()`.
- **Plan screen improvements** (2026-03-23): Manual activity logging (FAB → form → saves to `activities` with `source='manual'`, writes coaching note to `coaching_memory`); delete activity modal for manual activities; unplanned activities merged into main session list at correct day slot with Unplanned badge; fixed INVALID DATE bug (`getDisplayDate()` helper normalises ISO timestamps).
- **Schema additions** (2026-03-23): `activities.source TEXT NOT NULL DEFAULT 'strava'`; `coaching_memory.activity_id` FK → `activities(id) ON DELETE SET NULL` (orphaned rows nulled).

### Recently completed (2026-03-22)

- **Two-stage webhook pipeline**: `strava-webhook.js` now Stage 1 only — write `enrichment_status='pending'`, return 200, done. No Claude calls in Vercel.
- **`enrich-activity` edge function**: triggered by Supabase DB INSERT trigger via `pg_net`. Fetches 5 Strava stream types (HR, cadence, altitude, velocity, latlng), downsamples to 10s resolution, computes `zone_seconds` / `cadence_stats` / `grade_correlation`, writes to `activity_streams`, updates `activities.zone_data` + `enrichment_status='complete'`, generates coaching feedback via Claude Haiku. Auto-triggers zone calibration every 10th activity.
- **`calibrate-zones` edge function**: `tt_5km` method uses avg HR from recent 5km effort as LTHR; `auto_detect` uses 95th percentile avg HR from hard long efforts. Stores calibrated zones in `athlete_settings.hr_zones` (% of LTHR model).
- **`src/lib/hrZones.js`**: `resolveZones()` (hr_zones > training_zones > defaults), `classifyHR()`, `zonesPromptString()`, `triggerZoneCalibration()`, `getHRZones()`.
- **Settings — ZoneCalibrationPanel**: shows zone table, source label (calibrated/manual/default), LTHR, last calibrated date, "Recalibrate zones" button.
- **Home**: `ZoneBar` now reads from `activity.zone_data` (was hardcoded 52%/31%/17%); `hrColor` thresholds use `resolveZones()`.
- **coachingPrompt.js + buildContext.js**: zones read from hr_zones → training_zones → defaults, with source note injected into prompts.
- **PostWorkoutPopup async UX**: loading state with pulse animation + basic stats while `enrichment_status='pending'`; polls every 3s; 90s timeout error state; zone bars read from `zone_data`.
- **DB trigger fix**: `trigger_enrich_activity()` was calling `net.http_post` with wrong argument types (body as text, not jsonb). Fixed to correct pg_net signature.
- **notify-feature-request edge function**: writes to `admin_notifications` table, optionally sends email via Resend API (if secrets set). Handles feature/bug/vote types.
- **Feature requests / bug reports system**: `FeatureRequestModal` with type toggle (feature/bug), Claude similarity dedup, roadmap board (`Roadmap.jsx`), `FeatureCard` with decline reason display.

### Recently completed (2026-03-20 and 2026-03-21)

- Replaced n8n Strava sync with Vercel serverless webhook (`/api/strava-webhook.js`)
- Dynamic home briefing: on-demand generation, persisted to daily_briefings table with stale detection
- Fixed briefing regression: was showing Thursday's briefing on every load (wrong DB query + missing user_id in upsert)
- Chat-to-plan: proposed changes from chat can be accepted and queued
- Check-in card: morning/afternoon session reminder with "I'm on it" button
- Backfill + baseline analysis: auto-runs on first empty load
- Plan Review Panel: iterate on generated plan before committing
- Quarterly goal prompt, cancel event, fuel context banner, delete account
- **Injury workflow**: post-run injury reporting, Claude assessment, rehab sessions auto-added to schedule; SessionDetail handles `session_type === 'rehab'` (shows exercise list, skips AI coaching call); buildContext includes active injury reports
- **Onboarding improvements**: fixed race condition loop bug (App.jsx functional state update); onboarding is now 5 steps with Strava connect at step 2; sport chips toggle off on re-click; profile completion nudge card on final step
- **Sport-agnostic fixes**: Plan.jsx NaN fix for null target dates; sport-aware progress bars and metrics (running vs strength vs endurance); Stats.jsx shows session count (not km) for non-runners; empty state when no Strava data
- **Plan generator fix**: robust JSON fence extraction when Claude wraps response in markdown; sport context added to generation prompt
- **Nutrition enhancement**: manual time picker (Vienna tz); Claude now parses and saves `fibre_g`, `sodium_mg`, `upf_score` (NOVA 0–3); WeeklyDigest component with daily averages, trend arrows, UPF dot strip, post-run protein flag, streak badges; DB migration applied (logged_at, fibre_g, sodium_mg, upf_score columns)

---

## ARCHITECTURE IN PLAIN LANGUAGE

### Stack

- **Frontend**: React + Vite SPA, deployed to Vercel (https://athlete-coach-alpha.vercel.app)
- **Backend**: Supabase — Postgres database, email/password auth, edge functions (Deno/TypeScript)
- **AI**: Claude Haiku (claude-haiku-4-5-20251001) via Supabase `claude-proxy` edge function
- **Automation**: Vercel serverless function (replaces n8n for Strava)

### Where data lives

Everything in Supabase (project: yjuhzmknabedjklsgbje). No other persistent stores.

### How AI calls work

All Claude calls from the React frontend go through a Supabase edge function called `claude-proxy`, which holds the Anthropic API key. The frontend sends its Supabase session JWT. The Vercel serverless function (webhook) also routes through `claude-proxy` using the service role key.

Some Supabase edge functions (infer-athlete-context, daily-briefing) call the Anthropic API directly since they have direct access to secrets.

### How automation works currently

**Two-stage pipeline:**
1. **Stage 1 (Vercel)**: `strava-webhook.js` receives Strava event, fetches the activity, upserts to DB with `enrichment_status='pending'`, returns 200 immediately (must be fast — Strava times out at ~2s).
2. **Stage 2 (Supabase)**: A Postgres trigger (`trigger_enrich_activity`) on `activities INSERT` calls `net.http_post()` (pg_net extension) to invoke the `enrich-activity` edge function asynchronously. This fetches Strava streams, computes stats, writes to `activity_streams`, generates Claude feedback, updates `enrichment_status='complete'`.

The frontend polls `enrichment_status` every 3s in `PostWorkoutPopup` and transitions from loading → full feedback state.

n8n is no longer needed for activity sync. Daily briefings are generated on demand from the app, not by a scheduled job.

### Dependencies being removed

- **n8n**: both workflows are superseded. Still active but can be deactivated.

---

## DATABASE SUMMARY

### Active tables

| Table | Purpose |
|-------|---------|
| `activities` | All Strava activities (runs, rides, etc.) |
| `athlete_settings` | Single row per user — profile, coaching preferences, inferred fields |
| `athlete_sports` | Multi-sport: one row per sport, with priority + lifecycle state |
| `scheduled_sessions` | Training plan sessions (planned/completed/missed) |
| `schedule_changes` | Proposed plan changes (from chat or mismatch detection) |
| `coaching_memory` | Coaching history: chat exchanges, activity feedback, baseline analysis |
| `daily_briefings` | One briefing per day — generated on demand, persisted for reuse |
| `nutrition_logs` | Food and alcohol entries |
| `cycle_logs` | Daily cycle tracking entries (opt-in) |
| `strava_tokens` | Per-user Strava OAuth tokens |
| `plan_drafts` | Claude-generated plan drafts pending review |
| `activity_streams` | Per-activity 10s-downsampled stream data (HR, cadence, altitude, velocity, latlng) + zone_seconds, cadence_stats, grade_correlation |
| `feature_requests` | User-submitted feature requests and bug reports |
| `feature_votes` | Votes on feature requests |
| `feature_notifications` | Notifications to users when voted features ship |
| `admin_notifications` | Feature request / bug report submissions for admin review |
| `app_releases` | Version history for release notes popup |

### Partially / rarely used

| Table | Status |
|-------|--------|
| `training_plan` | Template sessions for plan generation — may be empty |
| `workout_logs` | Written by WorkoutIngest — schema not fully confirmed |

### Recent schema additions

- `activities.enrichment_status TEXT` — `pending|processing|complete|failed`; historical rows backfilled to `complete` (added 2026-03-22)
- `athlete_settings.hr_zones JSONB` — calibrated zone boundaries from `calibrate-zones` edge function; schema: `{ source, calculated_at, threshold_hr, zones: { z1:{min,max}, ... } }` (added 2026-03-22)
- `activity_streams` table — entire table (added 2026-03-22); see `/docs/streams.md` for full schema and computed field docs
- `feature_requests`, `feature_votes`, `feature_notifications`, `admin_notifications`, `app_releases` — feature request system (added 2026-03-21)
- `athlete_settings.hints_dismissed` JSONB — onboarding hint dismissal state (added 2026-03-21)
- `athlete_settings.last_seen_version` TEXT — for release notes popup (added 2026-03-21)
- `athlete_settings.subscription_tier` TEXT — default `'founder'` (added 2026-03-21)
- `athlete_settings.training_zones` JSONB — manually editable 5-zone HR boundaries (added 2026-03-21)
- `athlete_settings.health_flags` JSONB array — active/monitoring injury flags injected into coaching context (added 2026-03-21)
- `athlete_settings.onboarding_complete` BOOLEAN — added to fix onboarding loop; backfilled TRUE for all existing users (added 2026-03-21)
- `nutrition_logs.logged_at` TIMESTAMPTZ — manual timestamp from time picker (added 2026-03-21)
- `nutrition_logs.fibre_g` NUMERIC — dietary fibre parsed by Claude (added 2026-03-21)
- `nutrition_logs.sodium_mg` INTEGER — sodium parsed by Claude (added 2026-03-21)
- `nutrition_logs.upf_score` INTEGER — NOVA ultra-processed food score 0–3 (added 2026-03-21)
- `athlete_settings.last_goal_prompt_date` — prevents quarterly goal prompt repeating (added 2026-03-20)
- `scheduled_sessions.planned_start_time` — set when athlete taps check-in card (added 2026-03-20)
- `athlete_settings.onboarding_nudges_sent` — tracks progressive onboarding nudges (added 2026-03-18)
- All `athlete_settings.cycle_*` columns — menstrual cycle tracking (added 2026-03-18)
- `athlete_sports` table — entire table, multi-sport support (added 2026-03-18)

### Key data relationships

- `activities` ← strava_id unique key (BIGINT), user_id for RLS
- `activity_streams` has `activity_id BIGINT FK → activities(id)`, unique on `activity_id`
- `coaching_memory` has `activity_id` FK linking feedback to activities (stored as BIGINT matching strava_id)
- `schedule_changes` has `original_session_id` FK to scheduled_sessions
- `daily_briefings` is upserted per `(user_id, date)` — one per day

---

## SCREENS AND FEATURES

### Home

Dynamic dashboard with three time-based layouts (morning / afternoon / evening, using Europe/Vienna timezone). Shows today's briefing (refreshable, persisted to DB), scheduled sessions, live activity feed, nutrition summary, weekly stats strip, and an AI-generated evening readiness note.

Coaching briefing: user-triggered on demand, persisted so it survives page reloads. Shows as stale if it's from a previous day.

Check-in card: appears in morning/afternoon if there's a planned session and no activity yet. "I'm on it" records a planned_start_time.

### Plan

Week-view calendar (Mon–Sun). Shows planned sessions vs completed activities. Mismatch detection proposes changes when the schedule diverges from reality. Athletes can browse pending coach proposals and accept/reject them. Can trigger a full plan rebuild (AI-generated from race context and training history).

### Chat

Conversational interface with full coaching context injected (activities, sessions, nutrition, cycle phase, briefing). Quick question pills adapt to goal_type. Coach can propose training changes mid-conversation that the athlete accepts inline. All exchanges saved to coaching_memory.

### Fuel

Nutrition logging. AI parses free-text or image descriptions of meals into macros (calories, protein, carbs, fat, fibre, sodium, UPF score). Manual time picker lets entries be backdated within the same day (Vienna timezone). Shows 7-day graph, alcohol tracking, cycle phase tips, training context banner, and a WeeklyDigest panel with daily averages, week-on-week trend arrows, UPF dot strip, post-run protein flag, and streak badges.

### Progress

Toggle: Macro (monthly overview, by goal type) vs Micro (event-specific phase progress and compliance). Personal bests derived from activity data.

### Recently added (2026-03-22)

- **Two-stage webhook + activity streams**: Stage 1 (Vercel, fast) → Stage 2 (Supabase enrich-activity edge function, async via DB trigger). Streams, zone_seconds, cadence_stats, grade_correlation all computed automatically.
- **Zone calibration system**: calibrate-zones edge function, ZoneCalibrationPanel in Settings, dynamic zone thresholds everywhere (Home ZoneBar, coachingPrompt, buildContext)
- **PostWorkoutPopup async UX**: loading state while enrichment pending, polls enrichment_status, shows full feedback with zone bars once complete
- **Feature requests / bug reports**: roadmap, bug/feature modal, Claude similarity dedup, admin_notifications, notify-feature-request edge function
- **HR Zones on Home**: now reads from zone_data — no longer hardcoded

### Recently added (pre-2026-03-22)

- **n8n replacement**: Vercel serverless webhook + on-demand briefings
- **Backfill + baseline analysis**: auto-syncs Strava history on first load, generates Claude baseline
- **Plan Review Panel**: review/iterate on AI plan before committing
- **Chat-to-plan**: accept training changes directly from chat
- **Check-in card**: session reminder with action button on Home
- **Quarterly goal prompt**: appears if no races set for 90+ days
- **Post-event modal**: lifecycle transition prompt when race date passes
- **Multi-sport coaching**: separate lifecycle state per sport
- **Cycle tracking**: opt-in, affects coaching tone and suggestions
- **Tier-2 nudges**: progressive onboarding questions in Chat header
- **Injury workflow**: post-run injury report → Claude assessment → auto-added rehab session; SessionDetail handles rehab type; coaching context includes active injuries
- **Onboarding v2**: 5-step flow, Strava at step 2, sport chip toggle, race condition fix, profile nudge
- **Sport-agnostic UI**: Plan and Stats screens adapt metrics to sport type (runner vs strength vs endurance)
- **Nutrition v2**: extended nutrient parsing (fibre/sodium/UPF), manual timestamps, WeeklyDigest with streaks and trend arrows

---

## UPCOMING / IN PROGRESS

### Pending actions (not yet confirmed done)

- Deactivate n8n workflows manually at https://lifeassistant.app.n8n.cloud (the pg_cron replacements are now also removed — n8n is the only remaining active duplicate)
- Verify plan commit flow (draft → scheduled_sessions) end-to-end
- Persist evening readiness note to DB instead of localStorage only
- Run zone calibration for the first time (Settings → Training Zones → Recalibrate zones) to populate `athlete_settings.hr_zones`
- Consider bulk re-enrichment of pre-pipeline activities (those with `enrichment_status='complete'` but `zone_data IS NULL`) if stream history is wanted — requires calling enrich-activity for each strava_id manually

### Phase 2: push notifications (native app)

`lib/notifications.ts` currently stores pending state in AsyncStorage. All calling code is already abstracted behind stable function signatures. Phase 2 replaces the internals with `Expo Notifications.scheduleNotificationAsync()`:

- `notifyActivityReady` → schedule a local notification (fires immediately, or after a short delay once the activity enriches)
- `scheduleEveningCheckin` → `trigger: { seconds: hoursAfter * 3600 }` from activity end time
- Requires a permission request flow on first launch (add to `app/_layout.tsx` after session resolves)
- The `TODO Phase 2:` comments in `lib/notifications.ts` mark the exact insertion points

### Open questions

- Should calorie/protein targets (2800kcal / 150g) be derived from athlete_settings rather than hardcoded?
- Is there an n8n API key saved anywhere? (Not confirmed — manual deactivation via UI may be needed)
- Email notifications for feature requests: Supabase SMTP is auth-only; would need Resend API key (`RESEND_API_KEY` secret) for transactional email from `notify-feature-request`. Currently DB-only (`admin_notifications` table).

---

## CREDENTIALS REFERENCE

> Do not store actual key values in this document. Find values in Vercel project settings, Supabase project settings, or Claude Code's memory file at `/Users/richardstow/.claude/projects/-Users-richardstow/memory/project_athlete_coach.md`.

| Credential | Where stored | Notes |
|------------|-------------|-------|
| Supabase service role key | Vercel env: `SUPABASE_SECRET_KEY` | Also in Supabase dashboard. Never expose to client. |
| Supabase anon key | Vercel env: `VITE_SUPABASE_KEY` | Public, safe to expose. RLS enforces access. |
| Anthropic API key | Supabase secret: `ANTHROPIC_API_KEY` | NOT in Vercel. Only in Supabase edge function secrets. |
| Strava client ID | Vercel env: `STRAVA_CLIENT_ID` + Supabase secret | App-level credential |
| Strava client secret | Vercel env: `STRAVA_CLIENT_SECRET` + Supabase secret | App-level credential |
| Strava refresh token | Vercel env: `STRAVA_REFRESH_TOKEN` | Single-user long-lived token. If revoked, must update manually. |
| Strava verify token | Vercel env: `STRAVA_VERIFY_TOKEN` | Static value: `athletecoach2026` |
| Supabase PAT | Claude Code memory only | For Management API access. Rotates periodically. |

### Credentials that may need attention

- `STRAVA_REFRESH_TOKEN` (Vercel): single-user token. Strava refresh tokens can be invalidated if the athlete disconnects or re-authorises. If the webhook stops processing activities, check this first.
- `VITE_ANTHROPIC_KEY` (Vercel): currently unused but set. Can be removed.

---

## TECHNICAL CONTEXT FOR CLAUDE AI

> **Note (2026-04-04):** Active development is now on the **React Native app** at `/Users/richardstow/athlete-coach-native`. The web app (`/Users/richardstow/athlete-coach`) is feature-frozen; these docs apply to the Supabase backend and web-app architectural context, which is shared with the native app.

When writing instructions for Claude Code to build features in this app:

- **Date handling**: always use `timeZone: 'Europe/Vienna'` in all `toLocaleDateString` / `toLocaleString` calls. The app is always used in Vienna time.
- **Auth**: Supabase client auth. All table queries are RLS-scoped to `auth.uid()` automatically. Service role is only used in Vercel serverless and Supabase edge functions.
- **AI calls from client**: use `callClaude()` from `src/lib/claudeProxy.js` — this wraps `supabase.functions.invoke('claude-proxy')`.
- **Coaching context**: use `buildContext()` + `formatContext()` from `src/lib/buildContext.js` for any new AI feature that needs athlete data.
- **Multi-user**: each user has their own row in `strava_tokens` (unique on `user_id`). The Strava webhook routes by `owner_id` (Strava athlete ID) — `getUserForStravaAthlete()` looks up the correct user and fetches/refreshes their token from the table. No hardcoded user IDs anywhere. RLS scopes all client-side queries to `auth.uid()` automatically.
- **Models**: all Claude calls use `claude-haiku-4-5-20251001`. Use Sonnet only if quality is clearly insufficient.
- **Nested component anti-pattern**: do NOT define React components inside other components. Use plain render helper functions called as `{renderSomething()}` instead.
- **Supabase service role key**: stored as `SUPABASE_SECRET_KEY` in Vercel (non-VITE). Not available in client-side code.
- **Vercel async**: Vercel serverless functions are killed after the response is sent. All async processing must be `await`ed before calling `res.json()`. The strava-webhook.js is Stage 1 only — don't add async work back into it.
- **HR zones**: use `resolveZones(settings)` from `src/lib/hrZones.js` anywhere zone thresholds are needed. Never hardcode zone boundaries.
- **enrich-activity trigger**: `trigger_enrich_activity()` in Postgres fires `AFTER INSERT ON activities` and calls `net.http_post()` (pg_net). The body MUST be wrapped as a Supabase webhook envelope: `jsonb_build_object('type', 'INSERT', 'table', 'activities', 'record', to_jsonb(row_to_json(NEW)))`. The edge function has an early-exit guard `if (payload.type !== 'INSERT') return 200` — sending the raw row causes it to read `payload.type = "Run"` and exit without processing. The trigger times out at 5000ms (the function takes ~30s) but the edge function continues running after pg_net times out — this is expected and fine.
- **activity_streams.activity_id**: is a BIGINT FK to `activities.id` (not UUID). The activities.id is a serial integer, not strava_id.
- **Supabase Management API**: `POST https://api.supabase.com/v1/projects/yjuhzmknabedjklsgbje/database/query` with PAT from memory. Use for schema changes and data queries during development — no manual Supabase dashboard steps needed.

---

*Full technical documentation is in the `/docs` folder of the GitHub repository: https://github.com/richardstow-code/athlete-coach*
