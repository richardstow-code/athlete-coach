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
