# Screens

## Navigation Structure

5 tabs managed by `App.jsx`: Home, Plan, Chat, Fuel (Nutrition), Progress (Stats).

Overlays rendered from App.jsx: Settings, Onboarding, WorkoutIngest, PostWorkoutPopup, PostEventModal, Roadmap.

Root-level components (mounted once in App.jsx, visible on every screen): HelpBot, ReleaseNotes.

Per-screen components (mounted inside each screen): OnboardingHints — one instance per screen with a unique `hintId`.

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

**Purpose**: Training plan view with week navigation, mismatch detection, coach proposal queue, and manual activity logging.

**Data sources (reads)**:
- `scheduled_sessions` — week range (Mon–Sun)
- `activities` — matched against planned sessions; unmatched shown inline at correct day slot
- `schedule_changes` — pending queue shown below calendar
- `athlete_settings` — via useSettings()
- `athlete_sports` — race card and lifecycle context
- `plan_drafts` — fetched when plan review panel is opened

**Data sources (writes)**:
- `scheduled_sessions` — status updates (planned → completed/missed), session edits; bulk insert when plan draft committed
- `schedule_changes` — inserts when athlete submits proactive change request or mismatch proposals
- `activities` — insert when athlete manually logs an activity (`source: 'manual'`); delete when athlete deletes an activity
- `coaching_memory` — writes one-sentence coaching note after each manual activity save (`memory_type: 'manual_activity'`)

**Claude calls**:
- Proactive change input: Haiku, interprets athlete's free-text change request → JSON proposals
- Mismatch detection: Haiku, 600 tokens, compares planned vs actual → JSON `{summary, what_changed, week_impact, proposals}`
- Manual activity feedback: Haiku, 150 tokens, single-sentence coaching note (plain text)
- Plan generation: Haiku, 4000 tokens, returns JSON sessions array (via `generatePlanDraft()`)
- Plan review conversation: Haiku, ongoing review dialogue in PlanReviewPanel

**Key UI elements**:
- Session + orphan activity list merged and sorted by date — unplanned activities rendered at their day slot with an "Unplanned" badge (no separate section)
- `getDisplayDate(dateStr)` helper normalises ISO timestamps and date strings before constructing `Date` objects (fixes INVALID DATE bug)
- `+ FAB` button (bottom-right, above tab bar) → bottom sheet → "Log manual activity"
- Manual activity form: type picker, date, duration (min), optional distance/notes; shows coach feedback after save
- Delete activity modal: shown when tapping a manual activity (source ≠ strava); Strava activities still navigate to detail

**Known issues / gaps**:
- Commit from plan_draft to scheduled_sessions may not be fully wired in all code paths
- Mismatch detection heuristics may produce false positives for non-run activities
- `duration_sec` field referenced in mismatch check but DB column is `duration_min` — mismatch duration check silently no-ops for now

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

**Purpose**: Athlete profile, coaching preferences, Strava connection, sport management. Structured as 7 expandable accordion sections (one open at a time).

| Section | Contents |
|---------|----------|
| Personal | Name, DOB, height, weight, email (read-only from auth) |
| Goals & Races | Link to SportsPriorities, goal type selector, race list, add race |
| Training Zones | Editable 5-zone HR inputs with contiguity validation, per-section save |
| Health & Injuries | Health flags (add/edit/resolve), cycle tracking toggle + settings |
| Coaching Preferences | Tone, stakes, detail, scope sliders with per-section save |
| Connected Services | Strava connect/disconnect with OAuth flow |
| Subscription | Tier badge, account email, sign out, delete account |

**Data sources (reads/writes)**:
- `athlete_settings` — all profile fields, slider values, races, training_zones, health_flags, subscription_tier
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

---

### HelpBot (`src/components/HelpBot.jsx`)

**Purpose**: Floating `?` button (fixed, bottom-right, 88px from bottom to clear tab bar) on every screen. Opens a 76dvh slide-up panel with an AI assistant that explains app features. NOT a coaching assistant — directs training questions to the Chat tab.

**AI call**: Claude Haiku, 400 tokens, ephemeral conversation (not saved to coaching_memory). Screen name passed as context so responses can be screen-specific.

**Entry points to Roadmap/Feature Requests**: "Request a feature →" and "See what's coming →" links at bottom of panel.

---

### ReleaseNotes (`src/components/ReleaseNotes.jsx`)

**Purpose**: On app load, checks if `app_releases.version` (latest) > `athlete_settings.last_seen_version`. If so, shows a slide-up modal listing new features with tab badges. Writes `last_seen_version` on dismiss.

**Data sources (reads)**:
- `app_releases` — latest row
- `athlete_settings` — `last_seen_version`

**Data sources (writes)**:
- `athlete_settings` — `last_seen_version`

---

### OnboardingHints (`src/components/OnboardingHints.jsx`)

**Purpose**: Per-screen hint card shown to new users. Fixed position (above tab bar). Checks `hints_dismissed` on mount and shows after 1s delay if the `hintId` has not been dismissed. 'Got it' dismisses one hint; 'Skip all' dismisses all known hint IDs.

Hint IDs: `home_briefing`, `plan_sessions`, `chat_context`, `fuel_logging`, `progress_views`, `settings_overview`

**Data sources (reads/writes)**: `athlete_settings.hints_dismissed`

Reset via Settings → Personal section → "Reset onboarding hints" link.

---

### Roadmap (`src/screens/Roadmap.jsx`)

**Purpose**: Public list of all feature requests, grouped by status. Includes inline FeatureRequestModal with Claude deduplication. Accessible from Settings → Subscription, Help Bot panel, or notification badge on settings icon.

**Status groups**: In Dev (highlighted) → Designing → In Review → Triage → Completed (collapsed) → Declined (collapsed). Sorted by vote_count within each group.

**Data sources (reads)**:
- `feature_requests` — all rows (public)
- `feature_votes` — current user's votes (to show "YOU REQUESTED" badge)

**Data sources (writes)** (via FeatureRequestModal):
- `feature_requests` — new row if no match found
- `feature_votes` — one vote per user per feature

**Claude call**: Haiku, 200 tokens, similarity check against existing open requests before creating a new row.
