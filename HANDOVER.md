# HANDOVER — Activity card POST-BUILD corrections · Chunk A (analyze-activity v1.2.1) — 2026-06-23

- **Repo:** web. **Branch:** `fix/activity-card-postbuild` (off `origin/main`). **Vercel/no-EAS.** Architect deploys + **re-runs the force-regen backfill** (required — see below).

Targeted fixes (no re-architecture), evidence = stored card **id=367**:
- **1.A mid-word truncation:** added boundary-safe `clampText` (exported) — last sentence end, else last word boundary, strips dangling punctuation, NEVER mid-word. `coerceAnalysisShape` delegates to it; caps raised (call ≤120, action ≤140, summary ≤450, session/plan_line ≤120, annotation ≤220, flag ≤120). Prompt rule 12 = complete sentences within caps + terse flags.
- **1.B internal-term leak:** rule 8 bans "bucket"/"qualitative bucket"/"correlation"/"coefficient"/"model"/"schema"/"fingerprint"; grade stated as plain terrain language (the user-prompt GRADE line + rule 8 both fixed — the old "reference the bucket" wording was the leak source).
- **1.C one-home scope:** rule 7 — a metric finding (decoupling/drift/surge) lives in its block annotation ONLY; summary must not restate it; a flag may raise it *instead*, terse label-style. Kills decoupling-stated-3×.
- **`SCHEMA_VERSION` → `analyze-activity@v1.2.1`** so `shouldSkipRegen`'s `prompt_version !== SCHEMA_VERSION` gate forces re-gen of every stored v1.2 card.
- **Tests:** `tests/api/analyze-activity-card-postbuild.test.js` (8) + updated fixtures in `analyze-activity.test.js`. **55/55** across the four analyze-activity suites.

**⚠ DEPLOY (architect):** 1) merge + deploy to Vercel; verify a fresh run — no mid-word cut, no "bucket"/internal terms, decoupling once. 2) **RE-RUN the force-regen backfill** (same A4 DO-block) so all stored cards (incl. 367) adopt v1.2.1 — existing v1.2 cards keep the truncated/leaked/duplicated text until regenerated. Native render correction (Chunk C) ships on the next EAS build.

---

# HANDOVER — Activity card redesign #6 · Chunk A (analyze-activity v1.2) — 2026-06-23

