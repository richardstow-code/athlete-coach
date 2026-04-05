# Testing

## Philosophy

Tests run against a dedicated Supabase test project using a Vercel preview deployment — completely isolated from production. Richard's real data is never touched.

Test depth scales with risk:

| Tier | When | Tests | Expected duration |
|------|------|-------|-------------------|
| **PATCH** | 1-2 file changes, CSS/styles | Smoke tests only (`@smoke`) | ~3 min |
| **MINOR** | 2+ components, API changes | Smoke + minor tests + API tests | ~10 min |
| **MAJOR** | Schema migrations, buildContext.js, claudeProxy.js, 3+ src directories | All tests + AI eval | ~25-35 min |

Docs-only changes skip all tests.

---

## Test Infrastructure

| Component | Location | Purpose |
|-----------|----------|---------|
| Test Supabase project | `nvoqqhaybhswdqcjyaws` (Frankfurt) | Isolated DB for all test runs |
| Seed script | `tests/seed/seed.js` | Resets DB to known state before each run |
| Fixture files | `tests/fixtures/` | Static data for UI and API tests |
| GitHub Actions workflow | `.github/workflows/test.yml` | Runs on push/PR to main |
| Test mode banner | `src/components/TestModeBanner.jsx` | Visible indicator when using test DB |

---

## AI Coaching Quality Evaluator

The evaluator catches regressions in coaching AI behaviour when changes are made to the system prompt, `buildContext.js`, `coachingPrompt.js`, or the Claude model.

### How it works

Two-Claude approach:
1. **Coaching AI (Haiku)** — receives the full coaching context for a test persona and a canonical test prompt, produces a response as it would in production
2. **Evaluator (Sonnet)** — receives the persona description, the prompt, and the coaching AI's response, then evaluates it against a per-persona rubric and returns structured JSON

Results are written to `tests/ai-eval/results/latest.json` and archived with a timestamp. The script exits with code 1 if any **critical** criterion fails.

### Running locally

```bash
# Requires test DB to be seeded first: npm run seed:test
ANTHROPIC_API_KEY=your_key node tests/ai-eval/run-eval.js

# Or using the npm script (picks up TEST_SUPABASE_* from tests/.env.test):
npm run test:ai-eval
```

### Rubrics

Rubrics are defined in `tests/ai-eval/rubrics.js`. Each persona has:
- `persona_description` — context given to the evaluator about this athlete
- `test_prompts` — 3 canonical questions fired at the coaching AI
- `criteria` — list of checks, each with `id`, `label`, and `critical` flag

**CRITICAL criteria** — failure causes `process.exit(1)`. These cover safety (no unsafe injury advice), sport-appropriateness (no running prescribed to bodybuilder), and role-appropriate coaching (no volume increase during taper).

**Non-critical criteria** — logged as warnings but do not block release. These cover tone quality, specificity, and nice-to-have behaviours.

### Adding a test prompt to an existing persona

Edit `tests/ai-eval/rubrics.js`, add to `test_prompts` array. Add matching criteria if needed.

### Adding a new persona rubric

Add a new key to `RUBRICS` in `rubrics.js` with `persona_description`, `test_prompts`, and `criteria`. Add the persona UUID to `PERSONA_IDS` in `run-eval.js`.

### Interpreting results

```json
{
  "overall_pass": false,
  "summary": "34/36 criteria passing across 6 personas.",
  "personas": [
    {
      "persona": "injured",
      "pass": false,
      "prompts": [
        {
          "prompt": "Can I do a long run this weekend?",
          "evaluation": {
            "overall_pass": false,
            "criteria": [
              {
                "id": "injury_acknowledged",
                "pass": false,
                "critical": true,
                "reason": "Response discussed training load but did not mention knee or ITB."
              }
            ]
          },
          "critical_failures": [...]
        }
      ]
    }
  ]
}
```

### Regression detection

After each run, the evaluator compares criterion pass rates against the previous archived run. Regressions (criteria that previously passed and now fail) are printed as warnings in console output. They do not cause a test failure but appear prominently.

