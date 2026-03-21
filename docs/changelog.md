# Changelog

---

## 2026-03-21 (batch 3)

- **Fix**: Onboarding loop — users sent back to onboarding on every refresh because the `athlete_settings` upsert was silently failing and the app checked row existence (`!settingsData`) rather than an explicit flag. Added `onboarding_complete BOOLEAN` column; `handleComplete` and `handleSkip` now set it to `true` and surface any DB errors. App.jsx checks `onboarding_complete === true`.
- **Fix**: "Skip all" tips not persisting across pages — `dismissAll()` used `.update()` which silently fails for users with no row. Changed to `.upsert()`. Same fix applied to `dismissOne()`.
- **Fix**: Tips now dismiss on click-outside (mousedown on document outside the tip card).
- **Fix**: Duplicate sports on repeated onboarding — `athlete_sports` INSERT now preceded by DELETE of existing rows for the user, preventing accumulation.
- **New**: `src/lib/sportUtils.js` — canonical sport list (11 sports + metric types) with `normaliseSport()` and `getCanonicalSport()` exports. Aliases map typos and variants to canonical keys.
- **Enhancement**: Onboarding sports step normalises input on entry; deduplication by canonical key; sport cards show canonical label.
- **Schema**: `athlete_settings.onboarding_complete BOOLEAN` — added; back-filled TRUE for all existing users
- **Schema**: `athlete_settings.id` — fixed stuck DEFAULT 1; now uses sequence starting at 4
- **Schema**: `athlete_sports.sport_key TEXT` — canonical sport key
- **Schema**: `athlete_sports.display_name TEXT` — canonical display label
- **Data**: Created `athlete_settings` rows for 2 users who had none (causing their onboarding loop)
- **Data**: Cleaned 14 duplicate `athlete_sports` rows for the test user caused by the onboarding loop

---

## 2026-03-21 (batch 2)

- **New**: `HelpBot` component — floating `?` button on all screens, opens slide-up AI panel with Claude Haiku. Screen-aware quick chips. Ephemeral (not saved to coaching_memory). Links to roadmap and feature requests.
- **New**: `OnboardingHints` component — per-screen hint cards (fixed position). Dismissal persisted to `athlete_settings.hints_dismissed`. 'Skip all' dismisses all hints at once. Reset link in Settings → Personal.
- **New**: `ReleaseNotes` component — version comparison popup on app load. Reads `app_releases` table, writes `athlete_settings.last_seen_version`. Includes release history modal.
- **New**: `Roadmap` screen — public feature request board grouped by status (in_dev / designing / in_review / triage / completed / declined). Completed and declined collapsed by default.
- **New**: `FeatureRequestModal` (inline in Roadmap) — submits feature requests with Claude similarity dedup. If match confidence ≥ 0.75, votes on existing request instead of creating new row.
- **Schema**: `athlete_settings.hints_dismissed` — added (jsonb)
- **Schema**: `athlete_settings.last_seen_version` — added (text)
- **Schema**: `feature_requests`, `feature_votes`, `feature_notifications` — new tables with RLS
- **Schema**: `app_releases` — new table; seeded with v1.0.0 entry
- **App.jsx**: mounts HelpBot + ReleaseNotes at root; notification badge on settings icon for unseen feature_notifications; Roadmap overlay; passes callbacks to Settings
- **Settings.jsx**: 'Reset onboarding hints' link in Personal section; 'View roadmap' + 'Request a feature' links in Subscription section

## 2026-03-21

- **Redesign**: Settings screen — full rewrite into 7 expandable accordion sections
  - Personal, Goals & Races, Training Zones, Health & Injuries, Coaching Preferences, Connected Services, Subscription
  - Per-section save buttons (not global save)
  - Training Zones: editable 5-zone HR inputs with contiguity validation (z_n+1 min = z_n max + 1)
  - Health Flags: structured add/edit/resolve flow; active/monitoring flags injected into coaching context
  - Subscription section shows tier badge ('founder'); delete account moved here
- **Schema**: `athlete_settings.subscription_tier` — added, default 'founder'
- **Schema**: `athlete_settings.training_zones` — JSONB, editable from Settings, used in coaching system prompt
- **Schema**: `athlete_settings.health_flags` — JSONB array; active/monitoring flags appear in coaching context
- **Enhancement**: `buildContext.js` — adds `health_flags` + `training_zones` to athlete_settings select; injects ACTIVE HEALTH FLAGS block into formatted context
- **Enhancement**: `coachingPrompt.js` — training zones now dynamic from `settings.training_zones` (was hardcoded)

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
