# Environment Variables

## Vercel (Production)

### Frontend-safe (`VITE_` prefix — bundled into client JS)

| Variable | Used by | Purpose |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | `src/lib/supabase.js` | Supabase project URL |
| `VITE_SUPABASE_KEY` | `src/lib/supabase.js` | Supabase publishable key (`sb_publishable_…`, public, RLS-enforced) |
### Server-side only (Vercel serverless functions)

| Variable | Used by | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | `api/claude-proxy.js` | Anthropic API key — all Claude calls from the React frontend route through this Vercel function |
| `STRAVA_CLIENT_ID` | `api/strava-webhook.js` | Strava app client ID for token refresh |
| `STRAVA_CLIENT_SECRET` | `api/strava-webhook.js` | Strava app client secret |
| `STRAVA_REFRESH_TOKEN` | `api/strava-webhook.js` | Long-lived refresh token (single-user app) |
| `STRAVA_VERIFY_TOKEN` | `api/strava-webhook.js` | Webhook verification token. Checked by Strava only when the push subscription is created, so rotating it means re-registering the subscription. Never commit the value. |
| `SUPABASE_SECRET_KEY` | all `api/*.js` server routes | Supabase secret key (`sb_secret_…`, named per consumer) — bypasses RLS. Sent on `apikey` only; `api/_serviceKey.js` adds `Authorization: Bearer` only for a legacy JWT key |
| `MCP_SHARED_SECRET` | `api/mcp.js` | **NEW (set before connecting the MCP server).** Static bearer token the MCP client presents as `Authorization: Bearer`. Alternatively a valid Supabase user JWT is accepted. |

> **Architecture note**: All Claude calls from the React frontend (`callClaude()` in `src/lib/claudeProxy.js`) go through `/api/claude-proxy` (Vercel serverless). The `VITE_ANTHROPIC_KEY` frontend var is no longer used and can be removed.

---

## Supabase Edge Function Secrets

Stored in Supabase project secrets (not Vercel). Set via Supabase dashboard or CLI.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | `infer-athlete-context`, `daily-briefing`, `enrich-activity`, `calibrate-zones` | Direct Anthropic API access for server-side edge functions (note: frontend Claude calls now use the Vercel `api/claude-proxy` instead of the `claude-proxy` edge function) |
| `SUPABASE_URL` | All edge functions | Supabase project URL (auto-injected) |
| `SUPABASE_PUBLISHABLE_KEYS` | `infer-athlete-context` | Auto-injected JSON of publishable keys; `default` is used for user-scoped auth checks (falls back to legacy `SUPABASE_ANON_KEY`) |
| `SUPABASE_SECRET_KEYS` | all edge functions that write | Auto-injected JSON of secret keys; `default` is used for service-level DB access (falls back to legacy `SUPABASE_SERVICE_ROLE_KEY`) |
| `ENRICH_WEBHOOK_SECRET` | `enrich-activity` | Shared secret on `x-webhook-secret`. The `trigger_enrich_activity` trigger reads the same value from Vault (`enrich_webhook_secret`); rotate both together |
| `STRAVA_CLIENT_ID` | `strava-sync`, `strava-exchange` | Strava OAuth credentials |
| `STRAVA_CLIENT_SECRET` | `strava-sync`, `strava-exchange` | Strava OAuth credentials |

---

## Variables That May Need Attention

| Variable | Issue |
|----------|-------|
| `STRAVA_REFRESH_TOKEN` (Vercel) | Hardcoded single-user refresh token. If the Strava token is ever revoked, this must be manually updated in Vercel env vars. |
| `VITE_ANTHROPIC_KEY` | Currently unused but present — can be removed to reduce confusion, or left in case direct Anthropic calls are added later. |

---

## Variables Needed for Upcoming Features

No additional env vars identified as required for current planned features. If direct HR zone computation or webhooks for other services are added, new secrets may be needed.
