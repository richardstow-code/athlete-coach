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

`Authorization: Bearer <token>` is required, where `<token>` is **either**:
- `MCP_SHARED_SECRET` (set in Vercel env + your MCP client config), **or**
- a valid Supabase user JWT (validated against `/auth/v1/user`).

The Supabase **service-role key never leaves the server** (Ground Rule 5). There
is no per-user scoping yet — the server always reads the single athlete.

### Required env vars (Vercel)

| Var | Purpose | Status |
|-----|---------|--------|
| `SUPABASE_SECRET_KEY` | service-role key for PostgREST/RPC reads | already set (used by other routes) |
| `MCP_SHARED_SECRET` | static bearer for the MCP client | **NEW — Richard must set** before connecting |

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
| `get_recovery` | `athlete_state_snapshot` view + `intervals_data` | RHR / HRV / sleep + CTL/ATL/TSB |
| `get_coaching_memory` | `coaching_memory` | optional `type` / `category` / date filters |

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
