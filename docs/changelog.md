# Changelog

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
