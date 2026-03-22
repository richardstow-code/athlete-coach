# Changelog

---

## 2026-03-22 — AI Eval Test Suite

- **Two-Claude evaluator**: Haiku answers test prompts as the coaching AI; Sonnet evaluates responses against per-persona rubrics. Exits code 1 on any critical failure.
- **6 persona rubrics** in `tests/ai-eval/rubrics.js`: bodybuilder, female_cycle, injured, elite_taper, struggling, multisport.
- **18 canonical test prompts**, **35 evaluation criteria** (15 critical). Critical criteria cover: no unsafe injury advice, no sport-category confusion, no volume increase in taper, cycle phase acknowledgement, honest-not-harsh tone for struggling persona.
- **Regression detection**: compares criterion pass rates against previous archived run; prints warnings on any regression.
- **Result archiving**: `tests/ai-eval/results/[timestamp].json` — last 20 retained locally, uploaded as GitHub Actions artifacts (90-day retention) on every major-tier run.
- **GitHub Actions**: `test:ai-eval` runs in the MAJOR tier step; `latest.json` uploaded as artifact `ai-eval-results-{run_id}`.
- **npm script**: `test:ai-eval` — `node tests/ai-eval/run-eval.js`

---

## 2026-03-22 — Playwright UI Flow Tests

- **Playwright installed**: `@playwright/test` added to devDependencies; `playwright.config.js` at repo root with 60s timeout, 2 workers, screenshot/video on failure, HTML + JSON reporters.
- **10 spec files** in `tests/e2e/`: `smoke.spec.js`, `onboarding.spec.js`, `home.spec.js`, `plan.spec.js`, `chat.spec.js`, `fuel.spec.js`, `settings.spec.js`, `progress.spec.js`, `injury-workflow.spec.js`, `strava-webhook.spec.js`. Tagged `@smoke`/`@minor`/`@major` for tiered CI execution.
- **Auth helper** at `tests/e2e/helpers/auth.js`: `loginAs(page, persona)` logs in with fixed test credentials for all 6 personas.
- **Supabase test client** at `tests/helpers/supabase-test-client.js`: service-role client for direct DB verification in webhook tests.
- **`data-testid` attributes** added to all key UI elements across App.jsx, Home.jsx, Chat.jsx, Plan.jsx, Stats.jsx, Settings.jsx, Nutrition.jsx, Onboarding.jsx, TestModeBanner.jsx.
- **package.json scripts**: `test:e2e`, `test:e2e:smoke`, `test:e2e:minor`, `test:e2e:major`.
- **Action required [RICHARD]**: Create 7 test accounts in test Supabase Auth (6 personas + `newuser@test.athletecoach.app`); update `PERSONA_IDS` in `tests/seed/seed.js` to match actual auth UIDs; run `npx playwright install chromium`.

---

## 2026-03-22 — Test Infrastructure

- **Test Supabase project**: `athlete-coach-test` (project ID: nvoqqhaybhswdqcjyaws, Frankfurt region). Isolated from production.
- **Seed script** at `tests/seed/seed.js`: 6 athlete personas (bodybuilder, female_cycle, injured, elite_taper, struggling, multisport). Resets all test data on each run. Run via `npm run seed:test`.
- **GitHub Actions workflow** at `.github/workflows/test.yml`: tier detection (patch/minor/major) from changed files, Vercel preview wait, DB seed, tiered Playwright + API + AI eval test runs, PR comment on failure, artifact upload.
- **Test mode routing** in `src/lib/supabase.js`: `VITE_TEST_MODE=true` routes all DB calls to test project instead of production.
- **TestModeBanner component**: red banner fixed to bottom of screen when `VITE_TEST_MODE=true`. Never rendered in production.
- **Fixture files**: `tests/fixtures/` — Strava webhook/activity payloads, CrossFit WOD text, food image placeholders.
- **Docs**: `/docs/testing.md` — full documentation of personas, fixture files, tier logic, GitHub Secrets, and branch protection setup.
- **Action required [RICHARD]**: Add GitHub Secrets (TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, VERCEL_TOKEN) and enable branch protection on `main`.

---

## 2026-03-22 — Webhook Rearchitecture + Activity Streams + Zone Calibration

