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
   a. Fetches full activity detail from Strava API (using env var refresh token)
   b. Enriches: computes pace_variation, classifies workout_type (steady/tempo/intervals)
   c. Upserts activity row to Supabase `activities` table
   d. Calls Supabase claude-proxy → Claude Haiku (2–3 sentence coaching feedback)
   e. Inserts feedback into `coaching_memory` (category: activity_feedback)
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

Direct Anthropic API calls are made only from Supabase edge functions (`infer-athlete-context`, `daily-briefing`) which have direct access to `ANTHROPIC_API_KEY`.

## Automation: Current State (as of 2026-03-20)

- **n8n removed** — both n8n workflows (Strava Sync, Daily Briefing) have been superseded
- **Strava sync**: handled by `/api/strava-webhook.js` (Vercel serverless)
- **Daily briefings**: generated on-demand from the Home screen refresh button; persisted to `daily_briefings` table per day
- **n8n workflows to deactivate** (manual action still pending):
  - Daily Briefing: `Dsws6deZc9bAlXkl`
  - Strava Sync: `RNTJRELH2Mj7rQtX`
  - Instance: https://lifeassistant.app.n8n.cloud

## Frontend Routing

Single-page app, no URL routing. Navigation is tab-based (5 tabs: Home, Plan, Chat, Fuel, Progress). Overlays (Settings, Onboarding, WorkoutIngest, PostWorkoutPopup, PostEventModal) are rendered conditionally in App.jsx.

## Key Patterns

- **Timezone**: All date comparisons use `timeZone: 'Europe/Vienna'` explicitly. Helper: `new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' })`
- **Context layer**: `buildContext()` in `src/lib/buildContext.js` fetches all coaching data in one parallel round-trip; `formatContext()` formats it as text for Claude prompts
- **Auth**: Supabase email/password auth. RLS policies scope all table reads/writes to `auth.uid()`
- **Pull-to-refresh**: Custom touch hook (`usePullToRefresh`) on all main screens
