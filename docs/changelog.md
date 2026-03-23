# Changelog

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
