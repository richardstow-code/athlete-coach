# Changelog

## 2026-06-09

### analyze-activity — load athlete RPE/feel + active injuries (data-complete)

Activity Detail QA showed Path A marking RPE "not available" on an activity that HAS `rpe=2`, and the older prose Take (now removed from the screen) was the only block citing the athlete's RPE + active injury — so the tidy-up shipped this data fix in the same pass to avoid losing information.

- **Subjective data:** `api/analyze-activity.js` SELECT now includes `feel` (already loaded `rpe`, `feel_legs`, `injury_flag`); the prompt passes raw `rpe`/`feel`/`feel_legs` as RAW inputs (no computed feel/effort score — the RAW-RPE rule interprets them against the planned session intensity). Audit gains `has_feel`, `has_feel_legs`; `prompt_data_completeness.has_rpe` now reports `true` when rpe is present (and `rpe` is not listed in `not_available`).
- **Active injuries:** loads from `injury_reports` under a **status-based rule** — surface `status='active'` REGARDLESS of `follow_up_due_date`, flagging `follow_up_overdue` and noting "follow-up overdue since <date>" (an active injury past its follow-up is the most important to surface, not silently drop). New INJURY-AWARE system rule; audit gains `has_active_injuries` + `active_injury_count`.
- **⚠️ Divergence flagged:** `enrich-activity` still filters injuries by `follow_up_due_date >= today` (a different rule) — so its briefing feedback can drop an overdue-but-active injury that the analysis now surfaces. Aligning `enrich-activity` to the status-based rule is a fast-follow (not in this pass).
- Tests: `tests/api/analyze-activity.test.js` (+4: `has_rpe=true` on the id-333 shape, `rpe` not in `not_available`, injuries audited, prompt surfaces injuries + raw rpe/feel — 31 total); `tests/ai-eval/analyze-activity-eval.js` data-rich fixture adds `rpe_loaded_has_rpe_true` / `rpe_not_in_not_available` (eval 3/3).

### Path A — go-live complete

- Both branches merged (web `main` `bef4b8b`; native `main`). `ANALYZE_ACTIVITY_SECRET` wired on both Vercel (Production) and the Supabase trigger side. `trigger_analyze_activity` created and live (AFTER UPDATE → `enrichment_status='complete'`, fire-and-forget pg_net POST `{ activity_id }` + `x-analyze-secret`). Architect verified one real activity end-to-end: sync → enrichment → trigger → `analyze-activity` → `coach_analysis` populated (`generation_status='ok'`, `prompt_data_completeness` audited, no fabrication) → renders on Activity Detail + Coach's Take. iOS build **v1.5.0 (30)** submitted to TestFlight (native repo).

### analyze-activity@v1.1 — fix JSON truncation (parse_failed on data-rich activities)

- **Bug:** on a data-rich activity (e.g. id 333 — HR zones + 14 splits + 424-sample stream + planned session) the Haiku output hit `max_tokens` and was cut off mid-string → `JSON.parse failed: Unterminated string` → `generation_status='parse_failed'`, `coach_analysis` stayed NULL (fail-closed, correct — but nothing rendered). Original `max_tokens` was **1200**.
- **Fix (`api/analyze-activity.js`, `api/` only):**
  - `max_tokens` 1200 → **2500** (full bounded schema worst-case ~1k output tokens + ~2x headroom).
  - **Trimmed prompt input to aggregates**: stopped sending the 140 downsampled raw stream samples; the prompt now sends HR-zone distribution (min + %), cadence avg+trend, grade correlation, and a compact splits summary (idx/km/pace/HR, capped 16) — mirroring the enrich-activity coaching prompt. Less input → lower latency and smaller output.
  - **JSON-only enforcement**: system prompt now says "Output ONLY a single complete, valid JSON object … no fence", with explicit per-field character caps so a complete object fits the budget; generation prefills the assistant turn with `{`.
  - **One retry** on parse failure (then unchanged fail-closed: record `generation_status='parse_failed'` + `parse_error`, write no `coach_analysis`).
  - `parseAnalysisJSON` made robust to trailing tokens after the object. Audit `prompt_version` → `analyze-activity@v1.1`.
- **Test:** `tests/ai-eval/analyze-activity-eval.js` gains a `data_rich_full_metrics_no_truncation` fixture (the id-333 shape) asserting `generation_status` would be ok — a complete object with every top-level key parses (regression guard). Eval green (3/3 fixtures); 27 endpoint unit tests green.

### Path A — automatic per-activity AI analysis