- **Repo:** web. **Branch:** `feat/activity-card-redesign` **stacked on `fix/analyze-activity-injury-freshness` (PR #11)** — PRESERVES #11's force/fingerprint/triggers. **Vercel/no-EAS.** Architect deploys (after #11) + behavioural-gates + runs the one-off backfill.

**Chunk A (this PR) — analyze-activity schema/prompt/pace, v1.2:**
- **2.A new schema:** replaced v1 (`headline/coach_note/effort_read/key_signals/execution_vs_plan`) with `{ sport, verdict{call,plan_verdict,action}, type_inference, summary, measured_against, metric_blocks[]{metric_key,label,canonical_value,session_line,plan_line,annotation,data_available}, flags[] }`. `coerceAnalysisShape` emits `schema:'v1.2'` so the native render can detect old vs new cards (defensive 2.D).
- **2.B prompt:** kept NEVER-FABRICATE/RPE/HR-quality/PLAN-FIRST; added SCOPE (no repetition — verdict once), NO-META/NO-QUESTIONS (no coefficients/method), PACE-FORMAT (reproduce mm:ss, never compute), FUEL (in NA when no nutrition), GRADE bucket only, INJURY compose rule ("only surface injuries in THIS input; never carry forward" — composes with #11's resolve-triggers).
- **2.C pace:** `fmtPace(m/s)→mm:ss`; splits summary + the pace block use it. Kills "5:73".
- **grade:** `gradeImpactBucket(elev,|r|)→minimal|moderate|significant`; the raw `grade_correlation` no longer reaches the prompt.
- **fuel:** `'fuel'` always in `not_available` (no nutrition channel) → no fabricated fuelling.
- **v1.2 / #11 compose:** `SCHEMA_VERSION='analyze-activity@v1.2'` is `prompt_version` in `prompt_data_completeness`; `shouldSkipRegen` now also requires `prompt_version===SCHEMA_VERSION`, so a trigger-driven force on a still-v1.1 card regenerates under the new schema (manual force always regenerates). #11's mechanism intact.

**Tests:** `tests/api/analyze-activity-card-redesign.test.js` (fmtPace incl. the `/\d:[6-9]\d/` guard, grade bucket, v1.2 normalize, schema-version skip) + updated `analyze-activity.test.js` v1.2 fixtures + #11's freshness test fixture. **48/48** across the three analyze-activity suites. `node --check` clean.

**Deferred to later chunks (per the brief):** Chunk B = `intervals_data.activity_id` migration + `lib/intervalsSync.ts` writer (Supabase/Phase-A). Chunk C = native card render (2.D/2.E: verdict/summary/fixed-order metric_blocks + mandatory annotations; HR zones from `activities.zone_data`; `Load (est.)` from avg_hr/LTHR; defensive v1 fallback) + docs (screens/database/architecture/changelog). The **AI-eval rubric** (verdict-once / no-meta / no-coefficient / no-fuel / pace mm:ss / zone==graph) is the architect's behavioural gate (DEPLOY step 1) — deterministic parts are covered by the 48 tests.

---

# HANDOVER — Analysis card flags resolved injuries as current (9808c786) — 2026-06-23

- **Repo:** `richardstow-code/athlete-coach` (web). **Branch:** `fix/analyze-activity-injury-freshness` (worktree off `origin/main` @ `fdd89dd`). **Type:** Vercel (`api/analyze-activity.js`) + a DB-trigger migration — **no EAS**. Architect deploys (Vercel first, then the trigger via Supabase MCP) + behavioural gate.

## STEP 1 — enumeration (verified live)

- **1.1** `api/analyze-activity.js` generates `coach_analysis` **once** via `trg_analyze_activity_on_complete` (`AFTER UPDATE OF enrichment_status → 'complete'`, `WHEN coach_analysis IS NULL`). It reads active injuries at gen time from `injury_reports?status=eq.active` (line 480) and freezes the prose. **No trigger exists on `injury_reports`** (confirmed via `pg_trigger`) → a later resolve never updates the card.
- **1.2** Canonical injury source = `injury_reports` (status active/resolved). analyze-activity is **already standardised on it** for the active-injury list; `athlete_settings.health_flags` is read as general context only, not the active/resolved decision. So the bug is **staleness, not source-confusion**.
- **1.3** Native (`app/activity/[id].tsx:532` select → `:1128` render) renders the stored `coach_analysis` **verbatim**, no live injury re-query / no serve-time overlay.

## STEP 2 — decision + fix

**Option (a) (re-query live on render) is ruled out by the brief's own constraints** — the card is client-rendered, so reconciling on render = native change = EAS, but this brief is Vercel/no-EAS. ⇒ **(b) regenerate-on-source-change.** Rulings taken (Richard): regen the *analysed-since-`reported_at`* set; **include zones**; **also harden analyze-activity** (logic in the deploy, not just the trigger).

- **`api/analyze-activity.js`** (Vercel): adds `injuryFingerprint` / `zoneFingerprint` / `stableStringify` / `shouldSkipRegen`; stores an **injury + zone source fingerprint** in `prompt_data_completeness` on every successful generation; on a `force` whose `reason` is `injury_change`/`zone_change`, **skips the LLM when that fingerprint is unchanged** (so the triggers are safe to over-fire). A manual `force` always regenerates; a legacy card with no stored fingerprint regenerates once.
- **`supabase/migrations/20260623_analyze_activity_regen_on_injury_zone_change.sql`** (architect applies): two triggers mirroring `analyze_activity_on_complete` (SECURITY DEFINER, `search_path=''`, vault `analyze_activity_secret`, same URL/headers): `trg_regen_analysis_on_injury` (`injury_reports` status crosses active↔not-active → POST `force` for activities with `coach_analysis_generated_at >= reported_at`) and `trg_regen_analysis_on_zone` (`athlete_settings.training_zones`/`hr_zones` change → POST `force` for analysed activities in the last 14 days). Single-athlete `WHEN` guard.

Net: a resolved injury drops out of the regenerated card (and its medical-review line) within one regen; the fingerprint guard prevents needless LLM calls / version churn on cards whose injury+zone context is unchanged.

## STEP 3 — test

`tests/api/analyze-activity-injury-freshness.test.js` — **5/5** (node --test): `injuryFingerprint` (none/empty, order-independent, **changes when an injury resolves**), `zoneFingerprint` (key-order stable, prefers hr_zones), `shouldSkipRegen` (skips only when injury AND zone fps unchanged on a trigger force; regenerates on change / manual force / legacy no-fp). Existing `analyze-activity.test.js` still **38/38**. Architect behavioural gate: resolve an active injury → the activity's card regenerates without the active / medical-review language (mirror for a zone change).

**RISK:** coaching-trust / regeneration cost — mitigated by the fingerprint skip-guard (over-firing triggers are cheap no-ops) and bounded activity sets. **No native change.** **Deploy order:** analyze-activity (Vercel) BEFORE the trigger migration (the triggers rely on the new `reason`/fingerprint behaviour). Confirm the Vercel deployment-ID flip.

> Note: this branch and `fix/recovery-data-divergence` (#3) both prepend to `HANDOVER.md`; expect a trivial top-of-file conflict when the second merges.

---

# HANDOVER — Recovery-data divergence fix (coaching-context RPC) — 2026-06-23

- **Repo:** `richardstow-code/athlete-coach` (web). **Branch:** `fix/recovery-data-divergence` (worktree off `origin/main` @ `fdd89dd`). **Type:** Supabase RPC (`get_athlete_coaching_context`) — **backend / no EAS**. Architect deploys via Supabase MCP + behavioural gate. CC does not self-merge.

## STEP 1 — enumeration (verified against the live DB)

- **1.1 The overload.** In `get_athlete_coaching_context` the SAME flag names mean opposite things in the output `core`:
  - `core.data_completeness.has_sleep|has_hrv|has_resting_hr` = **FRESH** (`v_has_*_fresh` = snapshot `has_X` AND date present AND age ≤ 24/24/36h; RPC lines 43–51, 146–148).
  - `core.athlete_state_snapshot.has_sleep|...` (`to_jsonb(v_state_snap)`, line 384) = **EXISTENCE** (the view's `has_X` = ever recorded).
- **1.2 Where the guardrail consumes it.** `api/claude-proxy.js` builds the NEVER-FABRICATE list from `dc.missing_metrics` (lines 105–109, 168–184: "the word 'sleep' may appear ONLY if sleep is NOT in the NOT AVAILABLE list"). `missing_metrics` is built from the **fresh** flags (RPC lines 141–143, 150), and `surface_extras.morning_metrics` **nulls** any non-fresh value (lines 166–168).
- **1.3 The failure.** A present-but-stale metric (e.g. sleep recorded 3 days ago > 36h threshold) → `data_completeness.has_sleep=false`, `missing_metrics=['sleep']`, `morning_metrics.sleep_hours=NULL` — **yet** `athlete_state_snapshot.has_sleep=true` with `sleep_hours=7.2` and `sleep_date` 3 days ago. The guardrail then forbids the coach from mentioning sleep → it withholds/contradicts recovery data it actually has. (View source confirmed: `athlete_state_snapshot` = `health_snapshots` ⟕ `health_metrics`.)

## STEP 2 — fix (disambiguate; suppress only genuinely-absent data)

`supabase/migrations/20260623_coaching_context_recovery_divergence.sql` — patches the RPC so:
- `data_completeness.has_X` now means **present** (existence) → consistent with `athlete_state_snapshot.has_X` (overload removed).
- adds `has_X_fresh`, `<metric>_age_hours`, `freshness_thresholds_h`, and a `stale_metrics[]` list.
- `missing_metrics` = **absent-only** (present-but-stale is no longer suppressed → the NEVER-FABRICATE guardrail stops gagging real data).
- `morning_metrics` surfaces **present** values (not nulled when stale) + `*_stale` flags + per-metric dates.
- Three states now distinct: **absent** / **stale** (value still surfaced) / **fresh**.

**Delivery mechanism:** the migration patches the LIVE `pg_get_functiondef` with 5 asserted `replace()`s and `EXECUTE`s the result (the other ~250 lines reproduced byte-for-byte; aborts with no partial patch if the body has drifted). **I validated read-only against prod that all 5 snippets match the live body and the old overloaded form is removed — no `EXECUTE` was run, nothing was written.**

## STEP 3 — gate

`supabase/migrations/20260623_coaching_context_recovery_divergence_gate.sql` — transactional (ROLLBACK), real athlete UID for full context: deletes-then-restores recovery rows to build a fixture, asserts (a) **absent** → `missing_metrics` has sleep, `has_sleep=false`; (b) **present-but-stale** → sleep NOT in `missing_metrics`, IS in `stale_metrics`, `has_sleep=true`, `has_sleep_fresh=false`, `morning_metrics.sleep_hours` non-null, `sleep_stale=true`. Architect runs it after applying the migration, plus a fresh real coaching output.

**RISK:** coaching-correctness — mitigated: absent-only suppression is provable (gate), and the live-def patch can't silently half-apply (assertions). **No native change.**

**Follow-up flagged (Vercel, optional):** `api/claude-proxy.js` could read `stale_metrics`/`*_age_hours` to instruct the coach to cite stale recovery WITH a "from N hours ago" caveat. The RPC now exposes everything needed; the prompt tweak is a separate Vercel change (could ride #4). Not required to fix the suppression bug.

---

# HANDOVER — AC-157: MCP server Phase 3 (power / high blast radius)

- **Repo:** `richardstow-code/athlete-coach` (web). **Branch:** `feat/ac-157-mcp-phase3` (worktree off `origin/main` @ `fe09163`, PR #8 merge). **Type:** server-side (`api/_mcpTools.js`, `api/mcp.js`, `api/_supabaseRest.js`, `api/oauth/authorize.js`) — **no EAS, no native**. CC does **not** self-merge. STOP at GATE 3.
- **Result:** 6 tools added → **20 total** (11 read, 9 write). Full API suite **126 / 123 pass / 0 fail / 3 unrelated skips**; Phase-3 suite 18/18.

## STEP 0 — verify-first enumeration (live, this session)

- **0a `athlete_state_snapshot`** — IS a view. Cols (all nullable): user_id, snapshot_date, resting_hr(+_date), hrv_ms(+_date), sleep_hours(+_date), sleep_quality, steps, active_calories, has_resting_hr/has_hrv/has_sleep/has_steps, snapshot_sources(jsonb), injury_id/_body_location/_severity/_follow_up_due_date/_follow_up_overdue/_days_since_reported/_follow_up_count.
- **0b `scheduled_sessions` + apply semantics** — `id` is **bigint**; status adds `cancelled`. Native `app/(tabs)/plan.tsx` applyProposal is the canonical mapping: `reschedule`→UPDATE planned_date; `add`→INSERT status='planned'; `remove`→UPDATE status='cancelled' (**not delete**); `modify`→UPDATE new_* fields; then `schedule_changes.status='applied', resolved_at`. (`plan.tsx` references a `proposal.original_date` that is **not** a real `schedule_changes` column — so the MCP keys off `original_session_id` and refuses if absent, rather than guessing by a phantom column.)
- **0b `schedule_changes`** — `id` bigint; live status `pending`→`approved`/`accepted`→`applied`/`dismissed`; change_type reschedule|add|remove|modify (+ skip/add_session/review from other paths, not applied). `docs/database.md` was stale and is now corrected.
- **0c `activities` manual insert** (`app/log.tsx`) — `{ user_id, name, type(lowercase), date(`${d}T12:00:00Z`), distance_km, duration_min, …, source:'manual', enrichment_status:'done' }`. Dedup fields: type (Strava stores `'Run'`, manual `'run'` → compare case-insensitively), date, distance_km, duration_min, source, strava_id, is_deleted.
- **0d `nutrition_logs` raw insert** (`app/(tabs)/fuel.tsx`) — `{ date, raw_text, meal_timing, logged_at, meal_type:'food', user_id, parsed:false }`; pipeline parses macros. Matches D1 exactly.
- **0e `generate-periodised-plan`** — deployed, ACTIVE, verify_jwt:true, BUT a **SKELETON**: `POST {target_date,regenerate?}` → **501 `{status:'design_pending', design_ticket_id:'8933a7c4', blockers[]}`**, writes nothing. **No version/row canary exists.** ⇒ `request_plan_regeneration` invokes it and returns the real status verbatim; never fabricates a completion.
- **0f `regenerate-coaching-artifact.js`** (Vercel route) — `POST` w/ `x-analyze-secret`=`ANALYZE_ACTIVITY_SECRET`, body `{artifact='coach_take', activity_id, user_id?, fingerprint?, reason?}`; **rejects `morning_briefing`** (400); returns `{ok, regen_status:'fresh'|'error', regenerated_at}`.
- **calibrate-zones discrepancy resolved** — source exists in `supabase/functions/calibrate-zones/` but is **NOT** in the deployed `list_edge_functions` output → not active. Brief's "no calibrate-zones exists" is correct about *deployed* state. `recalibrate_zones` stays DEFERRED (no stub).

## Per-tool RISK notes

- `get_athlete_state` — R, none (read-only view wrap).
- `log_nutrition` — **low**: additive insert; no plan/activity impact; never computes macros.
- `regenerate_coaching_take` — **med**: rewrites a stored coaching artifact (Coach's Take); prior content kept on error; rate-limited; briefing out of scope.
- `apply_schedule_change` — **HIGH / irreversible plan mutation**: a wrong/duplicate session can enter the plan; mitigated by approved/accepted precondition, idempotency, original_session_id requirement, `commit`+`confirm`.
- `request_plan_regeneration` — **HIGH / would replace the whole plan** once generation ships; today a no-op against the 501 skeleton; rate-limited; `commit`+`confirm`.
- `log_activity` — **HIGH / pollutes history + feeds coaching**: cross-row dedup REFUSES suspected duplicates (D3); `commit`+`confirm`.

## STEP 3 — tests + lint

- `tests/api/mcp-phase3.test.js` (18 LAYER-1, no network): dedup refusal (D3), apply gating (refuse pending/dismissed) + idempotency (no-op on applied) + **real `scheduled_sessions` mutation asserted** (payload, not a 200) + `remove`→cancelled + `add`→insert, plan-regen **real `design_pending`** (not "done") + rate-limit (no 2nd invoke), nutrition `parsed=false`/no macros, `get_athlete_state` detector + NOT AVAILABLE, regen targets the Vercel route + rejects morning_briefing, confirm-required on all three HIGH tools, 20-tool wiring.
- Full `node --test tests/api/*.test.js`: 126 / 123 pass / 0 fail / 3 unrelated skips.
- eslint: no new rule categories vs main (more instances of the pre-existing `process` no-undef config gap + the `_args` convention; the scope-split fix **removed** a `no-useless-escape`).
- **MANUAL GATE (pending, Architect/Richard on prod):** one real end-to-end flow per HIGH-BLAST tool (apply_schedule_change, request_plan_regeneration, log_activity) — not run from CC; record results here.

## Bundled fix

`api/oauth/authorize.js`: `String(data.scope).split(/\s+/)` → `split(' ')` (the `\s` collapsed in the template literal and split on the letter "s"). Display-only; consent page only.

## Handback

Branch / SHA / PR# in the chat note. Architect bypass-merges to main (only red expected = chronic `loginAs` e2e flake), confirms the Vercel production deployment-ID flips, runs the behavioural checks + the MANUAL high-blast flows. **GATE 3 — stop for Architect sign-off.**

---

# HANDOVER — AC-156: harden the OAuth consent page (approving account + switch)

- **Repo:** `richardstow-code/athlete-coach` (web). **Branch:** `fix/ac-156-oauth-consent-account` (off `origin/main` @ `4032e71`). **File:** `api/oauth/authorize.js` (consent page only). **Type:** UI/auth-flow hardening — no tool/schema/discovery/`vercel.json` changes, no native. CC does **not** self-merge.

## STEP 1 — verify-first findings (actual code on origin/main)

`api/oauth/authorize.js` is a Vercel GET handler returning one HTML page; all auth runs client-side via `@supabase/supabase-js` (esm.sh). Real names confirmed:
- Supabase client: `const sb = createClient(CFG.url, CFG.anon)` (anon key from `SUPABASE_ANON_KEY` || `VITE_SUPABASE_KEY`).
- **Session-check line (the bug):** `const { data:{ session } } = await sb.auth.getSession();` in `main()` → `if(!session){ renderLogin(); return; } await renderConsent();`. `getSession()` reads only the **local cache** and the email was never shown ⇒ silent wrong-account approval.
- `renderLogin()`: `#email`/`#password` → `sb.auth.signInWithPassword(...)` → on success `renderConsent()`; errors into `#err`.
- `renderConsent()`: `sb.auth.oauth.getAuthorizationDetails(authorizationId)` → "Authorize `<client>`?" + scopes + Approve/Deny; `decide()` calls `approve/denyAuthorization` then redirects to `data.redirect_url`.
- `authorizationId` is a module-level const read once from the URL — so it survives login↔consent re-renders without being dropped.

## STEP 2 — what changed (consent page only)

- **`currentUser()`** (new): `getSession()` then re-validates with `getUser()`; returns null on stale/missing session ⇒ `main()` falls through to `renderLogin()` instead of a doomed consent screen.
- **`renderConsent(user)`** now shows **"Signed in as `<email>`"** (in an `.acct` box) above Approve/Deny, plus **"Not you? Use a different account"** (`#switch`) → `sb.auth.signOut()` then `renderLogin()`. Because `authorizationId` is the module const, re-login returns to consent for the **same** authorization request (continuity verified by construction — the query param is never re-read or dropped).
- **`renderLogin()`** re-validates via `currentUser()` after sign-in before consent.
- **Styling:** white `#ffffff` / text `#0a0a0a` / teal `#14b8a6` Approve / grey `#f1f1f1` secondary; **no `#e8ff47`** (grep = 0).
- Scope-split regex preserved exactly as-is (out of scope; its pre-existing `\s`-in-template quirk left untouched).

## STEP 3 — tests

- `tests/e2e/oauth-consent.spec.js`: one `@smoke` — `GET /oauth/authorize?authorization_id=test` with no session renders the **login form** (`#email`/`#password`/`#login`, heading "Sign in to authorize") and **no** `#approve`. Runs against `PREVIEW_URL` (the page is a Vercel function; local Vite `:5173` would 404 — same as `strava-webhook.spec.js`). Session-present path left to Richard's manual connect test (server-validated session mock is disproportionate).
- `node --check` passes; eslint at **baseline parity** (the 2 pre-existing findings — `process` no-undef + `\s` no-useless-escape — unchanged; no new errors).

## Handback

Branch / SHA / PR# in the chat note. Architect bypass-merges to main (only red expected = chronic `loginAs` e2e flake), confirms the Vercel production deployment-ID flips, and verifies the **live** consent page shows "Signed in as `<email>`" + the account-switch control. Then Richard re-runs the connector connect test — authorizing as the **hotmail athlete** account, not the IBM work account.

---

# HANDOVER — AC-154: reconcile `mcp-oauth` (PR #5) with main (fold in the AC-153 guardrail)

- **Repo:** `richardstow-code/athlete-coach` (web). **Branch:** `mcp-oauth` (PR #5). **Type:** server-side history reconciliation — **NOT** EAS/native. CC does **not** self-merge.
- **Goal:** PR #5 was cut **before** AC-153, so merging it as-is would overwrite main's hardened tool and silently reintroduce the fabrication bug. This merge brings the branch current so the connector (OAuth) path is held to the same verbatim-only standard as the Bearer path.

## STEP 1 — verify-first findings (recorded before resolving)

- **1.1 merge-base** `git merge-base origin/main mcp-oauth` = `8e55265` (the Phase-2 tip, PR #4 merge) — as expected.
- **1.2 did OAuth touch tool logic?** **No.** `git diff 8e55265 origin/mcp-oauth -- api/_mcpTools.js` = **0 lines** (byte-identical), and mcp-oauth's `_mcpTools.js` had **0** guardrail markers. OAuth made no tool-logic change ⇒ taking main's `_mcpTools.js` resolves clean.
- **1.3 PR #5 file surface** (`8e55265..mcp-oauth`): `api/_oauth.js`, `api/mcp.js`, `api/oauth/authorize.js`, `api/well-known-protected-resource.js`, `docs/changelog.md`, `docs/mcp.md`, `package.json`, `package-lock.json`, `tests/api/mcp-oauth.test.js`, `vercel.json`. Overlap with the AC-153 surface (the real conflict set) = **`api/mcp.js`, `docs/changelog.md`, `docs/mcp.md`**.

## STEP 2 — merge resolution (`git merge origin/main`, no rebase/force-push)

Of the predicted conflicts, git **auto-merged** `api/mcp.js` and `docs/mcp.md` (the two sides touched different regions); only `docs/changelog.md` conflicted.

- **`api/_mcpTools.js`** → main's version, verbatim. Working tree is **byte-identical to `origin/main`** (`git diff origin/main -- api/_mcpTools.js` = 0). Guardrail markers present: `refused`, `No athlete-provided`, `changed_columns`, `Never infer`, `verbatim`.
- **`api/mcp.js`** → **kept BOTH** (verified by grep): OAuth layer (`validateOAuthToken`×2, `RESOURCE_METADATA_URL`×2, `authorizeRequest`×2, `WWW-Authenticate`, `shared_secret`×2) **and** main's AC-153 verbatim-only inputSchema descriptions (`VERBATIM-ONLY`×4, `NEVER summarise the activity`, `never infer`×2, `refuses and writes nothing`). The auto-merge was confirmed semantically correct — OAuth changes live in the imports/`authorizeRequest`/handler region, AC-153 changes in the `SHAPES.log_session_feedback` descriptions.
- **`docs/changelog.md`** → conflict resolved deterministically (split on markers, no eyeball-blend): newest-first **AC-154 → AC-153 → Path B OAuth**, both prior entries preserved intact.
- **`docs/mcp.md`** → auto-merged; retained both the OAuth Path-B section and the AC-153 verbatim-only contract; added an AC-154 note that both auth paths share the guardrail.
- **`vercel.json`**, `api/_oauth.js`, `api/oauth/authorize.js`, `api/well-known-protected-resource.js` → mcp-oauth-only, unchanged.

## STEP 3 — tests (both capabilities intact)

- **AC-153 guardrail** (`tests/api/mcp-phase2.test.js`): **23/23 pass, 0 skipped** — incl. the live readback layer (rpe-only preserves an existing note byte-for-byte; empty call mutates nothing; happy-path `created_at` unchanged).
- **OAuth** (`tests/api/mcp-oauth.test.js`): **13/13 pass, 0 skipped** (token aud/sub/expiry, three authorize paths incl. bearer regression + cross-user rejection, PRM JSON, 401-with-header, OPTIONS).
- **Overall** `node --test tests/api/*.test.js`: **105 pass / 0 fail / 3 skipped** (the 3 skips are an unrelated `decideSkip` suite).
- **Static guards:** `_mcpTools.js` has the guardrail markers; `api/mcp.js` has BOTH `authorizeRequest` and the `NEVER summarise the activity` description.
- **eslint:** working-tree `api/mcp.js` = 2 problems (pre-existing `process` no-undef node-globals gap), `api/_mcpTools.js` = 4 problems (== origin/main; pre-existing `_args` convention). **No new errors.**

## STEP 5 — handback

- Merge commit pushed to `mcp-oauth` (updates PR #5). No rebase, no force-push, no branch delete. **Committed-but-NOT-deployed** until the Architect merges to main.
- Architect merges to main (after Richard's four Supabase/Vercel dashboard config actions), then verifies the Vercel deployment-ID flip and that `/api/mcp` (Bearer) **and** the main app still resolve. Branch / SHA / PR# in the chat handback.

---

# HANDOVER — AC-153: `log_session_feedback` fabrication guardrail (GATE 2 blocker)

- **Repo:** `richardstow-code/athlete-coach` (web). **Branch:** `fix/ac-153-log-session-feedback-guardrail` (off `origin/main` @ `5ab5df8`, the Phase-2 tip = current prod).
- **Files:** `api/_mcpTools.js`, `api/mcp.js`, `tests/api/mcp-phase2.test.js`, `docs/database.md`, `docs/mcp.md`, `docs/changelog.md`.
- **Type:** server-side MCP fix. **NOT** an EAS/native change. Ships via web `main` → Vercel auto-deploy.
- **Activity 362:** NOT touched (Architect restored it).

---

## STEP 1 — enumeration (verify-first, done BEFORE any code change)

### 1.1 — `log_session_feedback` tool definition as found on `main`

**Input JSON-schema (`api/mcp.js` `SHAPES.log_session_feedback`, before fix):**
```js
log_session_feedback: {
  activity_id: z.number().int().describe('activities.id'),
  rpe: z.number().int().describe('RAW RPE 1-10 (never a computed feel_score)').optional(),
  feel_legs: z.string().optional(),            // no description
  injury_flag: z.string().optional(),          // no description
  notes: z.string().optional(),                // no description
  commit: z.boolean().describe('must be true to write; otherwise returns the proposed diff').optional(),
}
```
**Top-level tool description (`api/_mcpTools.js` TOOLS[], before fix):**
> "Log subjective feedback on an activity (raw RPE 1-10, leg feel, injury flag, notes). Propose-by-default: requires commit:true to write; returns the mutated row."

→ No never-fabricate / verbatim-only language anywhere; three of four subjective params had **no** description at all. This is the steering gap.

### 1.2 — Handler code path (does the SERVER synthesise?)

**No.** `logSessionFeedback()` only persists what the caller passed. It does **not** template, summarise, or derive any subjective field from metrics. The UPDATE payload was built verbatim as:
```js
const payload = {};
if (args.rpe !== undefined) payload.rpe = args.rpe;            // RAW passthrough
if (args.feel_legs !== undefined) payload.feel_legs = args.feel_legs;
if (args.injury_flag !== undefined) payload.injury_flag = args.injury_flag;
if (args.notes !== undefined) payload.subjective_notes = args.notes;   // notes -> subjective_notes
// (empty -> err; else) payload.subjective_captured_at = new Date().toISOString();
```
**Conclusion:** the AC-153 fabrication came entirely from the **calling model** passing invented `rpe=3` + a third-person summary as `notes`. There was **no server-side synthesis to remove** (STEP 2 condition not triggered). The real fix is schema/description steering (C) plus making the existing protections explicit + tested.

### 1.3 — propose (`commit:false`) vs commit (`commit:true`)

- `commit !== true` → returns `{ committed:false, commit_required:true, proposed:{ table, op, payload }, … }` and **mutates nothing** (no `restPatch` call).
- `commit === true` → `client.restPatch('activities', 'id=eq.<id>&user_id=eq.<uid>', payload)` then returns `{ committed:true, row: rows[0] }` (the actual mutated row). Not-found → `err`.

### 1.4 — mapping correctness

- Writes **`subjective_notes`** (via `notes` → `subjective_notes`), never a `notes` column. ✔
- Does **not** reference `updated_at` anywhere (no such column on `activities`). ✔
- Sets `subjective_captured_at` on a write. ✔  RAW `rpe` passthrough, no `feel_score`. ✔

---

## STEP 2 — what changed (all three required properties)

**(A) Partial update** — already correct; reinforced with a comment and now covered by tests. Only caller-supplied subjective fields enter the payload; an omitted field is never sent, so PostgREST PATCH leaves the existing DB value untouched.

**(B) Refuse-when-empty** — the prior empty-case returned a terse `err(...)`. Replaced with an explicit refusal for **both** propose and commit:
`{ committed:false, refused:true, error:"No athlete-provided subjective values supplied — … Never infer/estimate/summarise these from the activity metrics." }` — a no-op write.

**(C) Schema/description hardening (the real gap)** — added a verbatim-only / never-infer-from-metrics clause to the tool description and to **every** subjective param description (`rpe`, `feel_legs`, `injury_flag`, `notes`), explicitly forbidding third-person metric summaries in the note, for any sport.

**Return contract** — `commit:true` now also returns `changed_columns` (the real DB column names changed). Mutated row still returned verbatim. `rpe` raw passthrough unchanged.

---

## STEP 3 — test coverage added (`tests/api/mcp-phase2.test.js`)

LAYER 1 (always, mock client — asserts the PATCH payload):
- **AC-153 TEST 1** (regression-catcher): empty call → no `restPatch`, `refused:true`, for propose **and** commit.
- **AC-153 TEST 2**: `rpe`-only commit → body has `rpe`, **no** `subjective_notes`/`feel_legs`/`injury_flag`; `changed_columns === ['rpe']`.
- **AC-153 TEST 4**: propose with values → zero writes; `notes`→`subjective_notes`; no `notes`/`updated_at` keys.

LAYER 2 (gated on `TEST_SUPABASE_*`; **ran green** here against the test project, never prod — hard prod-guard respected):
- **AC-153 TEST 3 (live)**: full verbatim values → DB matches input byte-for-byte; `created_at` unchanged (UPDATE not INSERT); `subjective_captured_at` set.
- **AC-153 TEST 2 (live)**: seed a real note, send `rpe` only → note/feel/injury preserved byte-for-byte.
- **AC-153 TEST 1 (live)**: empty commit → no column mutated.

**Result:** `node --test tests/api/mcp-phase2.test.js tests/api/mcp.test.js` → 39 pass / 0 fail (incl. live layer). `eslint` on changed files = 8 problems, **identical to the `origin/main` baseline** (pre-existing node-globals config gap + `_args` convention) → **no new lint errors introduced**.

---

## STEP 5 — deploy & handback

- Committed to `fix/ac-153-log-session-feedback-guardrail`, pushed, PR opened against `main`. **Committed-but-NOT-deployed** until the `main` merge.
- CC did **not** self-merge. Architect/Richard merge to `main` (bypass only if the sole red check is the chronic `loginAs` e2e flake), then Architect verifies the Vercel deployment ID flips away from `dpl_BbjdVeNdGDbFWm36tjF2JdKdJeZv` before Gate-2.5 re-run / GATE 2 sign-off.
- Branch / SHA / PR# recorded in the chat handback note.

## Flags for the Architect

1. **`mcp-oauth` branch** (unmerged, 210-line `api/mcp.js`) carries its own copy of `log_session_feedback` — it needs the same guardrail before/at its merge, or the fix regresses.
2. **`feel` column** is not currently writable by the tool. Left as-is (expanding write surface is a separate decision); flagged because the protected-set in the brief lists `feel`.
3. **Do NOT** regenerate any coach analysis off the fabricated `rpe=3` (gone). Any regen must use Richard's real `rpe=2` — a separate decision.
