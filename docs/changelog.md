# Changelog

## 2026-06-22 (later 3) — AC-156: harden the OAuth consent page (show approving account + account switch)

Consent-page-only hardening in `api/oauth/authorize.js` (no tool/schema/discovery
changes). Path B went live but the consent page silently authorized whichever
Supabase session was cached on the `…vercel.app` origin — it approved as Richard's
**IBM work account** (no training data) instead of the **hotmail athlete account**
that owns the data, with zero indication of which account.

- **Shows the approving account:** the consent screen now displays **"Signed in as
  `<email>`"** above Approve/Deny.
- **Account switch:** **"Not you? Use a different account"** signs out and returns
  to the login form **without dropping `authorization_id`** — after re-login the
  page returns to consent for the *same* authorization request.
- **Robust session check:** `getSession()` (local cache) is re-validated with
  `getUser()` before showing consent; a stale/expired session falls through to the
  login form instead of a consent screen that fails at approve time.
- **Styling:** matched the design system — white bg (`#ffffff`), dark text
  (`#0a0a0a`), teal (`#14b8a6`) primary Approve, muted grey secondary; no banned
  `#e8ff47`.
- **Test:** one `@smoke` Playwright check (`tests/e2e/oauth-consent.spec.js`) —
  no session ⇒ login form renders (not a consent screen, not a crash). The
  session-present path is covered by Richard's manual connect test (mocking a
  server-validated Supabase session is disproportionate here).
- eslint at baseline parity (the 2 pre-existing findings — `process` node-globals
  gap + the `\s`-in-template escape — unchanged; no new errors).

## 2026-06-22 (later 2) — AC-155: retrigger production deploy of main HEAD (Path B live)

Docs-only commit to push a fresh commit onto `main` so Vercel deploys main HEAD.
PR #5 (Path B / OAuth) merged as `35f1f9e` and main HEAD correctly carries BOTH the
OAuth layer (AC-154) and the AC-153 guardrail, but Vercel never created a deployment
for `35f1f9e` — production is still a manual redeploy of the older AC-153 build
(`6d7ef6e`), so OAuth/Path B is not live (`/.well-known/oauth-protected-resource`
404s). This retrigger also doubles as a diagnostic: if it deploys, auto-deploy is
healthy; if no deployment appears for the new main commit, production auto-deploy is
paused (Architect to re-enable in the Vercel Git settings). No code, `vercel.json`,
or MCP files touched.

## 2026-06-22 (later) — AC-154: reconcile `mcp-oauth` (Path B) with main to fold in the AC-153 guardrail

Branch `mcp-oauth` (PR #5) was cut from the Phase-2 tip (`8e55265`) **before**
AC-153 merged, so its tool code was the old pre-guardrail version. Merged
`origin/main` (incl. the AC-153 merge `6d7ef6e`) into `mcp-oauth` so the
OAuth/Path-B connector path is held to the same verbatim-only standard as the
Bearer path — merging PR #5 as-is would have silently reintroduced the
fabrication bug.

- **`api/_mcpTools.js`** — took main's version entirely (the AC-153 guardrail:
  refuse-when-empty, partial-update, `changed_columns`, verbatim-only). Verified
  OAuth never touched this file (mcp-oauth's copy was byte-identical to the merge
  base `8e55265`), so this resolved clean.
- **`api/mcp.js`** — kept BOTH: the OAuth auth layer (`validateOAuthToken`,
  `RESOURCE_METADATA_URL`, `authorizeRequest` with shared_secret|oauth, the
  RFC 9728 `401` + `WWW-Authenticate`) AND main's AC-153 verbatim-only
  inputSchema descriptions for `rpe`/`feel_legs`/`injury_flag`/`notes` plus
  the commit-param refusal note. Auto-merged cleanly (the two changes touch
  different regions); both capabilities verified present by grep.
- **`vercel.json`**, `api/_oauth.js`, `api/oauth/authorize.js`,
  `api/well-known-protected-resource.js` — mcp-oauth-only, unchanged.
- **Tests:** both suites green on the reconciled branch —
  `tests/api/mcp-phase2.test.js` (AC-153 guardrail) and
  `tests/api/mcp-oauth.test.js` (token validation + three authorize paths).
  `node --test` overall green; eslint at baseline parity (no new errors).

History reconciliation only — no tool logic or native code changed. CC did not
self-merge; the Architect merges to main after Richard's dashboard config and
verifies the Vercel deploy.

## 2026-06-22 — AC-153: `log_session_feedback` fabrication guardrail (GATE 2 blocker)

Branch `fix/ac-153-log-session-feedback-guardrail` (off `origin/main`). Server-side
MCP fix in `api/_mcpTools.js` + `api/mcp.js` — **not** an EAS/native change.