- **Part A — Webhook Stage 1 (slim)**: `/api/strava-webhook.js` now writes `enrichment_status='pending'` and returns 200 in under 5 seconds. All Claude calls and coaching_memory writes removed from Stage 1.
- **Part B — `enrich-activity` edge function**: Triggered by Supabase DB webhook on activities INSERT. Fetches 5 Strava stream types (HR, cadence, altitude, velocity, latlng), downsamples to 10-second resolution, computes zone_seconds/cadence_stats/grade_correlation, writes to `activity_streams` table, updates `activities.zone_data` + `enrichment_status='complete'`, generates coaching feedback via Claude Haiku with zone breakdown and cadence analysis. Auto-triggers zone calibration every 10th activity.
- **Part C — `calibrate-zones` edge function**: Two methods — `tt_5km` (uses avg HR of most recent 5km effort as LTHR proxy) and `auto_detect` (95th percentile avg HR from hard long efforts). `both` mode prefers TT if within 90 days. Stores calibrated zones in `athlete_settings.hr_zones` using % of LTHR model.
- **Part C — `src/lib/hrZones.js`**: `getHRZones()`, `triggerZoneCalibration()`, `resolveZones()`, `zonesPromptString()`, `classifyHR()`. Resolves effective zones: hr_zones > training_zones > defaults.
- **Part C — Settings Zone Calibration UI**: `ZoneCalibrationPanel` added to Training Zones section — shows current zone table, source label, LTHR, last updated date, "Recalibrate zones" button.
- **Part C — Hardcoded zones replaced**: Home.jsx ZoneBar display now reads from `zone_data` on last run (was hardcoded 52%/31%/17%). `hrColor` in ActivityRow now uses dynamic thresholds from `resolveZones()`. `coachingPrompt.js` reads from `hr_zones` then `training_zones`. `buildContext.js` injects zone string with source note.
- **Part D — PostWorkoutPopup async UX**: Loading state ("Analysing your run…" pulse animation + basic stats), polls `enrichment_status` every 3s, transitions to full feedback on complete, error state after 90s timeout. Zone bars now read from `zone_data`. Render helpers: `renderLoadingState`, `renderCompleteState`, `renderErrorState`.
- **Schema**: `activities.enrichment_status TEXT` — `pending|processing|complete|failed`; historical rows backfilled to `complete`
- **Schema**: `athlete_settings.hr_zones JSONB` — calibrated zone boundaries with source, calculated_at, threshold_hr
- **Schema**: `activity_streams` — new table (id UUID, user_id, activity_id BIGINT FK, strava_id, samples JSONB, zone_seconds, cadence_stats, grade_correlation, created_at); RLS enabled
- **Supabase secret**: `ENRICH_WEBHOOK_SECRET=athleteenrich2026`
- **Action required [RICHARD]**: Set up DB webhook in Supabase Dashboard → Database → Webhooks → Create: table=activities, event=INSERT, function=enrich-activity, header x-webhook-secret=athleteenrich2026

---

## 2026-03-21 (batch 5)

- **New**: Feature requests & bug reports system — full rewrite
  - `FeatureRequestModal` now has a type toggle (✨ Feature / 🐛 Bug) replacing the `isBugReport` prop
  - Feature form: title field + description field; Claude Haiku similarity dedup unchanged
  - Bug form: title + description + screen dropdown (10 app screens) + frequency chips (Every time / Often / Sometimes / Once)
  - Roadmap now only shows `type='feature'` rows — bugs tracked separately
  - `FeatureCard` shows `decline_reason` for declined cards (highlighted red block with left border)
  - Footer "🐛 Report a bug" link on Roadmap content area
  - Footer "🐛 Report a bug" link below the bottom tab bar in App.jsx
  - "Report a bug" link added to Settings → Subscription section alongside existing roadmap/feature links
  - `onOpenBugReport` prop added to `Settings` component; wired in App.jsx
- **New**: `supabase/functions/notify-feature-request/index.ts` edge function
  - Writes to `admin_notifications` first (never loses a submission)
  - Sends email via Resend API if `ADMIN_EMAIL` + `RESEND_API_KEY` secrets are set (non-fatal)
  - Handles types: `feature`, `bug`, `vote`
- **Schema**: `feature_requests.type TEXT` — `feature` | `bug`; default `feature`
- **Schema**: `feature_requests.priority TEXT` — `low` | `normal` | `high` | `critical`; default `normal`
- **Schema**: `feature_requests.decline_reason TEXT` — shown to users on roadmap
- **Schema**: `admin_notifications` — new table (id, type, title, description, submitter_email, metadata, created_at, read_at); RLS enabled (service role only)
- **Docs**: `/docs/admin-workflows.md` — triage SQL, status transitions, decline workflow, notification dispatch, table schema, edge function secrets

---

## 2026-03-21 (batch 4)

- **New**: Race elevation as a first-class training input
  - Race setup form (`Settings.jsx`) now shows "Total elevation gain (m)" field for Run, Trail Run, Bike, Skimo, Triathlon race types — optional, with help text
  - Elevation displayed in race cards: `↑ Xm` (hidden if 0/null)
  - `src/lib/elevationUtils.js` — `classifyElevation()` maps elevation+distance → flat/rolling/hilly/mountainous; `ELEVATION_TARGETS` defines weekly m/week ranges per classification
  - Plan generation (`planGenerator.js`) injects elevation classification, gain/km, and weekly elevation targets (base + peak phase) into the Claude prompt
  - Coaching context (`buildContext.js`) includes elevation in the race summary line and adds an ELEVATION TRACKING block with weekly actual vs target comparison
  - Activity feedback (`strava-webhook.js`) fetches race elevation and last-7-days activities, includes session elevation, weekly total, race profile, and on-track status in the Claude prompt; graceful fallback if fetch fails
  - Richard's Munich Marathon updated in DB to `elevation_m: 180` → classified as **flat**
- **Docs**: `/docs/features/race-management.md` created documenting elevation field, classification thresholds, and all integration points

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
