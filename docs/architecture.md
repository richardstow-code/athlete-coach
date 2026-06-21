# Architecture

## Stack Overview

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 8, deployed to Vercel |
| Styling | Tailwind CSS 3.4, custom fonts (DM Mono, Syne) |
| Backend / DB | Supabase (Postgres + Auth + Edge Functions) |
| AI | Anthropic Claude Haiku (via Supabase `claude-proxy` edge function) |
| Activity data | Strava API (OAuth + webhook) |
| Automation | Vercel serverless function (`/api/strava-webhook.js`) — n8n removed |

## Component Map

```
Vercel (athlete-coach-alpha.vercel.app)
├── React SPA (src/)
│   ├── App.jsx               — shell, auth, 5-tab nav, overlays
│   ├── screens/              — one file per tab + overlays
│   └── lib/                  — shared data fetching, AI calls, helpers
│
└── api/strava-webhook.js     — serverless function (60s maxDuration)

Supabase (yjuhzmknabedjklsgbje)
├── Postgres DB               — all persistent data
├── Auth                      — email/password, session management
└── Edge Functions (Deno)
    ├── claude-proxy          — proxies Anthropic API (holds the key)
    ├── strava-sync           — bulk activity import
    ├── strava-exchange       — OAuth token exchange
    ├── strava-register-webhook — registers Strava webhook subscription
    ├── infer-athlete-context — Claude-driven settings inference
    ├── daily-briefing        — scheduled/manual briefing generation
    └── strava-webhook        — (legacy, now superseded by Vercel function)

Strava API
├── Webhook subscription → https://athlete-coach-alpha.vercel.app/api/strava-webhook
│   Subscription ID: 336117
└── OAuth tokens stored in strava_tokens table
```

## Data Flow: New Strava Activity → App Display

```
1. Athlete completes activity → Strava records it
2. Strava POSTs to /api/strava-webhook (Vercel serverless)
3. Webhook handler:
   a. Looks up user in `strava_tokens` by `owner_id` (Strava athlete ID)
   b. Fetches/refreshes their per-user access token (auto-refreshes if within 5 min of expiry)
   c. Fetches full activity detail from Strava API using that token
   d. Enriches: computes pace_variation, classifies workout_type (steady/tempo/intervals)
   e. Upserts activity row to Supabase `activities` table with correct `user_id`
4. App next load / pull-to-refresh:
   a. Home.jsx fetches activities (last 20), today's briefing, scheduled sessions
   b. PostWorkoutPopup checks for activities in last 4 hours (sessionStorage prevents repeat)
   c. ActivityDetail shows splits, HR zones, and coaching feedback
```

## Historical Backfill Flow

```
First app load with no activities:
1. Home.jsx detects empty activities table
2. Calls runBackfill() → strava-sync edge function (90-day window)
3. strava-sync paginates Strava API, upserts all activities (ignoreDuplicates: true)
4. generateBaselineAnalysis() fetches all 90-day activities, calls Claude
5. Baseline analysis saved to coaching_memory (category: baseline_analysis)
6. Used in plan generation as training history context
```

## AI Call Routing

All Claude calls from the frontend go through the Supabase `claude-proxy` edge function, which holds `ANTHROPIC_API_KEY` in Supabase secrets. The frontend authenticates with its Supabase session JWT.

The Vercel serverless function (`/api/strava-webhook.js`) also routes through `claude-proxy`, authenticating with `SUPABASE_SECRET_KEY` (service role key stored as Vercel env var).

Direct Anthropic API calls are made only from Supabase edge functions (`infer-athlete-context`, `daily-briefing`) which have direct access to `ANTHROPIC_API_KEY`, and from the Vercel `api/claude-proxy.js` / `api/agentic-chat.js` / `api/analyze-activity.js` functions (which hold `ANTHROPIC_API_KEY` as a Vercel env var).

## MCP Server (read-only, Phase 1)