**What went wrong (verified live, 22 Jun).** During Gate-2.5, `log_session_feedback`
was called against a real activity *without* athlete-provided subjective values:
the calling model invented `rpe=3` and wrote a third-person metrics summary into
`subjective_notes`, overwriting the athlete's real note. Both were committed; the
real note was destroyed (since restored by the Architect). The write **plumbing
was already correct** (correct row, partial payload, `subjective_captured_at` set,
`subjective_notes` not `notes`, no `updated_at`) — the only defect was the missing
fabrication guardrail. The fabrication originated in the **caller**, not the server.

**Fix — three properties (`log_session_feedback`):**
- **Partial update (already correct, now documented + tested):** only caller-supplied
  fields are written; an omitted field is left untouched (PATCH sends only provided
  columns), so `rpe`-only preserves an existing `subjective_notes` byte-for-byte.
- **Refuse-when-empty:** with no athlete-provided subjective field the tool writes
  nothing (propose *and* commit) and returns `{ committed:false, refused:true,
  error:"No athlete-provided subjective values supplied…" }`.
- **Schema/description hardening (the real gap):** the tool description and every
  subjective param (`rpe`/`feel_legs`/`injury_flag`/`notes`) now carry an explicit
  verbatim-only / never-infer-from-metrics clause to steer the calling model, for
  **any** sport. No server-side synthesis existed to remove.
- **Return contract:** `commit:true` returns the actual mutated row + `changed_columns`.
  `rpe` stays a raw 1–10 integer (no `feel_score`, no inversion).

**Tests (`tests/api/mcp-phase2.test.js`):** AC-153 TEST 1 (refuse-when-empty, no
mutation — the regression-catcher), TEST 2 (rpe-only never sends `subjective_notes`;
live readback preserves the note byte-for-byte), TEST 3 (live happy-path: verbatim
values, `created_at` unchanged = UPDATE not INSERT, capture stamped), TEST 4 (dry-run
mutates nothing; `notes`→`subjective_notes`). All 39 phase-2 cases green, incl. the
gated live-readback layer. No new lint errors (baseline parity).

**Out of scope / flagged:** the unmerged `mcp-oauth` branch carries its own copy of
this tool and needs the same guardrail before it merges. The `feel` column is not
currently writable by the tool (not expanded here — a separate decision).

## 2026-06-21 (later 2) — MCP server Path B: OAuth for the web/mobile connector

