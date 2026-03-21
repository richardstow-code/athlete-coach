# Strava Integration

## Webhook (Live Activity Sync)

**Handler**: `/api/strava-webhook.js` — Vercel serverless function (60s maxDuration)

**Endpoint**: `https://athlete-coach-alpha.vercel.app/api/strava-webhook`

**Subscription ID**: 336117 (registered 2026-03-20, replacing ID 335891 which pointed at Supabase)

### GET — Verification Handshake

Strava calls this once when the webhook is registered:
```
GET /api/strava-webhook?hub.mode=subscribe&hub.challenge=<token>&hub.verify_token=<token>
```
Handler checks `hub.verify_token === process.env.STRAVA_VERIFY_TOKEN` (`athletecoach2026`) and echoes back `hub.challenge`.

### POST — Activity Notification

Strava calls this when an activity is created:
```json
{
  "object_type": "activity",
  "object_id": 12345678,
  "aspect_type": "create",
  "owner_id": 12345,
  "event_time": 1234567890
}
```

Processing pipeline (synchronous — all steps must complete before 200 response):

1. **Token refresh** — calls `https://www.strava.com/oauth/token` with env var refresh token
2. **Fetch full activity** — `GET /api/v3/activities/{id}` with fresh access token
3. **Enrich**:
   - Compute `pace_variation` (max − min pace across valid splits in sec/km)
   - Classify `workout_type`: `intervals` (>45s), `tempo` (>20s), `steady` (≤20s)
   - Format `pace_per_km` from average speed
   - Extract `date` from `start_date_local` (already local time from Strava)
4. **Upsert activity** → Supabase `activities` table (conflict on `strava_id`)
5. **Generate coaching feedback** (optional — failure does not fail the whole flow):
   - Calls Supabase `claude-proxy` edge function with service role key
   - Model: `claude-haiku-4-5-20251001`, 300 tokens
   - Prompt: 2–3 sentences on effort level, HR zone discipline, specific takeaway
6. **Insert coaching_memory** row (type: activity_feedback)

**Error handling**: Always returns HTTP 200 to Strava (never 5xx). Activity save failures are logged; coaching feedback failures are non-fatal. Strava retries are safe — upsert on `strava_id` is idempotent.

**Single-user note**: This is a single-user app. The webhook uses a hardcoded `ATHLETE_USER_ID` constant and env var credentials (not per-user token lookup from DB).

---

## Historical Backfill

**Trigger**: Automatic on first app load when `activities` table is empty.

**Handler**: `src/lib/stravaBackfill.js` → calls `strava-sync` Supabase edge function

**Flow**:
1. `runBackfill()` calls `strava-sync` with 90-day window
2. `strava-sync` paginates Strava API (100 activities per page)
3. Upserts all activities with `ignoreDuplicates: true` — never overwrites existing rows
4. `generateBaselineAnalysis()` runs in background after backfill:
   - Fetches last 90 days of activities
   - Calls Claude for a training baseline summary
   - Saves to `coaching_memory` (category: baseline_analysis)
   - Used as context for future plan generation

**Manual trigger**: Pull-to-refresh on Home also triggers `load()` but not backfill (backfill uses a ref guard to run once per session).

---

## OAuth Token Refresh

### For the webhook (server-side)
The Vercel serverless function uses a single hardcoded refresh token (`STRAVA_REFRESH_TOKEN` env var). It refreshes on every webhook call — no caching.

### For the frontend / backfill (user-scoped)
`strava-sync` edge function reads per-user tokens from the `strava_tokens` table. Refreshes automatically if `expires_at < now + 5 minutes`, writing new tokens back to DB.

`strava-exchange` edge function handles the initial OAuth token exchange when an athlete connects Strava from the Settings screen.

---

## Data Captured

From the full activity endpoint (webhook path):

| Field | Stored as |
|-------|-----------|
| id | strava_id |
| name | name |
| start_date_local | date (YYYY-MM-DD slice) |
| type | type |
| distance | distance_km (÷1000) |
| moving_time | duration_min (÷60) |
| average_speed | pace_per_km (formatted) |
| average_heartrate | avg_hr |
| max_heartrate | max_hr |
| total_elevation_gain | elevation_m |
| splits_metric | raw_data.splits_metric |
| laps | raw_data.laps |
| Computed: pace_variation | raw_data.pace_variation |
| Computed: workout_type | raw_data.workout_type |

From the list endpoint (backfill path via strava-sync), additionally:

| Field | Stored as |
|-------|-----------|
| calories | calories |
| average_cadence | avg_cadence |
| workout_type (Strava int) | workout_type |
| splits_metric | splits_metric |
| laps | laps |
| full activity object | raw_data |

---

## Strava App Credentials

- Client ID: `209458`
- Client Secret: stored in Vercel env var `STRAVA_CLIENT_SECRET` and Supabase secret `STRAVA_CLIENT_SECRET`
- Refresh Token: stored in Vercel env var `STRAVA_REFRESH_TOKEN` (single-user, for webhook)
- Per-user tokens: stored in `strava_tokens` table (for frontend-triggered syncs)
