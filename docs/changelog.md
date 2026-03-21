# Changelog

---

## 2026-03-21

- **Fix**: Home screen briefing reverted to Thursday's on each reload
  - Root cause: DB query fetched most recent briefing ever (not today's); upsert lacked user_id so it failed silently under RLS
  - Fix: query now `.eq('date', todayStr).maybeSingle()`; upsert now includes `user_id`

---

## 2026-03-20

- **n8n replaced**: Both n8n workflows (Strava Sync, Daily Briefing) superseded by frontend + Vercel
- **New**: `/api/strava-webhook.js` — Vercel serverless function handles Strava webhook (GET verify + POST activity)
- **New**: `vercel.json` — sets 60s maxDuration for webhook function
- **New**: Dynamic Home briefing — user-triggered refresh, persisted to `daily_briefings` table, stale detection
- **Schema**: `athlete_settings.last_goal_prompt_date` — added for quarterly goal prompt suppression
- **Schema**: `scheduled_sessions.planned_start_time` — added, set when athlete taps check-in card
- **Fix**: UTC/Vienna timezone bug in `buildContext.js` — all date comparisons now explicit `timeZone: 'Europe/Vienna'`
- **Fix**: Chat session comprehension — system prompt now checks RECENT ACTIVITIES before treating message as planned vs completed
- **New features** (batch commit `3c2b324`):
  - Chat-to-Plan: plan changes proposed in chat can be accepted and queued
  - Check-in card: morning/afternoon reminder for planned sessions with "I'm on it" button
  - Fuel context: Nutrition tab shows pre/post-workout context banner
  - Cancel event: PostEventModal allows lifecycle transition when race date passes
  - Quarterly goal prompt: shown on Home if no races set and 90+ days since last prompt
  - Delete account: option added in Settings
- **Fix**: Strava sync upsert — `ignoreDuplicates: true` prevents overwriting enriched activity data
- **New**: Strava backfill + baseline analysis — auto-runs on first load with empty activities table
- **New**: Plan Review Panel — athlete can review and iterate on generated plan before committing
- **Strava webhook**: Deleted subscription 335891 (Supabase endpoint), registered 336117 (Vercel endpoint)
- **Vercel env vars added**: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN, STRAVA_VERIFY_TOKEN, SUPABASE_SECRET_KEY

---

## 2026-03-19

- **Fix**: Missing WorkoutIngest screen added to App.jsx navigation
- **Fix**: Strava sync, activity display, pull-to-refresh, phase week counter

---

## 2026-03-18

- **New**: Multi-sport refactor — `athlete_sports` table introduced
  - Each sport is a separate row with priority, lifecycle_state, target_date, target_metric
  - Coaching system prompt branches by primary sport category and lifecycle phase
- **New**: Onboarding flow updated for multi-sport (Step 2: sport priority selection)
- **New**: Menstrual cycle tracking (opt-in) — `cycle_logs` table, cycle tracking fields in `athlete_settings`
- **New**: `CycleLogNudge` component — daily prompt in Chat tab
- **New**: Tier-2 nudge system — progressive onboarding questions in Chat header
- **New**: Post-event modal — lifecycle transition when race date passes
- **New**: Progress/Stats page refactored — branches macro/micro by goal_type
- **New**: lifecycle_state coaching focus in system prompt
- **New**: Sign up / forgot password on auth screen
- **Fix**: RLS migrations — `athlete_settings` properly scoped to user_id
- **Fix**: All hardcoded user data removed — all reads use athlete_sports

---

## 2026-03-17

- **New**: Strava OAuth flow — connect from Settings, exchange token via edge function
- **New**: `claude-proxy` edge function — proxies Anthropic API from frontend
- **New**: Auth flow — login/signup in App.jsx
- **New**: Plan mismatch detection — compares planned vs actual, auto-proposes changes
- **New**: Change approval flow — bottom-sheet modal for proposed changes
- **New**: Plan tab can tap sessions to open SessionDetail
- **Refactor**: Progress/Stats page introduced (macro/micro toggle)
- **Refactor**: Unified AI context layer (`buildContext` + `formatContext`)

---

## 2026-03-16 and earlier

- Initial builds: Home nutrition snapshot, Stats PBs with click-through
- Plan.jsx: session click, Mon-Sun sort
- Fuel tab: context-aware training banner, image upload for daily summary
- Plan.jsx: locked completed sessions, mismatch detection
- SessionDetail: workout plan display
- Various fixes: race save, coach input, blank screen issues

---

_Append a new `## YYYY-MM-DD` section at the top after each build session._