- **`api/analyze-activity.js`** (new Vercel function): generates a structured, multi-sport `coach_analysis` from the FULL detailed activity data (streams, splits, zones, cadence) when enrichment completes, and writes it back onto the activity. Auth via `x-analyze-secret` (`ANALYZE_ACTIVITY_SECRET`), service-role reads/writes. Idempotent with a dual-source dedup guard (skips `exists` / `incomplete` / `dup`). Builds the athlete-state snapshot inline from base tables (no `athlete_state_snapshot` view). STRICT-JSON Haiku output with NEVER-FABRICATE (explicit NOT AVAILABLE list), raw RPE (no computed feel score), HR data-quality guard, and tag-mismatch surfacing. Stores a `prompt_data_completeness` audit; on parse failure leaves `coach_analysis` null for retry and returns 5xx.
- **`activities` schema**: added `coach_analysis` (jsonb), `coach_analysis_generated_at`, `coach_analysis_model`, `coach_analysis_version`, `prompt_data_completeness`. New trigger `trigger_analyze_activity` (`AFTER UPDATE` on transition to `enrichment_status='complete'`) fire-and-forget POSTs `{ activity_id }` to the endpoint.
- **Tests**: `tests/api/analyze-activity.test.js` (pure guard-logic unit tests + live auth/method wiring smoke); `tests/ai-eval/analyze-activity-eval.js` + `npm run test:ai-eval:analyze` (fabrication detector — asserts no claim about NOT AVAILABLE metrics, reads the planned session, no invented splits/zones, and flags a Z2-run-tagged-tempo fixture).
- **Native** (`athlete-coach-native`): activity-detail screen renders the full structured report (`renderCoachAnalysis` in `app/activity/[id].tsx`); feed card (`components/ActivityCard.tsx`) shows headline + top flag. Pure helpers + states in `lib/coachAnalysis.ts`. Handles pending / generating / present / failed.

### enrich-activity: soft-deleted streams never read (78d16ed2 / AC-153)

- **`supabase/functions/enrich-activity/index.ts`** (the canonical copy lives in the **native** repo — the web-repo copy is a stale March fork with no stream reads): added `.eq('is_deleted', false)` to all three `activity_streams.select(...)` reads (the enrichment-score count + two `samples` reads for splits reconstruction), matching the predicate in `api/analyze-activity.js`. Prevents a soft-deleted stream row from being read into enrichment/splits, and prevents the `.maybeSingle()` "multiple rows" error when a live + soft-deleted row coexist. Source-level guard `ac-153-soft-delete-cascade` now green.
- **Test**: `tests/api/enrich-activity-soft-delete.test.js` — gated on `TEST_SUPABASE_FUNCTIONS_URL`; seeds a live + a soft-deleted stream row and asserts enrichment reads only the live row.

### Coach's Take (prose) now renders on Activity Detail (693ada6a)

- **`app/activity/[id].tsx`** (native): the prose Coach's Take stored in `coaching_memory` (the `memory` state) was fetched but never rendered, so a written take was invisible on activities without intervals data (e.g. manual logs). Added `renderCoachsTake()` — a white-card render distinct from the structured `coach_analysis` card. To avoid duplicating the take when the intervals-backed `analysisSummary` already shows it inside `renderTrainingAnalysis`, it renders only when `analysisSummary` is absent. Empty state is quiet (renders nothing). Smoke-pinned in `__tests__/coachAnalysisRender.test.ts`.

## 2026-04-05

### Native app: HealthKit → Supabase pipeline

- **`lib/healthKitSync.ts`**: new file — `runHealthKitSync(userId)` pulls 6 months of workout and passive metric history from HealthKit into Supabase on first launch. Workouts are gap-filled into `activities` (source='healthkit', dedup by date+type vs existing Strava rows). Passive metrics (resting HR, HRV, sleep, steps) written to new `health_metrics` table.
- **`health_metrics` table**: created with RLS, unique constraint on `(user_id, metric_type, date)`, indexes on `(user_id, date)` and `(user_id, metric_type, date)`.
- **`activities` schema**: added `source TEXT DEFAULT 'strava'` and `healthkit_uuid TEXT` (unique index WHERE NOT NULL).
- **`athlete_settings` schema**: added `healthkit_sync_enabled BOOLEAN` and `healthkit_last_synced_at TIMESTAMPTZ`.
- **`app/(tabs)/index.tsx`**: `useEffect([userId])` calls `runHealthKitSync` once per session after auth confirmed. Silent background — no spinner, no user-visible error.
- **`buildContext.js`** (web app): added `health_metrics` query (last 30 rows) to `buildContext()`; added `HEALTH METRICS` section to `formatContext()` showing 7-day avg resting HR, latest HRV, last night's sleep, yesterday's steps.