`api/mcp.js` is a Vercel Node serverless route exposing the athlete's training
data as MCP tools (stateless Streamable-HTTP, `@modelcontextprotocol/sdk`). It is
single-athlete, read-only, and **wraps** existing canonical sources rather than
recomputing — Tier-1 tools call the `get_athlete_coaching_context` RPC (HR zones
from `training_zones`, never `hr_zones`); the rest are plain PostgREST reads via
`api/_supabaseRest.js`, with tools in `api/_mcpTools.js`. Auth: `Authorization:
Bearer` = `MCP_SHARED_SECRET` or a valid Supabase JWT; the service-role key never
leaves the server. Full catalogue, sources, and limitations: `docs/mcp.md`.

## Automatic Per-Activity Analysis (Path A)

When an activity finishes enrichment, a structured multi-sport coaching read is generated server-side and stored on the activity, so a detailed per-activity analysis is available in-app without opening a chat. (Productised fix for `f76506ac`: `buildContext` feeds the coach summary-only activity data and never queries `activity_streams`/`splits_metric`.)

Flow:

1. `enrich-activity` sets `activities.enrichment_status = 'complete'`.
2. DB trigger `trigger_analyze_activity` (`AFTER UPDATE`, on transition to `'complete'`) fires a **fire-and-forget** `pg_net` POST `{ activity_id }` (+ `x-analyze-secret` header) to `https://athlete-coach-alpha.vercel.app/api/analyze-activity`. It does NOT await the LLM (respects the ~5s pg_net limit).
3. `api/analyze-activity.js` (service role):
   - rejects unless `x-analyze-secret` matches `ANALYZE_ACTIVITY_SECRET`;
   - **idempotency/dedup**: skips if `coach_analysis` already present (unless `force`), if not enriched / no streams-or-splits (`incomplete`), or if a duplicate-shaped sibling row already has an analysis (`dup` — the native-recorded + Strava-synced dual-source case);
   - builds the athlete-state snapshot **inline** from base tables (activity row incl. raw `rpe`/`feel`/`feel_legs`, `activity_streams` zone_seconds/cadence_stats/grade_correlation aggregated to a compact summary, `splits_metric`, the matching `scheduled_sessions` row for the Europe/Vienna date, `athlete_settings` + `athlete_sports`, last ~5 same-sport activities, and **active injuries** from `injury_reports` under the status-based rule — `status='active'` regardless of `follow_up_due_date`, flagging overdue follow-ups; see `database.md`. `enrich-activity` (v16) uses the same rule — aligned). `athlete_state_snapshot` is NOT read;
   - **cadence** is presented as steps-per-minute: `avg_cadence` (stored RAW per-leg by the Strava import) is doubled for run/walk/hike via `sportDoublesCadence()` / `cadenceDisplayAvg()` — the SAME `CADENCE_DOUBLE_SPORTS` set as enrich-activity v16 / `lib/splits.ts`. `cadence_stats` (already doubled by enrich v16) and ride/row rpm are passed through unchanged (no double-doubling);
   - asks Haiku for STRICT-JSON multi-sport output (branches by sport; NEVER FABRICATE with an explicit NOT AVAILABLE list; raw RPE; HR data-quality guard; tag-mismatch surfacing);
   - writes back `coach_analysis` + `coach_analysis_generated_at` / `_model` / `_version` and a `prompt_data_completeness` audit. On parse failure it stores the audit (`generation_status: 'parse_failed'`), leaves `coach_analysis` null for retry, and returns 5xx.
4. Native renders `coach_analysis` on the activity-detail screen (full report) and the feed card (headline + top flag) — read STRAIGHT from the DB, rendered verbatim (no serve-time overlay). See `screens.md`. **Known staleness:** the stored `coach_analysis` is a frozen snapshot — if a source state changes after generation (e.g. an injury is resolved in `injury_reports`), the stored card does NOT auto-update (`decideSkip` → `'exists'`). The live injury *read* is correct (`injury_reports.status`); only the stored artifact is stale. The systemic fix — a generalised **regenerate-on-source-change** mechanism reused by the deferred Coach's-Take rolling refresh — is **designed, not built**: see `docs/features/regenerate-on-source-change.md`. Stale cards are cleared by a manual `force`-re-run.

`ANALYZE_ACTIVITY_SECRET` is set in both Supabase (trigger header) and Vercel (endpoint check). Tests: `tests/api/analyze-activity.test.js` (guard logic + live wiring) and `tests/ai-eval/analyze-activity-eval.js` (fabrication detector).

