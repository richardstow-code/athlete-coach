# Changelog

## 2026-04-05

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
