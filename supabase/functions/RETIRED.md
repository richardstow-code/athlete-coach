# Retired edge functions

## `strava-webhook` and `strava-sync` — removed 6 Aug 2026 (AC-157)

Deleted from this repo. Recoverable from git history at commit `0f832e7` and
earlier. The full rationale lives in the native repo at
`supabase/functions/RETIRED.md`; the short version:

Strava ingest runs **here on Vercel**, at `api/strava-webhook.js`. The Supabase
`strava-webhook` (v5) and `strava-sync` (v9) edge functions were deployed,
ACTIVE and never invoked — proven by the production `raw_data` shape, by
`enrichment_status` (only the Vercel handler ever set it), and by the total
absence of callers or cron entries.

They were removed because they looked authoritative: a change wired into them
would compile, deploy, pass tests and do nothing in production.

### Note on `supabase/functions/enrich-activity/` in THIS repo

That directory is **stale** — 425 lines against the 1109-line implementation
actually deployed. The live `enrich-activity` is built from the **native** repo
(`athlete-coach-native/supabase/functions/enrich-activity/index.ts`, v16/v17).

It was left in place rather than deleted, because that call was outside the
scope agreed for AC-157. Treat it as read-only and do not edit it expecting a
production effect. Retiring it is worth its own ticket.

### Architect follow-up — NOT done by this branch

Deleting the source does not undeploy. Via Supabase MCP:

- delete edge function `strava-webhook` (v5, ACTIVE)
- delete edge function `strava-sync` (v9, ACTIVE)