## Automation: Current State (as of 2026-03-20)

- **n8n removed** — both n8n workflows (Strava Sync, Daily Briefing) have been superseded
- **Strava sync**: handled by `/api/strava-webhook.js` (Vercel serverless)
- **Daily briefings**: generated on-demand from the Home screen refresh button; persisted to `daily_briefings` table per day
- **n8n workflows to deactivate** (manual action still pending):
  - Daily Briefing: `Dsws6deZc9bAlXkl`
  - Strava Sync: `RNTJRELH2Mj7rQtX`
  - Instance: https://lifeassistant.app.n8n.cloud

## Frontend Routing

Single-page app, no URL routing. Navigation is tab-based (5 tabs: Home, Plan, Chat, Fuel, Progress). Overlays (Settings, Onboarding, WorkoutIngest, PostWorkoutPopup, PostEventModal, Roadmap) are rendered conditionally in App.jsx.

## Root-Level Components (mounted once in App.jsx)

These components are mounted at the app root and appear on every screen:

| Component | Purpose |
|-----------|---------|
| `HelpBot` | Floating `?` button (fixed, bottom-right, above tab bar) opens slide-up AI assistant panel. Ephemeral conversation, screen-aware quick chips, links to roadmap and feature requests. |
| `ReleaseNotes` | On app load, compares latest `app_releases.version` to `athlete_settings.last_seen_version`. Shows a popup with new features if the version is newer. Writes `last_seen_version` on dismiss. |

## Per-Screen Components (mounted in each screen)

| Component | Purpose |
|-----------|---------|
| `OnboardingHints` | Per-screen tooltip card. On mount, checks `athlete_settings.hints_dismissed` for the hint ID. Shows after 1s delay if not dismissed. Fixed position (above tab bar or below header). 'Got it' dismisses one; 'Skip all' dismisses all hint IDs. |

## Feature Request Similarity Detection Pattern

When a user submits a feature request, the app calls Claude Haiku to compare the new request against all existing open requests. Claude returns `{match, matched_id, confidence, reasoning}`. If `match=true` and `confidence>=0.75`, the user's text is added as a vote on the existing request rather than creating a new row. This prevents duplicate feature requests from fragmenting vote counts.

If the Claude call fails, a new row is created and `admin_notes` is set to `'similarity_check_failed'` for manual review.

## Two-stage Webhook Pipeline Detail

```
Stage 1 — Vercel (/api/strava-webhook.js):
  - Receives Strava push event
  - Fetches full activity from Strava API
  - Upserts to activities table (ON CONFLICT strava_id DO UPDATE)
  - Sets enrichment_status = 'pending'
  - Returns 200 immediately

Stage 2 — Supabase (enrich-activity edge function):
  - Triggered by DB trigger: AFTER INSERT OR UPDATE ON activities
  - Condition: NEW.enrichment_status = 'pending' AND
               (TG_OP = 'INSERT' OR OLD.enrichment_status IS DISTINCT FROM 'pending')
  - The UPDATE condition is critical: upsert on conflict fires UPDATE, not INSERT
  - Guard prevents infinite loop: enriching sets status='complete', which doesn't re-trigger
  - Fetches 5 stream types from Strava, downsamples, computes zones/cadence/grade
  - Writes to activity_streams, sets enrichment_status='complete'
  - Generates coaching feedback via Claude Haiku → coaching_memory
```

## Key Patterns

- **Timezone**: All date comparisons use `timeZone: 'Europe/Vienna'` explicitly. Helper: `new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' })`
- **Context layer**: `buildContext()` in `src/lib/buildContext.js` fetches all coaching data in one parallel round-trip; `formatContext()` formats it as text for Claude prompts. Includes: activities (with `raw_data` for splits), last 7 days sessions (planned vs actual), upcoming sessions, coaching memory (5 most recent with category labels), nutrition, cycle context, injury reports.
- **Auth**: Supabase email/password auth. RLS policies scope all table reads/writes to `auth.uid()`
- **Pull-to-refresh**: Custom touch hook (`usePullToRefresh`) on all main screens