### Web app: multi-user support

- **Removed hardcoded `ATHLETE_USER_ID`**: `api/strava-webhook.js` now routes by Strava `owner_id` → `strava_tokens` table. Per-user token fetch and auto-refresh. No env-var refresh token.

### Web app: multi-user support

- **Removed hardcoded `ATHLETE_USER_ID`**: `api/strava-webhook.js` no longer contains a hardcoded user UUID or uses `STRAVA_REFRESH_TOKEN` from env vars
- **Per-user token routing**: `getUserForStravaAthlete(stravaAthleteId)` looks up `strava_tokens` by `athlete_id` (Strava's `owner_id`); `getStravaTokenForUser(tokenRow)` checks expiry, auto-refreshes, and updates the table — one function per user
- **`buildActivityRow(activity, userId)`**: now takes `userId` as an explicit parameter instead of closing over a constant
- **Graceful unknown-user handling**: if no `strava_tokens` row exists for an `owner_id`, the webhook logs and returns without writing a broken row (Strava will retry)
- **No frontend changes required**: `buildContext.js` was already RLS-clean; no `ATHLETE_USER_ID` references existed outside `api/strava-webhook.js`
- **`STRAVA_REFRESH_TOKEN` Vercel env var**: now unused — can be removed from Vercel dashboard (Settings → Environment Variables)

## 2026-04-04

### Native app: Plan tab — 5 bug fixes

- **Week boundary (Mon–Sun)**: `getWeekRange()` now uses Monday as the first day of the week (`daysToMonday = dow === 0 ? -6 : 1 - dow`). Sunday is now correctly part of the current week, not the next. Display changed from "29 Mar – 4 Apr" to "30 Mar – 5 Apr".
- **Schedule change approval**: `acceptProposal` now sets `schedule_changes.status = 'applied'` (was `'accepted'`). The DB update to `scheduled_sessions.planned_date` was already correct; only the status value was wrong, which prevented the change from being marked done.
- **Teal as primary accent**: all uses of `theme.colors.accent` (purple) in Plan screen replaced with `theme.colors.primary` (teal) — session card borders, today indicator dot, today row background, proposal card borders, Accept/Submit/Send buttons. `theme.colors.accentMuted` → `primaryMuted` for today row highlight. Same fix applied to `ObjectivesHeader` countdown numbers and settings link.
- **Text contrast on coloured backgrounds**: text/icon colors changed from `#000` to `#fff` on all teal backgrounds — user chat bubble text, Apply/Accept/Submit button labels, chat send button icon/spinner, request submit spinner.
- **Base build progress (0% → ~33%)**: `computeTrainingPhase` now accepts an optional `planStartDate`. For the Base Building phase: `totalWeeks = weeksToRaceAtStart - 20` and `weeksElapsed = weeksToRaceAtStart - weeksRemaining`, giving correct elapsed percentage. Fixed the same formula bug for Build/Peak/Taper phases (all were calculating elapsed as 0). `ObjectivesHeader` now fetches `MIN(planned_date)` from `scheduled_sessions` and passes it as `planStartDate`.

### Native app: HealthKit completion

- **Debug logging**: `[HealthKit]` prefixed console logs added to `initHealthKit`, `getRestingHR`, `getHRV`, `getSleep`, `getSteps`, `getActiveCalories`, and `syncHealthSnapshot` — logs raw results before transformation and final payload before upsert; also calls `AppleHealthKit.isAvailable` after init for diagnostics
- **Foreground sync**: `syncHealthSnapshot()` is now called from the AppState `'active'` handler in `app/(tabs)/index.tsx`, so health data refreshes every time the app comes back to the foreground
- **Steps + Active Calories**: added `Steps` and `ActiveEnergyBurned` to HealthKit read permissions; new `getSteps()` function reads today's step count (iPhone accelerometer, no Watch required); new `getActiveCalories()` sums `ActiveEnergyBurned` samples for the day; both included in `syncHealthSnapshot` Promise.all and upsert payload
- **Schema additions**: `health_snapshots.steps INTEGER`, `health_snapshots.active_calories INTEGER`, `health_snapshots.source TEXT DEFAULT 'apple_health'` (migration applied to production)
- **RecoveryStrip fallback**: strip now always shows RHR / HRV / Sleep columns with `–` when values are null, instead of hiding entirely; steps and active_calories columns appear dynamically when data is available; null values render in muted colour
- **wearable_connections table**: created with columns `user_id`, `provider`, `status`, `connected_at`, `last_sync_at`, `metadata`; RLS enabled; upserts Apple Health connection record on every successful `initHealthKit`; updates `last_sync_at` after each successful `syncHealthSnapshot`
- **Briefing context**: steps and active_calories injected into daily briefing prompt and coach chat context when available
- **Code comment**: `lib/healthkit.ts` now has a top-level comment explaining Apple Health data requirements (Watch needed for RHR/HRV/Sleep; iPhone accelerometer suffices for Steps/Calories)

### Native app: targeted fixes (Fix 1–5)

- **Coach feedback position**: moved above HR zone bar in activity detail screen (order: stats → coach feedback → zone bar → charts)
- **HR chart smoothing**: invalid HR values (null / ≤0 / ≥250) filtered before rendering; path rebuilt using cubic bezier `C` commands; data gaps >30s lift the pen (`M`) instead of drawing through the gap — applies to all zone-coloured segments
- **Plan tab: completed activity tap**: session chips with a matched activity now navigate to `/activity/[id]` instead of `/session/[id]`
- **Session compliance timezone fix**: `activityLocalDate()` in plan.tsx now converts to Europe/Vienna via `toLocaleDateString('en-CA', { timeZone })` instead of slicing the first 10 chars — fixes late-evening activities being assigned the wrong day
- **Progress — weekly compliance**: `WeeklyComplianceChart` now cross-references activities against session dates (Vienna TZ) instead of relying solely on `status === 'completed'`; compliance bars now show actual completions even when session status hasn't been updated
- **Activity trend chart — zone data**: `zone_data: null` activities are skipped when summing zone seconds; Zones view shows "Zone data will appear after your next synced run" empty state when no zone data exists
- **coaching_memory 400 fix**: inserts in `activity/[id].tsx`, `activity-capture.tsx`, and `evening-checkin.tsx` now include `source` and `date` fields, matching the schema required by the table

### Native app: SVG chart redesign

- **`constants/Colors.ts`**: New shared palette file — Txture brand teal (#0C8C82 light, #17C1B5 dark), zone colours, semantic tokens. All new components reference this instead of inline hex strings.
- **`ActivityTrendChart`** rewritten with `react-native-svg`: cubic bezier line chart (weekly volume), stacked bar chart (zone distribution). `onLayout` pattern for dynamic width; Vienna-timezone week bucketing via `getViennaMonday()`.
- **`components/ActivityCharts/HeartRateChart`**: elevation silhouette (filled, 15% opacity) + zone-coloured HR line segments + dashed zone threshold lines at 120/140/155/170 bpm. Coach note with teal left border.
- **`components/ActivityCharts/PaceChart`**: elevation silhouette background + teal pace line (breaks on stops ≤0.2 m/s) + inverted Y-axis (fast pace at top). Formats as mm:ss.
- **`components/ActivityCharts/ElevationChart`**: teal-tinted filled area + total gain overlay badge.
- **Activity detail screen** (`app/activity/[id].tsx`): replaced `MultiMetricChart` with three separate `CollapsibleCard` sections (Heart Rate / Pace / Elevation), each defaultOpen=false.

### Native app: post-activity subjective capture flow

- **`lib/notifications.ts`**: AsyncStorage-backed pending state for post-activity capture and evening check-in. Phase 2 ready — `TODO` comments mark where `Expo Notifications.scheduleNotificationAsync()` will be inserted. Functions: `notifyActivityReady`, `getPendingCapture`, `clearActivityCapture`, `scheduleEveningCheckin`, `getPendingEveningCheckin`, `clearEveningCheckin`.
- **`app/activity-capture.tsx`**: 4-step full-screen modal — injury flag (auto-advance) → leg feel (auto-advance) → RPE slider → optional notes. On submit: saves to `activities`, calls `claude-proxy` (250 tokens), parses numbered sections + optional `RESCHEDULE PROPOSAL:`, saves to `coaching_memory`, schedules evening check-in. Coaching result screen shows Recovery / Fuelling / Sleep / Tomorrow cards with coloured left borders; reschedule card with Accept (inserts to `schedule_changes`) / Not now.
- **`app/evening-checkin.tsx`**: Lightweight modal — injury feel (better/same/worse, only shown when `injury_flag ≠ 'nothing'`) + refuel confirmation. On submit: saves `evening_checkin_data` JSONB, updates `last_evening_checkin_date`, writes `injury_escalation` to `coaching_memory` if worse, clears AsyncStorage flag.
- **Home screen** (`app/(tabs)/index.tsx`): checks `getPendingCapture` and `getPendingEveningCheckin` on mount and on AppState `active`; renders teal prompt card (post-activity) and amber prompt card (evening check-in) above briefing when pending.
- **Morning briefing**: injects yesterday's subjective data (RPE, leg feel, injury flag, evening check-in result) when `morning_reference_enabled` is true. Prepends `⚠️ PRIORITY:` line when injury was flagged or worsened overnight.
- **Settings screen** (`app/settings.tsx`): new "Training Notifications" section with post-activity toggle, evening check-in toggle, hours-after stepper (2h/3h/4h), morning briefing reference toggle. Saves immediately to `athlete_settings.notification_prefs`.

### Backend: schema additions (activities + athlete_settings)

- `activities.rpe INTEGER` — rate of perceived exertion (1–10)
- `activities.feel_legs TEXT` — CHECK: `fresh | normal | heavy | dead`
- `activities.injury_flag TEXT DEFAULT 'nothing'` — CHECK: `nothing | niggle | flagged`
- `activities.subjective_notes TEXT` — free-text athlete notes
- `activities.subjective_captured_at TIMESTAMPTZ` — set when capture is submitted
- `activities.evening_checkin_data JSONB` — `{ injury_feel, refuelled, checked_in_at }`
- `athlete_settings.notification_prefs JSONB` — `{ post_activity_enabled, evening_checkin_enabled, morning_reference_enabled, evening_checkin_hours_after, evening_checkin_cutoff_hour }`
- `athlete_settings.last_evening_checkin_date DATE` — guards against duplicate evening prompts

## 2026-03-24

### enrich-activity pipeline fix (critical)

- **Root cause**: `trigger_enrich_activity()` was sending the raw activities row as the pg_net body. The `enrich-activity` edge function checks `if (payload.type !== 'INSERT') return 200` — since the row's `type` field is the Strava activity type (e.g. `"Run"`), the function exited immediately on every trigger-fired call. Streams were never written; `enrichment_status` stayed `pending` forever.
- **Fix**: Updated trigger body to wrap the row in the expected Supabase webhook envelope: `jsonb_build_object('type', 'INSERT', 'table', 'activities', 'record', to_jsonb(row_to_json(NEW)))`.
- **Deactivated stale pg_cron jobs**: Removed two daily cron jobs that were firing pg_net calls to `strava-sync` (05:15) and `daily-briefing` (05:30) — both superseded by Vercel webhook and on-demand briefing generation. Both were timing out at the 5s pg_net limit every day.
- Activity 127 ("Evening Run", 2026-03-23) was manually re-enriched: 348 samples written to `activity_streams`, zone_seconds and cadence_stats computed correctly.

## 2026-03-23

### Plan screen — activity logging & display improvements

- **Fixed INVALID DATE / NaN bug**: added `getDisplayDate(dateStr)` helper that normalises any date string to `YYYY-MM-DD` before constructing a `Date` object. Fixes broken weekday/date display for unplanned activities whose `date` column contains a full ISO timestamp.
- **Merged session + activity list**: unplanned (orphan) activities are now rendered at their correct day slot in the main list with an "Unplanned" badge, instead of a separate section at the bottom.
- **+ FAB button**: yellow floating action button (bottom-right, above tab bar) opens a bottom sheet. Current option: "Log manual activity".
- **Manual activity form**: type picker (run/trail/strength/rehab/other), date, duration (min), optional distance and notes. On save: inserts into `activities` with `source: 'manual'`, calls Claude Haiku for a one-sentence coaching note, writes to `coaching_memory`.
- **Delete activity modal**: tapping a manual activity (no `strava_id`) opens a confirm-to-delete modal. Strava activities continue to navigate to the detail view.

### Schema changes (production Supabase)
- `activities.source TEXT NOT NULL DEFAULT 'strava'` — added and backfilled
- `coaching_memory.activity_id` — FK constraint added (`REFERENCES activities(id) ON DELETE SET NULL`); orphaned rows (Strava IDs not in activities table) were nulled
- `activity_streams.activity_id` — already had `ON DELETE CASCADE`, no change needed

## 2026-03-22
- Fixed password reset flow: app now detects Supabase PASSWORD_RECOVERY
  event and shows a "Set new password" screen instead of ignoring the
  recovery token and rendering the login page.