Adds OAuth 2.1 discovery + consent so the Claude WEB/MOBILE connector can connect
(it can't use a static bearer). Auth layer only — 14 tools + single-user scoping
unchanged. Branch `mcp-oauth` off origin/main 8e55265. Mechanism: Supabase-
delegated (Supabase Auth is the OAuth 2.1 authorization server).

- `api/mcp.js`: unauthenticated requests now return `401` with
  `WWW-Authenticate: Bearer resource_metadata="…"` (RFC 9728). New exported,
  dependency-injectable `authorizeRequest()` accepts THREE paths: shared_secret
  (MCP_SHARED_SECRET), oauth (Supabase JWKS-validated access token), supabase_jwt
  (legacy remote introspection). Bearer/JWT path preserved (regression-tested).
- `api/_oauth.js`: validates OAuth access tokens via Supabase JWKS (jose) —
  signature/expiry + issuer + `aud="authenticated"` + `sub=ATHLETE_USER_ID`
  (single-user binding). Documented audience deviation (ruling #1) + revisit
  trigger in docs/mcp.md.
- `api/well-known-protected-resource.js` + vercel.json rewrites: serves RFC 9728
  protected-resource metadata at `/.well-known/oauth-protected-resource`
  (and `…/api/mcp`) pointing at the Supabase issuer.
- `api/oauth/authorize.js` + rewrite: consent page (ruling #2) — REQUIRES Supabase
  login before Approve (makes DCR safe); uses supabase-js `auth.oauth`
  getAuthorizationDetails/approveAuthorization/denyAuthorization.
- Dep: `jose` for JWKS validation.
- Tests: `tests/api/mcp-oauth.test.js` — 13 cases (46 total across all suites),
  all green: token validation (aud/sub/expiry/array-aud), three authorize paths
  incl. bearer regression + cross-user rejection, PRM JSON, 401-with-header,
  OPTIONS. (Real token + browser consent covered by the manual web-connector GATE.)
- Pending: Richard dashboard config (Site URL, Authorization Path=/oauth/authorize,
  DCR redirect validation, anon key available to functions) → merge → deploy →
  Architect verifies unauthenticated request returns WWW-Authenticate → manual
  web-connector connect test. Rotate MCP_SHARED_SECRET (still needed for CC/API).

## 2026-06-21 (later) — MCP server Phase 2 (nice-to-have reads + first writes)

Code complete on branch `mcp-server-phase2` (worktree off origin/main 076941a).
Adds 7 tools to the MCP server (now 14) per Architect mini-gate rulings.

- **New reads:** `get_nutrition` (nutrition_logs range + alcohol_units tally),
  `get_weekly_review` (coaching_memory `category='weekly_review'`), `get_routes`
  (list athlete_routes named locations; `route_id` → `get_route_coach_context` RPC).
- **get_recovery** now returns `date` + `age_days` per metric (ruling #4 — plain
  date math; the canonical 24/24/36h freshness threshold is NOT re-derived
  in-server). `compliance_score` added as a field on `get_recent_activities` and
  `get_activity_detail` (+ grade/summary on detail).
- **New writes (propose-by-default; `commit:true` required; return mutated row):**
  `log_session_feedback` (PATCH activities, raw RPE, never a feel_score),
  `propose_schedule_change` (INSERT schedule_changes `status='pending'`, never
  mutates scheduled_sessions; title+reasoning required NOT NULL),
  `write_coaching_memory` (idempotent upsert on user_id,date,source),
  `update_athlete_profile` (only weight_kg/goal_type/health_notes; no silent-fill).
- **Deferred (rulings):** `get_compliance` aggregate (no server source → flagged
  for future RPC; per-activity compliance_score surfaced as a field instead),
  `get_weather_context` (net-new outbound API), race/goal profile edits
  (athlete_sports). The native `index.tsx` PROFILE_UPDATE handler writes 6
  nonexistent athlete_settings columns — logged for a separate native fix.
- **REST client** gained `restPost`/`restPatch` (Prefer return=representation;
  upsert via on_conflict + merge-duplicates) in `api/_supabaseRest.js`.
- **Tests:** `tests/api/mcp-phase2.test.js` — 17 cases (33 total with Phase 1),
  all green. Layer-1 deterministic (propose/commit gating, no-silent-fill,
  propose-not-mutate, raw-rpe, age_days, compliance field, idempotency) + Layer-2
  live read-back / idempotency / parity on the test project (nutrition_logs,
  coaching_memory, athlete_settings, activities, schedule_changes). Test-fixture
  parity migrations applied to the **test project only** (additive, idempotent):
  activities feedback/compliance cols, coaching_memory unique index,
  nutrition_logs.meal_timing.
- **Pending:** GATE 2 = merge to main → Vercel deploy → Architect deploy-ID
  verify + Gate-2.5 one real write flow. Phase 3 not started.

## 2026-06-21

### Coach Claude MCP server — Phase 1 (read-only), code complete on `mcp-server-phase1`

New remote MCP server exposing the athlete's training data as tools so any MCP
client (Claude chat) can pull live state. Built on a worktree off `origin/main`
(491396b) — does not touch the in-flight `b1-regenerate-coaching-artifact` work.

- **Host:** Vercel Node serverless route `api/mcp.js`, stateless MCP
  Streamable-HTTP (`@modelcontextprotocol/sdk` ^1.29), `maxDuration: 30`. New
  helper `api/_supabaseRest.js` (injectable copy of the analyze-activity
  `restGet`/`callRPC` plumbing — does not perturb the live analyze path); tools
  in `api/_mcpTools.js`.
- **7 read-only tools** (all single-athlete): `get_athlete_profile`,
  `get_recent_activities`, `get_activity_detail`, `get_scheduled_sessions`,
  `get_training_zones`, `get_recovery`, `get_coaching_memory`. See `docs/mcp.md`.
- **Wrap not reimplement:** Tier-1 tools wrap `get_athlete_coaching_context`
  (HR zones from `training_zones`, never the NULL `hr_zones`); Tier-2 are plain
  column reads. No zone/pace/compliance maths recomputed.
- **NEVER FABRICATE:** every missing field returns an explicit `"NOT AVAILABLE"`
  marker. `intervals_data` multi-activity-day ambiguity is flagged + the block
  omitted (the `(user_id,date)` keying has no `activity_id`).
- **Auth:** `Authorization: Bearer` = `MCP_SHARED_SECRET` (**new Vercel env, to
  set**) or a valid Supabase JWT. Service-role key stays server-side.
- **Tests:** `tests/api/mcp.test.js` — 16 cases green (`node --test`). Layer-1
  deterministic mock-projection (incl. SDK wiring, Vienna bucketing, sparseness)
  + Layer-2 live seed-and-parity against the test project for `coaching_memory`
  and `scheduled_sessions` (RPC/view/intervals tools not on the test project —
  covered by Layer-1 + the Gate-1.5 manual prod check). Prod-guard respected.
- **Pending:** GATE 1 = deploy (merge to `main` → Vercel) + Architect deploy-ID
  verify + one real multi-tool flow in Claude. Phases 2/3 not started.

## 2026-06-09

### analyze-activity — run/walk/hike cadence doubling (c4719e8b) + injury source confirmed single-source (9808c786 / 62b39fbb)

On-device QA of the ITEM 3 release surfaced two correctness issues on the Coach Analysis card, same endpoint, one Vercel deploy.

- **Cadence doubling (`api/analyze-activity.js`):** the card showed `CADENCE & STABILITY 85.1 avg` (raw per-leg) while enrich-activity v16's backfilled `cadence_stats` read ~170 (true steps-per-minute) — two surfaces disagreed. Root cause: `activities.avg_cadence` is written RAW per-leg by the Strava import (`api/strava-webhook.js` — `average_cadence`); enrich v16 only doubled `activity_streams.cadence_stats`, never `avg_cadence`. `analyze-activity` sent BOTH the raw `avg_cadence` (~85) and the doubled `cadence_stats` (~170) to the model. Fix: new `sportDoublesCadence()` + `cadenceDisplayAvg()` helpers (SAME `CADENCE_DOUBLE_SPORTS` set as enrich-activity v16 / `lib/splits.ts`) double `avg_cadence` for run/walk/hike in `buildAnalysisPrompt`; `cadence_stats` (already doubled upstream) and ride/row rpm are left untouched — no double-doubling. Now both cadence inputs agree at ~170.
- **Injury source — confirmed already single-source (no change):** `analyze-activity` already reads `injury_reports` under the status-based rule (`status='active'`, `follow_up_overdue` computed live, regardless of `follow_up_due_date`) — it does NOT read `health_flags` or a frozen copy. Radar **62b39fbb** (health_flags vs injury_reports split) is therefore already folded for this endpoint.
- **Stored-artifact staleness — deferred (design-only):** the observed bug (activity 333 still showing a now-resolved calf ~4.5h after resolution) is the **frozen stored `coach_analysis`** artifact, not the live read — `decideSkip` returns `'exists'` and never re-generates, and the native app renders the stored column verbatim (no serve-time overlay path exists server-only). The systemic fix is a generalised **regenerate-on-source-change** mechanism (covers injury status, zone recalibration, and the deferred macro Coach's-Take rolling refresh) — **designed, not built** this cycle (architect decision: avoid an injury-only pg_net trigger that risks the 30s timeout and would be rebuilt). Design: `docs/features/regenerate-on-source-change.md`. Stale cards (incl. 333) are cleared by the architect's manual post-deploy `force`-re-run, which also picks up the cadence doubling.
- **Version:** `analyze-activity@v1.1` unchanged (it lives in `prompt_data_completeness.prompt_version`; independent of the `coach-take@v1` / `proxy-guardrail@v1` hallucination detector keyed off `raw_data.coach_take_audit` — no overlap).
- Tests: `tests/api/analyze-activity.test.js` (+3: `sportDoublesCadence` set membership, `cadenceDisplayAvg` run→×2 / ride unchanged / null passthrough, `buildAnalysisPrompt` run `avg_cadence`→170 & ride→85 — 38 total, all pass).

### enrich-activity v16 — 2026-06-09

Deployed via Supabase MCP (verify_jwt: false).
- Cadence doubling for run/walk/hike: computeCadenceStats now applies x2 via sportDoublesCadence(), so cadence_stats agrees with per-split cadence. Steps-per-minute, not per-leg. Ride/row keep raw rpm.
- Status-based injury rule: coaching-feedback injury query drops the .gte('follow_up_due_date', today) filter, keeps .eq('status','active'), and flags follow_up_overdue — surfacing active-but-overdue injuries (matches analyze-activity behaviour).
- prompt_version intentionally unchanged ('enrich-activity@v14') to avoid touching the briefing hallucination detector.
- One-time cadence backfill run against 60 historical run/hike activity_streams rows (doubled avg + trend).

### analyze-activity — load athlete RPE/feel + active injuries (data-complete)

Activity Detail QA showed Path A marking RPE "not available" on an activity that HAS `rpe=2`, and the older prose Take (now removed from the screen) was the only block citing the athlete's RPE + active injury — so the tidy-up shipped this data fix in the same pass to avoid losing information.

- **Subjective data:** `api/analyze-activity.js` SELECT now includes `feel` (already loaded `rpe`, `feel_legs`, `injury_flag`); the prompt passes raw `rpe`/`feel`/`feel_legs` as RAW inputs (no computed feel/effort score — the RAW-RPE rule interprets them against the planned session intensity). Audit gains `has_feel`, `has_feel_legs`; `prompt_data_completeness.has_rpe` now reports `true` when rpe is present (and `rpe` is not listed in `not_available`).
- **Active injuries:** loads from `injury_reports` under a **status-based rule** — surface `status='active'` REGARDLESS of `follow_up_due_date`, flagging `follow_up_overdue` and noting "follow-up overdue since <date>" (an active injury past its follow-up is the most important to surface, not silently drop). New INJURY-AWARE system rule; audit gains `has_active_injuries` + `active_injury_count`.
- **⚠️ Divergence flagged:** `enrich-activity` still filters injuries by `follow_up_due_date >= today` (a different rule) — so its briefing feedback can drop an overdue-but-active injury that the analysis now surfaces. Aligning `enrich-activity` to the status-based rule is a fast-follow (not in this pass).
- Tests: `tests/api/analyze-activity.test.js` (+4: `has_rpe=true` on the id-333 shape, `rpe` not in `not_available`, injuries audited, prompt surfaces injuries + raw rpe/feel — 31 total); `tests/ai-eval/analyze-activity-eval.js` data-rich fixture adds `rpe_loaded_has_rpe_true` / `rpe_not_in_not_available` (eval 3/3).

### Path A — go-live complete

- Both branches merged (web `main` `bef4b8b`; native `main`). `ANALYZE_ACTIVITY_SECRET` wired on both Vercel (Production) and the Supabase trigger side. `trigger_analyze_activity` created and live (AFTER UPDATE → `enrichment_status='complete'`, fire-and-forget pg_net POST `{ activity_id }` + `x-analyze-secret`). Architect verified one real activity end-to-end: sync → enrichment → trigger → `analyze-activity` → `coach_analysis` populated (`generation_status='ok'`, `prompt_data_completeness` audited, no fabrication) → renders on Activity Detail + Coach's Take. iOS build **v1.5.0 (30)** submitted to TestFlight (native repo).

### analyze-activity@v1.1 — fix JSON truncation (parse_failed on data-rich activities)

- **Bug:** on a data-rich activity (e.g. id 333 — HR zones + 14 splits + 424-sample stream + planned session) the Haiku output hit `max_tokens` and was cut off mid-string → `JSON.parse failed: Unterminated string` → `generation_status='parse_failed'`, `coach_analysis` stayed NULL (fail-closed, correct — but nothing rendered). Original `max_tokens` was **1200**.
- **Fix (`api/analyze-activity.js`, `api/` only):**
  - `max_tokens` 1200 → **2500** (full bounded schema worst-case ~1k output tokens + ~2x headroom).
  - **Trimmed prompt input to aggregates**: stopped sending the 140 downsampled raw stream samples; the prompt now sends HR-zone distribution (min + %), cadence avg+trend, grade correlation, and a compact splits summary (idx/km/pace/HR, capped 16) — mirroring the enrich-activity coaching prompt. Less input → lower latency and smaller output.
  - **JSON-only enforcement**: system prompt now says "Output ONLY a single complete, valid JSON object … no fence", with explicit per-field character caps so a complete object fits the budget; generation prefills the assistant turn with `{`.
  - **One retry** on parse failure (then unchanged fail-closed: record `generation_status='parse_failed'` + `parse_error`, write no `coach_analysis`).
  - `parseAnalysisJSON` made robust to trailing tokens after the object. Audit `prompt_version` → `analyze-activity@v1.1`.
- **Test:** `tests/ai-eval/analyze-activity-eval.js` gains a `data_rich_full_metrics_no_truncation` fixture (the id-333 shape) asserting `generation_status` would be ok — a complete object with every top-level key parses (regression guard). Eval green (3/3 fixtures); 27 endpoint unit tests green.

### Path A — automatic per-activity AI analysis

- **`api/analyze-activity.js`** (new Vercel function): generates a structured, multi-sport `coach_analysis` from the FULL detailed activity data (streams, splits, zones, cadence) when enrichment completes, and writes it back onto the activity. Auth via `x-analyze-secret` (`ANALYZE_ACTIVITY_SECRET`), service-role reads/writes. Idempotent with a dual-source dedup guard (skips `exists` / `incomplete` / `dup`). Builds the athlete-state snapshot inline from base tables (no `athlete_state_snapshot` view). STRICT-JSON Haiku output with NEVER-FABRICATE (explicit NOT AVAILABLE list), raw RPE (no computed feel score), HR data-quality guard, and tag-mismatch surfacing. Stores a `prompt_data_completeness` audit; on parse failure leaves `coach_analysis` null for retry and returns 5xx.
- **`activities` schema**: added `coach_analysis` (jsonb), `coach_analysis_generated_at`, `coach_analysis_model`, `coach_analysis_version`, `prompt_data_completeness`. New trigger `trigger_analyze_activity` (`AFTER UPDATE` on transition to `enrichment_status='complete'`) fire-and-forget POSTs `{ activity_id }` to the endpoint.
- **Tests**: `tests/api/analyze-activity.test.js` (pure guard-logic unit tests + live auth/method wiring smoke); `tests/ai-eval/analyze-activity-eval.js` + `npm run test:ai-eval:analyze` (fabrication detector — asserts no claim about NOT AVAILABLE metrics, reads the planned session, no invented splits/zones, and flags a Z2-run-tagged-tempo fixture).
- **Native** (`athlete-coach-native`): activity-detail screen renders the full structured report (`renderCoachAnalysis` in `app/activity/[id].tsx`); feed card (`components/ActivityCard.tsx`) shows headline + top flag. Pure helpers + states in `lib/coachAnalysis.ts`. Handles pending / generating / present / failed.

### enrich-activity: soft-deleted streams never read (78d16ed2 / AC-153)

- **`supabase/functions/enrich-activity/index.ts`** (the canonical copy lives in the **native** repo — the web-repo copy is a stale March fork with no stream reads): added `.eq('is_deleted', false)` to all three `activity_streams.select(...)` reads (the enrichment-score count + two `samples` reads for splits reconstruction), matching the predicate in `api/analyze-activity.js`. Prevents a soft-deleted stream row from being read into enrichment/splits, and prevents the `.maybeSingle()` "multiple rows" error when a live + soft-deleted row coexist. Source-level guard `ac-153-soft-delete-cascade` now green.
- **Test**: `tests/api/enrich-activity-soft-delete.test.js` — gated on `TEST_SUPABASE_FUNCTIONS_URL`; seeds a live + a soft-deleted stream row and asserts enrichment reads only the live row.

### Coach's Take (prose) now renders on Activity Detail (693ada6a)

- **`app/activity/[id].tsx`** (native): the prose Coach's Take stored in `coaching_memory` (the `memory` state) was fetched but never rendered, so a written take was invisible on activities without intervals data (e.g. manual logs). Added `renderCoachsTake()` — a white-card render distinct from the structured `coach_analysis` card. To avoid duplicating the take when the intervals-backed `analysisSummary` already shows it inside `renderTrainingAnalysis`, it renders only when `analysisSummary` is absent. Empty state is quiet (renders nothing). Smoke-pinned in `__tests__/coachAnalysisRender.test.ts`.

## 2026-04-05

### Native app: HealthKit → Supabase pipeline

- **`lib/healthKitSync.ts`**: new file — `runHealthKitSync(userId)` pulls 6 months of workout and passive metric history from HealthKit into Supabase on first launch. Workouts are gap-filled into `activities` (source='healthkit', dedup by date+type vs existing Strava rows). Passive metrics (resting HR, HRV, sleep, steps) written to new `health_metrics` table.
- **`health_metrics` table**: created with RLS, unique constraint on `(user_id, metric_type, date)`, indexes on `(user_id, date)` and `(user_id, metric_type, date)`.
- **`activities` schema**: added `source TEXT DEFAULT 'strava'` and `healthkit_uuid TEXT` (unique index WHERE NOT NULL).
- **`athlete_settings` schema**: added `healthkit_sync_enabled BOOLEAN` and `healthkit_last_synced_at TIMESTAMPTZ`.
- **`app/(tabs)/index.tsx`**: `useEffect([userId])` calls `runHealthKitSync` once per session after auth confirmed. Silent background — no spinner, no user-visible error.
- **`buildContext.js`** (web app): added `health_metrics` query (last 30 rows) to `buildContext()`; added `HEALTH METRICS` section to `formatContext()` showing 7-day avg resting HR, latest HRV, last night's sleep, yesterday's steps.

### Web app: multi-user support

- **Removed hardcoded `ATHLETE_USER_ID`**: `api/strava-webhook.js` now routes by Strava `owner_id` → `strava_tokens` table. Per-user token fetch and auto-refresh. No env-var refresh token.

### Web app: multi-user support

- **Removed hardcoded `ATHLETE_USER_ID`**: `api/strava-webhook.js` no longer contains a hardcoded user UUID or uses `STRAVA_REFRESH_TOKEN` from env vars
- **Per-user token routing**: `getUserForStravaAthlete(stravaAthleteId)` looks up `strava_tokens` by `athlete_id` (Strava's `owner_id`); `getStravaTokenForUser(tokenRow)` checks expiry, auto-refreshes, and updates the table — one function per user
- **`buildActivityRow(activity, userId)`**: now takes `userId` as an explicit parameter instead of closing over a constant
- **Graceful unknown-user handling**: if no `strava_tokens` row exists for an `owner_id`, the webhook logs and returns without writing a broken row (Strava will retry)
- **No frontend changes required**: `buildContext.js` was already RLS-clean; no `ATHLETE_USER_ID` references existed outside `api/strava-webhook.js`
- **`STRAVA_REFRESH_TOKEN` Vercel env var**: now unused — can be removed from Vercel dashboard (Settings → Environment Variables)

## 2026-04-04

### Native app: Plan tab — 5 bug fixes

- **Week boundary (Mon–Sun)**: `getWeekRange()` now uses Monday as the first day of the week (`daysToMonday = dow === 0 ? -6 : 1 - dow`). Sunday is now correctly part of the current week, not the next. Display changed from "29 Mar – 4 Apr" to "30 Mar – 5 Apr".
- **Schedule change approval**: `acceptProposal` now sets `schedule_changes.status = 'applied'` (was `'accepted'`). The DB update to `scheduled_sessions.planned_date` was already correct; only the status value was wrong, which prevented the change from being marked done.
- **Teal as primary accent**: all uses of `theme.colors.accent` (purple) in Plan screen replaced with `theme.colors.primary` (teal) — session card borders, today indicator dot, today row background, proposal card borders, Accept/Submit/Send buttons. `theme.colors.accentMuted` → `primaryMuted` for today row highlight. Same fix applied to `ObjectivesHeader` countdown numbers and settings link.
- **Text contrast on coloured backgrounds**: text/icon colors changed from `#000` to `#fff` on all teal backgrounds — user chat bubble text, Apply/Accept/Submit button labels, chat send button icon/spinner, request submit spinner.
- **Base build progress (0% → ~33%)**: `computeTrainingPhase` now accepts an optional `planStartDate`. For the Base Building phase: `totalWeeks = weeksToRaceAtStart - 20` and `weeksElapsed = weeksToRaceAtStart - weeksRemaining`, giving correct elapsed percentage. Fixed the same formula bug for Build/Peak/Taper phases (all were calculating elapsed as 0). `ObjectivesHeader` now fetches `MIN(planned_date)` from `scheduled_sessions` and passes it as `planStartDate`.

### Native app: HealthKit completion

- **Debug logging**: `[HealthKit]` prefixed console logs added to `initHealthKit`, `getRestingHR`, `getHRV`, `getSleep`, `getSteps`, `getActiveCalories`, and `syncHealthSnapshot` — logs raw results before transformation and final payload before upsert; also calls `AppleHealthKit.isAvailable` after init for diagnostics
- **Foreground sync**: `syncHealthSnapshot()` is now called from the AppState `'active'` handler in `app/(tabs)/index.tsx`, so health data refreshes every time the app comes back to the foreground
- **Steps + Active Calories**: added `Steps` and `ActiveEnergyBurned` to HealthKit read permissions; new `getSteps()` function reads today's step count (iPhone accelerometer, no Watch required); new `getActiveCalories()` sums `ActiveEnergyBurned` samples for the day; both included in `syncHealthSnapshot` Promise.all and upsert payload
- **Schema additions**: `health_snapshots.steps INTEGER`, `health_snapshots.active_calories INTEGER`, `health_snapshots.source TEXT DEFAULT 'apple_health'` (migration applied to production)
- **RecoveryStrip fallback**: strip now always shows RHR / HRV / Sleep columns with `–` when values are null, instead of hiding entirely; steps and active_calories columns appear dynamically when data is available; null values render in muted colour
- **wearable_connections table**: created with columns `user_id`, `provider`, `status`, `connected_at`, `last_sync_at`, `metadata`; RLS enabled; upserts Apple Health connection record on every successful `initHealthKit`; updates `last_sync_at` after each successful `syncHealthSnapshot`
- **Briefing context**: steps and active_calories injected into daily briefing prompt and coach chat context when available
- **Code comment**: `lib/healthkit.ts` now has a top-level comment explaining Apple Health data requirements (Watch needed for RHR/HRV/Sleep; iPhone accelerometer suffices for Steps/Calories)

### Native app: targeted fixes (Fix 1–5)

- **Coach feedback position**: moved above HR zone bar in activity detail screen (order: stats → coach feedback → zone bar → charts)
- **HR chart smoothing**: invalid HR values (null / ≤0 / ≥250) filtered before rendering; path rebuilt using cubic bezier `C` commands; data gaps >30s lift the pen (`M`) instead of drawing through the gap — applies to all zone-coloured segments
- **Plan tab: completed activity tap**: session chips with a matched activity now navigate to `/activity/[id]` instead of `/session/[id]`
- **Session compliance timezone fix**: `activityLocalDate()` in plan.tsx now converts to Europe/Vienna via `toLocaleDateString('en-CA', { timeZone })` instead of slicing the first 10 chars — fixes late-evening activities being assigned the wrong day
- **Progress — weekly compliance**: `WeeklyComplianceChart` now cross-references activities against session dates (Vienna TZ) instead of relying solely on `status === 'completed'`; compliance bars now show actual completions even when session status hasn't been updated
- **Activity trend chart — zone data**: `zone_data: null` activities are skipped when summing zone seconds; Zones view shows "Zone data will appear after your next synced run" empty state when no zone data exists
- **coaching_memory 400 fix**: inserts in `activity/[id].tsx`, `activity-capture.tsx`, and `evening-checkin.tsx` now include `source` and `date` fields, matching the schema required by the table

### Native app: SVG chart redesign

- **`constants/Colors.ts`**: New shared palette file — Txture brand teal (#0C8C82 light, #17C1B5 dark), zone colours, semantic tokens. All new components reference this instead of inline hex strings.
- **`ActivityTrendChart`** rewritten with `react-native-svg`: cubic bezier line chart (weekly volume), stacked bar chart (zone distribution). `onLayout` pattern for dynamic width; Vienna-timezone week bucketing via `getViennaMonday()`.
- **`components/ActivityCharts/HeartRateChart`**: elevation silhouette (filled, 15% opacity) + zone-coloured HR line segments + dashed zone threshold lines at 120/140/155/170 bpm. Coach note with teal left border.
- **`components/ActivityCharts/PaceChart`**: elevation silhouette background + teal pace line (breaks on stops ≤0.2 m/s) + inverted Y-axis (fast pace at top). Formats as mm:ss.
- **`components/ActivityCharts/ElevationChart`**: teal-tinted filled area + total gain overlay badge.
- **Activity detail screen** (`app/activity/[id].tsx`): replaced `MultiMetricChart` with three separate `CollapsibleCard` sections (Heart Rate / Pace / Elevation), each defaultOpen=false.

### Native app: post-activity subjective capture flow

- **`lib/notifications.ts`**: AsyncStorage-backed pending state for post-activity capture and evening check-in. Phase 2 ready — `TODO` comments mark where `Expo Notifications.scheduleNotificationAsync()` will be inserted. Functions: `notifyActivityReady`, `getPendingCapture`, `clearActivityCapture`, `scheduleEveningCheckin`, `getPendingEveningCheckin`, `clearEveningCheckin`.
- **`app/activity-capture.tsx`**: 4-step full-screen modal — injury flag (auto-advance) → leg feel (auto-advance) → RPE slider → optional notes. On submit: saves to `activities`, calls `claude-proxy` (250 tokens), parses numbered sections + optional `RESCHEDULE PROPOSAL:`, saves to `coaching_memory`, schedules evening check-in. Coaching result screen shows Recovery / Fuelling / Sleep / Tomorrow cards with coloured left borders; reschedule card with Accept (inserts to `schedule_changes`) / Not now.
- **`app/evening-checkin.tsx`**: Lightweight modal — injury feel (better/same/worse, only shown when `injury_flag ≠ 'nothing'`) + refuel confirmation. On submit: saves `evening_checkin_data` JSONB, updates `last_evening_checkin_date`, writes `injury_escalation` to `coaching_memory` if worse, clears AsyncStorage flag.
- **Home screen** (`app/(tabs)/index.tsx`): checks `getPendingCapture` and `getPendingEveningCheckin` on mount and on AppState `active`; renders teal prompt card (post-activity) and amber prompt card (evening check-in) above briefing when pending.
- **Morning briefing**: injects yesterday's subjective data (RPE, leg feel, injury flag, evening check-in result) when `morning_reference_enabled` is true. Prepends `⚠️ PRIORITY:` line when injury was flagged or worsened overnight.
- **Settings screen** (`app/settings.tsx`): new "Training Notifications" section with post-activity toggle, evening check-in toggle, hours-after stepper (2h/3h/4h), morning briefing reference toggle. Saves immediately to `athlete_settings.notification_prefs`.

### Backend: schema additions (activities + athlete_settings)

- `activities.rpe INTEGER` — rate of perceived exertion (1–10)
- `activities.feel_legs TEXT` — CHECK: `fresh | normal | heavy | dead`
- `activities.injury_flag TEXT DEFAULT 'nothing'` — CHECK: `nothing | niggle | flagged`
- `activities.subjective_notes TEXT` — free-text athlete notes
- `activities.subjective_captured_at TIMESTAMPTZ` — set when capture is submitted
- `activities.evening_checkin_data JSONB` — `{ injury_feel, refuelled, checked_in_at }`
- `athlete_settings.notification_prefs JSONB` — `{ post_activity_enabled, evening_checkin_enabled, morning_reference_enabled, evening_checkin_hours_after, evening_checkin_cutoff_hour }`
- `athlete_settings.last_evening_checkin_date DATE` — guards against duplicate evening prompts

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
