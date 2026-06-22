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
