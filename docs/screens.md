# Screens

## Navigation Structure

5 tabs managed by `App.jsx`: Home, Plan, Chat, Fuel (Nutrition), Progress (Stats).

Overlays rendered from App.jsx: Settings, Onboarding, WorkoutIngest, PostWorkoutPopup, PostEventModal.

---

## Tab Screens

### Home (`src/screens/Home.jsx`)

**Purpose**: Daily dashboard. Layout changes based on time of day (Vienna timezone).

| Time | Layout |
|------|--------|
| Morning (before 11:00) | Today's Briefing + Scheduled Sessions |
| Afternoon (11:00–19:59) | Today So Far + Briefing (secondary) + Live Feed |
| Evening (20:00+) | Day Summary + Live Feed + Briefing (de-emphasised) |

**Data sources (reads)**:
- `activities` — last 20, for recent list, today's feed, week stats
- `daily_briefings` — today's row only (`.eq('date', todayStr)`)
- `nutrition_logs` — today's entries
- `scheduled_sessions` — today and tomorrow
- `athlete_settings` — via `useSettings()` hook
- `athlete_sports` — via `usePrimarySport()` hook

**Data sources (writes)**:
- `daily_briefings` — upsert when briefing is refreshed
- `scheduled_sessions` — updates `planned_start_time` when athlete taps check-in
- `athlete_settings` — updates `last_goal_prompt_date` when goal prompt is dismissed
- `coaching_memory` — writes readiness note (if evening auto-generation)

**Claude calls**:
- Briefing refresh: Haiku, 400 tokens, bullet-point daily briefing
- Evening readiness note: Haiku, 150 tokens, JSON `{rating, note}`

**Known issues / gaps**:
- HR zones section shows hardcoded values (52%/31%/17%) — not computed from actual activity data
- `zone_data` column exists in activities but is not populated by the webhook
- Evening readiness note auto-triggers once after 8pm but doesn't persist to DB (only localStorage)

---

### Plan (`src/screens/Plan.jsx`)

**Purpose**: Training plan view with week navigation, mismatch detection, and coach proposal queue.

**Data sources (reads)**:
- `scheduled_sessions` — week range (Mon–Sun)
- `activities` — matched against planned sessions for mismatch detection
- `schedule_changes` — pending queue shown below calendar
- `athlete_settings` — via useSettings()
- `athlete_sports` — race card and lifecycle context
- `plan_drafts` — fetched when plan review panel is opened

**Data sources (writes)**:
- `scheduled_sessions` — status updates (planned → completed/missed), session edits
- `schedule_changes` — inserts when athlete submits proactive change request
- `scheduled_sessions` — bulk insert when plan draft is committed

**Claude calls**:
- Proactive change input: Haiku, interprets athlete's free-text change request
- Plan generation: Haiku, 4000 tokens, returns JSON sessions array (via `generatePlanDraft()`)
- Plan review conversation: Haiku, ongoing review dialogue in PlanReviewPanel

**Known issues / gaps**:
- Commit from plan_draft to scheduled_sessions may not be fully wired in all code paths
- Mismatch detection heuristics may produce false positives for non-run activities

---

### Chat (`src/screens/Chat.jsx`)

**Purpose**: Conversational coaching interface. Context-aware quick questions, plan change proposals.

**Data sources (reads)**:
- `daily_briefings` — snippet used as opening greeting
- `cycle_logs` — check if logged today (for CycleLogNudge)
- `athlete_settings` — via useSettings() for quick question context
- All context via `buildContext()` + `formatContext()` injected into system prompt

**Data sources (writes)**:
- `coaching_memory` — every exchange saved (source: app-chat, category: chat)
- `schedule_changes` — inserted when athlete accepts a plan change proposal
- `athlete_settings` — via nudge responses (through `processNudgeResponse`)

**Claude calls**:
- Every message: Haiku, 600 tokens, JSON response `{response, planChange}`
- Response parsed for planChange object; if present, shown as actionable card

**Known issues / gaps**:
- Claude sometimes returns text outside JSON despite instruction — handled with fallback raw text display
- Chat history is session-only (not persisted to DB beyond coaching_memory)

---

### Fuel (`src/screens/Nutrition.jsx`)

**Purpose**: Nutrition logging with AI analysis of food descriptions or photos.

**Data sources (reads)**:
- `nutrition_logs` — today's and historical entries
- `athlete_settings` — for context banner (training day awareness)
- `cycle_logs` / `athlete_settings` — for cycle phase nutrition tips
- `activities` — for pre/post-workout context banner

**Data sources (writes)**:
- `nutrition_logs` — new entries (food and alcohol)

**Claude calls**:
- Food analysis: Haiku, parses text description or image → macros
- Returns JSON: `{calories, protein_g, carbs_g, fat_g, meal_name, meal_type}`

**Known issues / gaps**:
- Image upload path relies on base64 encoding passed to Claude (may be slow on large images)
- Calorie/macro targets (2800kcal / 150g protein) are hardcoded; not derived from athlete profile

---

### Progress (`src/screens/Stats.jsx`)

**Purpose**: Training progress analytics. Branches by `goal_type`.

**Data sources (reads)**:
- `activities` — all activities for stats computation
- `scheduled_sessions` — compliance calculation
- `athlete_settings` — goal_type, races, health_notes
- `athlete_sports` — primary sport for micro/event view

**Claude calls**: None — purely data display.

**Known issues / gaps**:
- HR zone percentages and some chart data may be approximate/hardcoded placeholders
- Personal bests computed from local activity data — may not reflect full history if backfill incomplete

---

## Overlay Screens

### Settings (`src/screens/Settings.jsx` or overlay in `App.jsx`)

**Purpose**: Athlete profile, coaching preferences, Strava connection, sport management.

**Data sources (reads/writes)**:
- `athlete_settings` — all profile fields, slider values, races jsonb
- `athlete_sports` — via SportsPriorities component

**Claude calls**:
- `inferAthleteContext()` called after save to parse/infer structured fields from free-text inputs

---

### Onboarding (`src/screens/Onboarding.jsx`)

**Purpose**: 4-step first-run flow: Goal → Sports → Target → Level.

**Data sources (reads/writes)**:
- `athlete_settings` — upsert after completion
- `athlete_sports` — insert new sport rows

**Claude calls**:
- `inferAthleteContext()` called on completion (multi-sport path)
- `runBackfill()` triggered in background after onboarding

---

### WorkoutIngest (`src/screens/WorkoutIngest.jsx`)

**Purpose**: Parse workout boards from photos (CrossFit, Hyrox, etc.) and save as sessions.

**Data sources (writes)**:
- `workout_logs` — completed/planned workout entries

**Claude calls**:
- Image parsing: returns `{workout_type, movements, time_cap, rounds}`

---

### PostWorkoutPopup (`src/components/PostWorkoutPopup.jsx`)

**Purpose**: Bottom sheet shown after new activity detected (within last 4 hours).

**Data sources (reads)**:
- `activities` — checks for recent activity
- `coaching_memory` — fetches activity feedback snippet

**Trigger**: Checked in App.jsx on load; uses sessionStorage to avoid repeat display.

---

### PostEventModal (`src/components/PostEventModal.jsx`)

**Purpose**: Shown when `target_date` of primary sport has passed. Prompts lifecycle transition.

**Data sources (writes)**:
- `athlete_sports` — updates `lifecycle_state` to recovery/what_next/maintenance
