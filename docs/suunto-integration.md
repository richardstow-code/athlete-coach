# Suunto Integration

Living doc for the Suunto Cloud API programme. Suunto partner API access granted
2026-07 (Richard). Single-user app, same as the rest of the platform. Backend I/O
only — Vercel serverless (Node, ESM); **no native code, no EAS**.

## Status

| Phase | Scope | State |
|-------|-------|-------|
| **Phase 1** | OAuth connect + token lifecycle | **built 2026-07-16** (`feature/suunto-oauth`) |
| Phase 2 | Onboarding "Connect Suunto" pill / UI entry | not started |
| Phase 3 | Workout + health ingest (uses `getValidSuuntoAccessToken`) | not started |

## Endpoints & code

| File | Role |
|------|------|
| `api/suunto-auth.js` | GET — start OAuth: mint `state` cookie, 302 → Suunto authorize |
| `api/suunto-callback.js` | GET — validate `state`, exchange code → tokens, decode username, persist |
| `lib/suunto/tokens.js` | `getValidSuuntoAccessToken(userId)` (refresh-before-expiry) + `suuntoApiHeaders()` |
| `lib/suunto/jwt.js` | `decodeJwtPayload()` — signature-less JWT payload decode |
| `tests/api/suunto-*.test.js` | 14 unit tests (fetch mocked) |

**Redirect URI** (must match byte-for-byte between authorize and token exchange):
```
https://athlete-coach-alpha.vercel.app/api/suunto-callback
```

**OAuth host**: `https://cloudapi-oauth.suunto.com`

## Environment variables (Vercel — web project)

Names only; values live in Vercel, read via `process.env`, never logged.

| Var | Use |
|-----|-----|
| `SUUNTO_CLIENT_ID` | OAuth client id (authorize + Basic auth) |
| `SUUNTO_CLIENT_SECRET` | OAuth client secret (Basic auth on token calls) |
| `SUUNTO_SUBSCRIPTION_KEY` | Azure APIM `Ocp-Apim-Subscription-Key` for Cloud API requests |
| `SUPABASE_SECRET_KEY` | Supabase service-role key (already present; used by other functions) |

## Verified protocol facts

Source: Suunto partner *how-to-start* + FAQ.

### Authorize (browser GET)
```
{OAUTH_HOST}/oauth/authorize
  ?response_type=code
  &client_id={SUUNTO_CLIENT_ID}
  &redirect_uri={REDIRECT_URI}
  &state={CSRF_STATE}
→ redirects to {REDIRECT_URI}?code=<AUTH_CODE>&state=<CSRF_STATE>
```

### Token exchange (server POST)
```
POST {OAUTH_HOST}/oauth/token
Headers:
  Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
  Content-Type: application/x-www-form-urlencoded
Body:
  grant_type=authorization_code
  redirect_uri={REDIRECT_URI}    # byte-for-byte identical to authorize
  code=<AUTH_CODE>

Response JSON:
  { "access_token":"<JWT>", "token_type":"bearer",
    "refresh_token":"<JWT>", "expires_in":86400, "scope":"workout" }
```
`access_token` is a JWT. Decode the payload segment (base64url, middle of the three
dot-separated parts) and read the custom claim `user` — this is the Suunto App
username → stored as `suunto_username`. The signature is **not** verified (trusted:
it came straight from the token endpoint over TLS).

### Token refresh (server POST)
Standard OAuth. Suunto docs don't show refresh explicitly — param names follow the
OAuth spec and are confirmed working by the Phase-1 tests.
```
POST {OAUTH_HOST}/oauth/token
Headers: Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
Body:
  grant_type=refresh_token
  refresh_token=<STORED_REFRESH_TOKEN>
```
If the response contains a **new** `refresh_token`, store it (rotation). If not, keep
the existing one. Recompute `suunto_token_expires_at = now + expires_in` seconds.
**Refresh when within 5 minutes of expiry.**

### Cloud API auth (Phase 3)
Every Suunto Cloud API request carries TWO headers:
```
Authorization: Bearer <access_token>
Ocp-Apim-Subscription-Key: <SUUNTO_SUBSCRIPTION_KEY>
```
> ⚠️ The how-to-start doc writes the `Authorization` header WITHOUT `Bearer` (raw
> token). That is almost certainly a doc typo — we use the standard `Bearer <token>`.
> If a live call returns 401, fall back to the raw token; `suuntoApiHeaders()` in
> `lib/suunto/tokens.js` carries a comment marking that spot.

## DB columns

`athlete_settings` (migration applied separately by the Architect): `suunto_username`,
`suunto_access_token`, `suunto_refresh_token`, `suunto_token_expires_at`,
`suunto_connected_at`, `suunto_last_workout_sync_at`, `suunto_last_health_sync_at`.
See `docs/database.md`.

## Multi-user note

The app is single-user today (`ATHLETE_USER_ID = 40cfe68e-…`). The stored `suunto_username`
(JWT `user` claim) is the intended routing key for future Suunto webhooks — the Suunto
analogue of Strava's `owner_id` → `strava_tokens` lookup.

## Watch app note

The custom **SuuntoPlus watch app is RETIRED / superseded by Guides.** This integration
uses the Suunto **Cloud API** (server-to-server), not an on-watch app.