### Archived results

Each run saves to `tests/ai-eval/results/[timestamp].json`. The last 20 runs are retained; older files are deleted automatically. Results are **not** committed to git — they are uploaded as GitHub Actions artifacts (90-day retention) on every major tier run.

---

## Manual HealthKit Sync Verification

After first launch of a build with `lib/healthKitSync.ts`, confirm in Supabase:

1. **`activities` table** — rows exist with `source='healthkit'` for workouts not already covered by Strava. No duplicate rows for dates that had Strava activities (check `date` + `type` combination).
2. **`health_metrics` table** — rows exist for `metric_type` values: `resting_hr`, `hrv`, `sleep`, `steps`. One row per type per day.
3. **`athlete_settings`** — `healthkit_sync_enabled=true` and `healthkit_last_synced_at` is set.
4. **Idempotency** — run the app a second time, confirm no duplicate rows are created.

**When to run:** After any change to `lib/healthKitSync.ts` or the `health_metrics` schema.

---

## Manual Multi-User Isolation Test

Run this before onboarding any new real user onto the app.

**What to check:**
1. Open https://athlete-coach-alpha.vercel.app in an incognito window
2. Sign up with a fresh email address (not Richard's)
3. Complete onboarding — connect Strava if available, or skip
4. Confirm the home screen loads with no errors and none of Richard's data visible (activities, briefings, plan sessions)
5. Log into Richard's account in a separate browser — confirm his data is intact and unchanged

**Why:** RLS scopes all Supabase queries to `auth.uid()`, and the Strava webhook routes by `owner_id` → `strava_tokens.athlete_id`. This test confirms both layers are working end-to-end for a real new account.

**When to run:** Before each new real (non-test) user is onboarded.

---

## Pipeline Tests

API-level tests for the enrichment pipeline live in `tests/api/` and run via `npm run test:api`. They use Node's built-in `node:test` runner (no additional framework required). They run at **MINOR tier and above** in CI.

### enrich-activity.test.js

| Test | Tag | Requires | What it checks |
|------|-----|----------|----------------|
| Enrichment integrity | `@minor` | Seeded test DB | Every `enrichment_status='complete'` run/ride activity has a corresponding `activity_streams` row |
| Direct invocation | `@minor` | `TEST_SUPABASE_FUNCTIONS_URL` | Calling the edge function with a correct INSERT envelope changes status away from `'pending'` |
| Graceful failure | `@minor` | `TEST_SUPABASE_FUNCTIONS_URL` | Bad Strava token → `enrichment_status='failed'`, no stream row written |
| UPDATE does not re-enrich | `@minor` | Seeded test DB | Plain UPDATE to an activity name does not reset `enrichment_status` to `'pending'` |

Tests 2 and 3 are skipped automatically when `TEST_SUPABASE_FUNCTIONS_URL` is not set. To enable them, deploy the edge functions to the test project and add the secret:

```
TEST_SUPABASE_FUNCTIONS_URL=https://nvoqqhaybhswdqcjyaws.supabase.co/functions/v1
```

### Key failure patterns

**Test 1 fails**: seed hasn't been run, or `activity_streams` rows are missing. Re-run `npm run seed:test`.

**Test 2 fails (status still 'pending')**: the edge function exited early — almost certainly a wrong payload envelope. The trigger body must send `{type:'INSERT', table:'activities', record:{...row}}` not the raw row.

**Test 3 fails (status not 'failed')**: the function is not setting `enrichment_status='failed'` when Strava returns 401. Check the edge function error handling path.

**Test 4 fails (status changed to 'pending')**: the DB trigger fires on `UPDATE` as well as `INSERT`. Fix: `CREATE TRIGGER ... AFTER INSERT ON activities` (not `INSERT OR UPDATE`).

### Running locally

```bash
# Requires tests/.env.test to be set up
npm run test:api

# To enable tests 2 & 3, add to tests/.env.test:
# TEST_SUPABASE_FUNCTIONS_URL=https://nvoqqhaybhswdqcjyaws.supabase.co/functions/v1
```

---

## Running Playwright Tests Locally

```bash
# Install browsers (one-time)
npx playwright install chromium

# Run against local dev server (start it first: npm run dev)
npm run test:e2e:smoke   # @smoke only — ~3 min
npm run test:e2e:minor   # @smoke + @minor — ~10 min
npm run test:e2e:major   # all tests — ~35 min

# Run against a Vercel preview URL
PREVIEW_URL=https://your-branch.vercel.app npm run test:e2e:smoke

# View HTML report after a run
npx playwright show-report
```

Spec files live in `tests/e2e/`. Each spec imports `loginAs()` from `tests/e2e/helpers/auth.js` which logs in as a test persona using fixed credentials (`TestPass123!`).

Tests require `VITE_TEST_MODE=true` to be set on the deployment — without it `[data-testid="test-mode-banner"]` won't appear and smoke tests will fail immediately.

---

## Running the Seed Script Manually

```bash
# 1. Create tests/.env.test with real credentials (never commit this file)
cp tests/.env.test tests/.env.test
# Edit the file and fill in the values

# 2. Run the seed script
npm run seed:test
# or directly:
node tests/seed/seed.js
```

Expected output:
```
Starting seed...
  Clearing existing test data...
  Seeding athlete_settings...
  Seeding athlete_sports...
  Seeding activities...
  Seeding activity_streams...
  Seeding scheduled_sessions...
  Seeding coaching_memory...
  Seeding nutrition_logs...
  Seeding cycle_logs...
Seeding complete. 6 personas created.
  bodybuilder:  Marcus Weber   (strength, no races)
  female_cycle: Sofia Müller   (marathon, cycle tracking, luteal phase)
  injured:      Tom Brennan    (marathon, active ITB injury)
  elite_taper:  Anna Kowalski  (elite, 5 weeks to London Marathon)
  struggling:   Dave Thornton  (marathon, low adherence, nutrition issues)
  multisport:   Lena Fischer   (Ironman 70.3, run/ride/swim)
  activity_streams: N rows (run/ride activities)
```

---

## Test Personas

All persona UUIDs are fixed and referenced throughout tests. The seed script will always reset them to a known state.

### 1. Bodybuilder — Marcus Weber
- **UUID**: `00000000-0000-0001-0000-000000000001`
- **Profile**: 32yo male, 92kg, strength-only, no races
- **Data**: 18 strength activities (Mon/Wed/Fri pattern, 6 weeks), 4 upcoming sessions
- **Tests**: Strength sport routing, no-race state, non-running coaching prompts

### 2. Female Athlete with Cycle Tracking — Sofia Müller
- **UUID**: `00000000-0000-0001-0000-000000000002`
- **Profile**: 29yo female, marathon runner, cycle tracking enabled, 18 days into 28-day cycle (luteal phase)
- **Data**: 14 running activities (6:30–5:00/km), 18 cycle log entries, Vienna Marathon in 5 weeks
- **Tests**: Cycle phase injection in coaching context, luteal phase HR elevation detection, marathon phase

### 3. Injured Athlete — Tom Brennan
- **UUID**: `00000000-0000-0001-0000-000000000003`
- **Profile**: 41yo male, marathon runner, active ITB injury (left knee, 10 days ago)
- **Data**: 8 activities (reduced volume), active injury in coaching_memory, 3 rehab sessions scheduled
- **Tests**: Injury report injection in context, rehab session type rendering, SessionDetail rehab view

### 4. Elite Athlete Nearing Race — Anna Kowalski
- **UUID**: `00000000-0000-0001-0000-000000000004`
- **Profile**: 27yo female, elite marathon runner, 5 weeks to London Marathon, in taper
- **Data**: 24 activities (3:50–4:30/km easy, 85km peak week, now 55km taper), taper week sessions
- **Tests**: Taper lifecycle state, elite pacing context, sub-2:45 goal handling

### 5. Struggling to Hit Plan — Dave Thornton
- **UUID**: `00000000-0000-0001-0000-000000000005`
- **Profile**: 45yo male, marathon runner, 35% plan adherence, 6+ missed sessions, poor nutrition
- **Data**: 8 activities in 6 weeks (plan called for 20+), 10 nutrition entries (high UPF, alcohol, low protein), many missed scheduled_sessions
- **Tests**: Mismatch detection, plan vs actual divergence display, nutrition flagging, alcohol tracking

### 6. Multi-sport Athlete — Lena Fischer
- **UUID**: `00000000-0000-0001-0000-000000000006`
- **Profile**: 35yo female, Ironman 70.3 Salzburg (June 14), three sports: Run (priority 1), Ride (2), Swim (3, limiter)
- **Data**: 18 activities across run/ride/swim, brick session included, triathlon training week scheduled
- **Tests**: Multi-sport week view, sport-aware metrics, brick session display, three-sport coaching context

---

## Fixture Files

| File | Purpose |
|------|---------|
| `tests/fixtures/strava-webhook-run.json` | Strava webhook POST payload (activity create) |
| `tests/fixtures/strava-activity-run.json` | Full Strava activity response for a 10km run |
| `tests/fixtures/strava-activity-weighttraining.json` | Full Strava activity response for a strength session |
| `tests/fixtures/crossfit-workout.txt` | CrossFit WOD in plain text for workout ingest tests |
| `tests/fixtures/food-images/*.jpg` | Placeholder images for nutrition photo logging tests |

---

## GitHub Secrets Required

| Secret | How to get it |
|--------|--------------|
| `TEST_SUPABASE_URL` | Test project URL: `https://nvoqqhaybhswdqcjyaws.supabase.co` |
| `TEST_SUPABASE_ANON_KEY` | Test project → Settings → API → anon/public key |
| `TEST_SUPABASE_SERVICE_KEY` | Test project → Settings → API → service_role key |
| `TEST_SUPABASE_FUNCTIONS_URL` | `https://nvoqqhaybhswdqcjyaws.supabase.co/functions/v1` — optional; enables pipeline tests 2 & 3 |
| `ANTHROPIC_API_KEY` | Same key used in production Supabase secrets |
| `VERCEL_TOKEN` | Vercel account → Settings → Tokens → Create |

Add at: GitHub repo → Settings → Secrets and variables → Actions

---

## Branch Protection

For tests to gate production merges, enable branch protection:

1. GitHub repo → Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable: "Require status checks to pass before merging"
4. Add status check: `Run Tests`
5. Enable: "Require branches to be up to date before merging"

---

## Adding a New Test Persona

1. Add a new UUID to `PERSONA_IDS` in `tests/seed/seed.js`
2. Add `athlete_settings`, `athlete_sports`, `activities`, and `scheduled_sessions` inserts
3. Add `coaching_memory` entries covering baseline + at least 1 feedback entry
4. Update the deletion block at the top of `seedAll()` (already covers `ALL_IDS` automatically)
5. Document the persona in this file

---

## Adding New Fixture Files

Drop files into `tests/fixtures/` and reference them in test files via relative path from the test file location. For JSON fixtures, import directly. For binary files (images), read with `fs.readFileSync` and convert to base64 for API calls.

---

## Tier Classification Logic

The GitHub Actions workflow classifies each push/PR into a tier:

**MAJOR** (all tests + AI eval) triggers when:
- `supabase/migrations/**` — schema change
- `src/lib/buildContext.js` — coaching context layer
- `src/lib/claudeProxy.js` — AI proxy
- `Agent_System_Prompt.txt` — system prompt
- 3 or more top-level `src/` subdirectories changed

**MINOR** (smoke + UI + API) triggers when:
- 2+ files in `src/components/` or `src/pages/`
- Any file in `api/`

**PATCH** (smoke only) — everything else

**Skip** — docs-only changes (`docs/**` only)
