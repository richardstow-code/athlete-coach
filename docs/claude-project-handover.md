# Athlete Coach — Strategic Handover
*Last updated: 2026-03-21 (session 2).*

---

## CURRENT STATE SUMMARY

### What the app does

An AI-powered personal coaching app for a single athlete (Richard Stow, 79kg male, marathon training, sub-3:00 target at Munich Marathon 12 Oct 2026). The app:

- Automatically ingests Strava workouts via webhook and generates immediate coaching feedback
- Shows a time-aware home dashboard (morning briefing / afternoon check-in / evening summary)
- Provides conversational coaching via a Chat tab (Claude Haiku)
- Tracks nutrition with AI-assisted logging
- Manages a training plan with mismatch detection and coach-proposed changes
- Shows training progress split by goal type (macro overview / micro event detail)
- Supports multi-sport coaching with per-sport lifecycle states

### What is working reliably

- Strava webhook → activity ingestion (Vercel serverless function)
- Activity coaching feedback → coaching_memory (written on each new activity)
- Auth (email/password via Supabase)
- Chat coaching with context (buildContext layer is solid, includes active injury reports)
- Nutrition logging with AI macro + fibre/sodium/UPF parsing, manual timestamps, weekly digest
- Plan tab: week view, session status, mismatch detection, sport-aware metrics
- Onboarding flow (5-step, multi-sport — Strava connect at step 2)
- Settings: profile, sliders, race management, Strava connection
- PostWorkoutPopup after new activity
- Cycle tracking (opt-in)
- Injury reporting workflow with rehab session type in SessionDetail

### What is partially built or known to be buggy

- **HR zones on Home**: hardcoded percentages (52%/31%/17%) — not computed from actual data
- **Plan commit from draft**: generating a plan draft works; committing it to scheduled_sessions may not be fully wired in all paths (unconfirmed — verify in code)
- **Evening readiness note**: persists only to localStorage, not to DB; lost on hard refresh
- **n8n workflows**: two workflows at https://lifeassistant.app.n8n.cloud are still active but now superseded — deactivation pending
  - Daily Briefing: `Dsws6deZc9bAlXkl`
  - Strava Sync: `RNTJRELH2Mj7rQtX`
- **Zone data**: `activities.zone_data` column exists but is never populated

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

Strava webhook → Vercel serverless function (`/api/strava-webhook.js`) → Supabase DB. The function runs synchronously (must complete before returning 200 to Strava). n8n is no longer needed for activity sync. Daily briefings are now generated on demand from the app, not by a scheduled job.

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

### Partially / rarely used

| Table | Status |
|-------|--------|
| `training_plan` | Template sessions for plan generation — may be empty |
| `workout_logs` | Written by WorkoutIngest — schema not fully confirmed |

### Recent schema additions

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

- `activities` ← strava_id unique key, user_id for RLS
- `coaching_memory` has `activity_id` FK linking feedback to activities
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

### Recently added (not in March handover)

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

- Deactivate n8n workflows manually at https://lifeassistant.app.n8n.cloud
- Verify plan commit flow (draft → scheduled_sessions) end-to-end
- Populate HR zone data properly (zone_data column in activities is unused)
- Persist evening readiness note to DB instead of localStorage only

### Open questions

- Should calorie/protein targets (2800kcal / 150g) be derived from athlete_settings rather than hardcoded?
- Is there an n8n API key saved anywhere? (Not confirmed — manual deactivation via UI may be needed)

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

When writing instructions for Claude Code to build features in this app:

- **Date handling**: always use `timeZone: 'Europe/Vienna'` in all `toLocaleDateString` / `toLocaleString` calls. The app is always used in Vienna time.
- **Auth**: Supabase client auth. All table queries are RLS-scoped to `auth.uid()` automatically. Service role is only used in Vercel serverless and Supabase edge functions.
- **AI calls from client**: use `callClaude()` from `src/lib/claudeProxy.js` — this wraps `supabase.functions.invoke('claude-proxy')`.
- **Coaching context**: use `buildContext()` + `formatContext()` from `src/lib/buildContext.js` for any new AI feature that needs athlete data.
- **Single user**: this is a single-user app. `ATHLETE_USER_ID = '40cfe68e-faea-491c-b410-0093572f02d6'` is the only user.
- **Models**: all Claude calls use `claude-haiku-4-5-20251001`. Use Sonnet only if quality is clearly insufficient.
- **Nested component anti-pattern**: do NOT define React components inside other components. Use plain render helper functions called as `{renderSomething()}` instead.
- **Supabase service role key**: stored as `SUPABASE_SECRET_KEY` in Vercel (non-VITE). Not available in client-side code.
- **Vercel async**: Vercel serverless functions are killed after the response is sent. All async processing must be `await`ed before calling `res.json()`.

---

*Full technical documentation is in the `/docs` folder of the GitHub repository: https://github.com/richardstow-code/athlete-coach*
