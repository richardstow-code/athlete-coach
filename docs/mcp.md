# Coach Claude MCP Server

A remote [MCP](https://modelcontextprotocol.io) server that exposes the athlete's
training data as tools, so any MCP client (e.g. Richard's Claude chat) can pull
live state and reason over it at full depth.

- **Phase:** 1 (read-only). Phases 2 (nice-to-have reads + first writes) and 3
  (power tools) are not built yet.
- **Scope:** single athlete. Every tool is hard-scoped server-side to
  `ATHLETE_USER_ID = 40cfe68e-faea-491c-b410-0093572f02d6`. No multi-tenant auth.

## Host & runtime

- **Vercel Node serverless route:** `api/mcp.js` (sits next to `api/claude-proxy.js`).
- **Transport:** MCP Streamable-HTTP, **stateless** — a fresh `McpServer` +
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request.
  Fits serverless and the 30s `maxDuration` (`export const config`).
- **SDK:** `@modelcontextprotocol/sdk` (^1.29).
- **Endpoint (after deploy):** `POST https://athlete-coach-alpha.vercel.app/api/mcp`.

### Auth (single-user v1)

There are **two auth paths** — pick by client:

**A. OAuth 2.1 (Claude WEB / MOBILE connector)** — the in-app "Connect" button.
The web/mobile connector only does OAuth; it cannot use a static bearer. Flow:
1. Unauthenticated `POST /api/mcp` → `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://athlete-coach-alpha.vercel.app/.well-known/oauth-protected-resource"`.
2. The client fetches `/.well-known/oauth-protected-resource` (RFC 9728) →
   `authorization_servers: ["https://yjuhzmknabedjklsgbje.supabase.co/auth/v1"]`.
3. The client reads the Supabase AS metadata
   (`…/.well-known/oauth-authorization-server/auth/v1`), **Dynamic Client
   Registration** (RFC 7591) self-registers the client, then runs OAuth 2.1
   authorization-code **+ PKCE S256**. Supabase redirects the user to our consent
   page (`/oauth/authorize`), where Richard signs in and Approves.
4. The connector calls `/api/mcp` with the OAuth access token.

The server validates the access token via Supabase **JWKS** (`_oauth.js`):
signature + expiry + `iss` = the Supabase auth issuer + `aud` = `authenticated`,
and **`sub` = ATHLETE_USER_ID** (single-athlete binding); the consent-approved
`client_id` is captured.

> **Audience deviation (ruling #1, documented).** The MCP spec MUSTs the resource
> server validate the token's audience is *this resource* (RFC 8707). Supabase
> issues `aud="authenticated"` with no resource-indicator binding, so we accept
> that fixed value and instead bind to the single athlete via `sub`. This is safe
> in a single-user, all-first-party setup. **Revisit trigger:** if this ever
> becomes multi-user, or additional distinct resource servers trust the same
> Supabase project, move to resource-bound tokens (a self-hosted AS, or Supabase
> resource indicators if added).

**B. Static bearer (Claude Code / Desktop / API)** — unchanged. `Authorization:
Bearer <token>` where `<token>` is `MCP_SHARED_SECRET`, **or** a Supabase user JWT
(validated by remote introspection at `/auth/v1/user`, then `sub` must equal the
single athlete). This path is preserved exactly; OAuth is additive.

The Supabase **service-role key never leaves the server** (Ground Rule 5).

> **Both auth paths share the AC-153 guardrail (AC-154).** The OAuth/Path-B build
> was reconciled with `main` so the **connector path is held to the same
> verbatim-only standard as the Bearer path** — whether a request authenticates
> via OAuth or a static bearer, `log_session_feedback` records the athlete's own
> subjective values only and never fabricates them from activity metrics (see the
> [verbatim-only contract](#log_session_feedback--verbatim-only-contract-ac-153)
> below). The tool logic is shared (`api/_mcpTools.js`); auth never bypasses it.

### Discovery / consent endpoints

| Path | Serves |
|------|--------|
| `/.well-known/oauth-protected-resource` (+ `…/api/mcp`) | RFC 9728 protected-resource metadata → Supabase as the AS |
| `/oauth/authorize` | consent page (requires Supabase login before Approve) |
| Supabase AS metadata | `https://yjuhzmknabedjklsgbje.supabase.co/.well-known/oauth-authorization-server/auth/v1` (Supabase-hosted) |

> **Consent page shows the approving account + allows switching (AC-156).** The
> consent screen displays **"Signed in as `<email>`"** above Approve/Deny and
> offers **"Not you? Use a different account"** (which signs out and returns to
> the login form for the *same* `authorization_id`). The cached session is also
> re-validated server-side (`getUser`) before consent, so a stale/expired session
> can't reach a consent screen that would fail at approve time.
>
> **⚠ Multi-account gotcha.** This Supabase project has several real accounts
> (the **hotmail athlete** account `richardstow@hotmail.co.uk` —
> `40cfe68e-…02d6`, which **owns the training data**; the **IBM work** account
> `richard.stow@ibm.com` — `4f0495d9-…0bc0`, which has **none**; and the Sarah
> test user). You **must authorize as the hotmail athlete account** — the
> connector is single-user bound to that `sub`. Before AC-156 the page silently
> approved whichever session was cached on the `…vercel.app` origin (it had
> wired to the empty IBM account); the "Signed in as" line now makes the
> identity explicit so this can't happen silently.

### Required env vars (Vercel)

| Var | Purpose | Status |
|-----|---------|--------|
| `SUPABASE_SECRET_KEY` | service-role key for PostgREST/RPC reads | already set |
| `MCP_SHARED_SECRET` | static bearer for CC/Desktop/API (path B); **rotate — was exposed** | set |
| `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_KEY`) | anon key for the consent page's browser Supabase client | confirm available to functions |
| `MCP_OAUTH_AUD` | override expected `aud` (default `authenticated`) | optional |

### Dashboard config (Richard, one-time — required for OAuth)

1. **Authentication → OAuth Server**: enabled (done) + **Dynamic Client
   Registration** on. Confirm DCR redirect-URI validation is restricted to
   Anthropic's connector domains (exact-match URIs; no wildcards).
2. **Authentication → OAuth Server → Authorization Path** = `/oauth/authorize`.
3. **Authentication → URL Configuration → Site URL** =
   `https://athlete-coach-alpha.vercel.app` (so the consent redirect resolves).

### Connect (web): Settings → Connectors → add the server URL
`https://athlete-coach-alpha.vercel.app/api/mcp` → **Connect** → complete the
OAuth consent → tools list appears.

## Wrap, don't reimplement (tiering)

Every tool reads the **same canonical source** the app uses; no zone / pace /
compliance maths is recomputed in the server (that is exactly the
Coach-Analysis-card divergence we are avoiding).

- **Tier 1 (RPC):** `get_athlete_profile`, `get_training_zones` (HR) wrap
  `get_athlete_coaching_context` (`athlete-coaching-context@v2`). HR zones come
  out of the canonical context (resolved from `athlete_settings.training_zones`)
  — the `hr_zones` column (NULL) is **never read**.
- **Tier 2 (plain column reads):** recent activities, activity detail, scheduled
  sessions, recovery, coaching memory, pace zones.
- **Tier 3 (flagged):** activity classification re-implements the native
  thresholds (native TS is not importable cross-repo) — candidate for a future
  `classify` RPC so it cannot drift. The numeric `tone` slider is also not in the
  RPC payload, so it is read directly from `athlete_settings.tone`.

## Tool catalogue

| Tool | Backing source | Notes |
|------|----------------|-------|
| `get_athlete_profile` | RPC `get_athlete_coaching_context` + `athlete_settings.tone` | identity, sports, next race + countdown, tone |
| `get_recent_activities` | `activities` (PostgREST) | `from`/`to`/`limit`; **Europe/Vienna** date bucketing |
| `get_activity_detail` | `activities` + `intervals_data` | classification (trail/interval/easy); intervals attached only when unambiguous |
| `get_scheduled_sessions` | `scheduled_sessions` | excludes `superseded` by default; optional `statuses`; **no `cancelled` status exists** |
| `get_training_zones` | RPC (HR) + `athlete_settings.pace_zones` | HR from `training_zones`, never `hr_zones` |
| `get_recovery` | `athlete_state_snapshot` view + `intervals_data` | RHR / HRV / sleep (each with `date` + `age_days`) + CTL/ATL/TSB |
| `get_coaching_memory` | `coaching_memory` | optional `type` / `category` / date filters |
| `get_nutrition` | `nutrition_logs` | date range (default 7d) + total `alcohol_units` tally (Phase 2) |
| `get_weekly_review` | `coaching_memory` `category='weekly_review'` | latest generated weekly review (Phase 2) |
| `get_routes` | `athlete_routes` + RPC `get_route_coach_context` | list (named locations only); pass `route_id` for that route's coaching context (Phase 2) |

### Writes (Phase 2) — propose-by-default

Each write tool is **propose-by-default**: called without `commit: true` it returns
the proposed diff and **mutates nothing**; with `commit: true` it performs the write
and returns the **actual mutated row**. No silent-fill (only fields the caller
supplied are written).

| Write tool | Target | Guarantees |
|------------|--------|------------|
| `log_session_feedback` | PATCH `activities` | writes the athlete's **own** subjective feedback: **raw RPE** (1–10) + feel_legs/injury_flag/notes + `subjective_captured_at`; never computes a `feel_score`; **verbatim-only** — never derives values from metrics, partial-update, refuse-when-empty (see below) |
| `propose_schedule_change` | INSERT `schedule_changes` `status='pending'` | **never mutates `scheduled_sessions`**; `proposed_by='mcp'`; `title`+`reasoning` required (NOT NULL); the architect-owned DB trigger handles regen |
| `write_coaching_memory` | UPSERT `coaching_memory` | idempotent on `(user_id,date,source)` — re-run merges, never double-inserts |
| `update_athlete_profile` | UPSERT `athlete_settings` | **only** `weight_kg`, `goal_type`, `health_notes`; unknown/deferred fields are rejected (reported, not written). Race/goal edits live in `athlete_sports` — deferred |

Deferred (not built): `get_compliance` aggregate (no server-reachable canonical
source — per-activity `compliance_score` is instead surfaced as a field on
`get_recent_activities` / `get_activity_detail`; the time-weighted/training-only/
capped aggregate is flagged for a future RPC), `get_weather_context` (net-new
outbound API), and race/goal profile edits.

### `log_session_feedback` — verbatim-only contract (AC-153)

Subjective feedback flows into `athleteContext` and every coaching surface, so a
fabricated value poisons context everywhere. This tool therefore records the
**athlete's own** words/values **only**:

- **Never infer.** The server never derives `rpe` / `feel` / `feel_legs` /
  `injury_flag` / `subjective_notes` from activity metrics (pace, HR, splits,
  distance, duration) for **any** sport, and never writes a third-person summary
  of the session into `subjective_notes`. The tool description and every
  subjective param's schema description carry this verbatim-only / do-not-infer
  rule to steer the calling model.
- **Partial update.** Only the fields the caller explicitly supplied are written.
  An omitted field is left **untouched** in the DB (never nulled/defaulted) — so
  sending `rpe` alone preserves an existing `subjective_notes` byte-for-byte.
- **Refuse-when-empty.** With no athlete-provided subjective field the tool
  writes nothing (for both propose and commit) and returns
  `{ committed:false, refused:true, error: "No athlete-provided subjective
  values supplied…" }`.
- **Mapping.** `notes` → the `subjective_notes` column (there is **no** `notes`
  column). `rpe` is a **raw** 1–10 integer (low RPE on an easy/Z2 session is
  good, never inverted to "poor feel"). `subjective_captured_at` is stamped only
  on a real write. The `activities` table has **no `updated_at`** column.
- **Return contract.** On `commit:true` returns `committed:true`, the **actual**
  mutated DB row, and `changed_columns` (the real column names changed).

> **Origin (AC-153, 22 Jun 2026):** a calling model invoked this tool *without*
> athlete-provided values — it invented `rpe=3` and wrote a third-person metrics
> summary into `subjective_notes`, overwriting the athlete's real note on a real
> activity. The write **plumbing was already correct** (right row, partial
> payload, `subjective_captured_at` set); the fabrication came from the caller.
> The guardrail above (verbatim-only schema/description steering + the structural
> partial-update / refuse-when-empty protections + regression tests) is the fix.

### Data-sparseness contract (NEVER FABRICATE)

`icu_intensity` is populated on ~19% of `intervals_data` rows; `splits_metric` on
~64% of activities. Every tool returns an explicit **`"NOT AVAILABLE"`** marker
for a missing field — never an absent key, never a fabricated value.

### Known limitations (Phase 1)

- **intervals attribution.** `intervals_data` is keyed `(user_id, date)` with no
  `activity_id`. On a day with more than one activity, `get_activity_detail` sets
  `intervals_attribution: "ambiguous (multiple activities this date)"` and omits
  the interval block rather than mis-attributing. (Fixing the key is a separate
  track.)
- **Dates** are always `Europe/Vienna` via `toLocaleDateString('en-CA', …)`.

## Tests (Gate 1)

`npm run test:api` (`node --test`), file `tests/api/mcp.test.js`.

- **Layer 1 (always runs, no network):** deterministic mock-client tests — per
  tool projection, `NOT AVAILABLE` markers, Vienna bucketing, classification,
  superseded exclusion, training_zones-never-hr_zones, the error path, and the
  SDK wiring (`buildServer` registers all 7 tools).
- **Layer 2 (seed + parity, gated on `TEST_SUPABASE_*`):** seeds rows in the
  **test** project (`nvoqqhaybhswdqcjyaws`) and asserts tool output == a direct
  `@supabase/supabase-js` read of the same project. Covers `coaching_memory` and
  `scheduled_sessions` (the tables present on the test project). The RPC / view /
  `intervals_data`-backed tools are **not** on the test project, so they are
  covered by Layer-1 projection (against the real captured payload) + the manual
  prod check below. The hard prod-guard is respected — tests never touch prod.

  Test fixture note: the test project's `scheduled_sessions` was missing
  `is_benchmark` (prod has it); an additive `ADD COLUMN IF NOT EXISTS` brought
  the fixture to prod parity (migration `mcp_test_fixture_scheduled_sessions_is_benchmark`,
  test project only).

## Manual verification (Gate 1.5 — post-deploy, Richard/Architect)

Backend tests passing ≠ feature working. After deploy:

1. Set `MCP_SHARED_SECRET` in Vercel and add the server to a Claude MCP client
   config (URL `…/api/mcp`, `Authorization: Bearer <MCP_SHARED_SECRET>`).
2. Ask one question that exercises ≥3 tools, e.g. *"What did I run this week,
   how do my zones and recovery look, and what's on the plan tomorrow?"* —
   exercises `get_recent_activities`, `get_training_zones`, `get_recovery`,
   `get_scheduled_sessions`.
3. Confirm the numbers match what the app shows for the same athlete (zones,
   last activities, CTL/ATL/TSB). Record the flow in `HANDOVER.md`.

## Deploy

Server-side; **not** an EAS build. Merge `mcp-server-phase1` → `main` to trigger
the Vercel deploy, then the Architect verifies the production deployment ID
flipped + runs the behavioural check before GATE 1 is declared passed.
