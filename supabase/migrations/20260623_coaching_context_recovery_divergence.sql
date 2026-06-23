-- 20260623_coaching_context_recovery_divergence.sql
-- Recovery-data divergence fix for get_athlete_coaching_context.
--
-- BUG: `core.data_completeness.has_sleep/has_hrv/has_resting_hr` were the
-- FRESHNESS flags (within 24/24/36h), while the embedded
-- `core.athlete_state_snapshot.has_sleep/...` are EXISTENCE flags (ever
-- recorded). Same names, opposite meanings. `missing_metrics` was built from the
-- FRESH flags and `morning_metrics` NULLed any non-fresh value — so a
-- present-but-STALE recovery metric was both listed NOT AVAILABLE (the
-- claude-proxy NEVER-FABRICATE guardrail then forbids the coach from mentioning
-- it) AND had its value suppressed, even though the snapshot still holds it. The
-- coach withheld / contradicted recovery data it actually had.
--
-- FIX (disambiguate; suppress only genuinely-absent data):
--   * has_X now = PRESENT (existence) — consistent with athlete_state_snapshot.has_X.
--   * NEW has_X_fresh = within threshold; NEW *_age_hours; NEW stale_metrics[].
--   * missing_metrics = ABSENT-only (present-but-stale is NOT missing).
--   * morning_metrics surfaces PRESENT values (not nulled when stale) + *_stale flags + dates.
--
-- Applied as a deterministic patch of the LIVE function definition (so the other
-- ~250 untouched lines are reproduced byte-for-byte). Each replace is asserted to
-- have matched; the whole thing aborts (no partial patch) if the live body has
-- drifted from what this migration expects.
--
-- DEPLOY: architect applies via Supabase MCP, then runs the behavioural gate
-- 20260623_coaching_context_recovery_divergence_gate.sql and a fresh coaching output.

DO $mig$
DECLARE
  d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_athlete_coaching_context';
  IF d IS NULL THEN RAISE EXCEPTION 'get_athlete_coaching_context not found'; END IF;

  -- 1) declare the new vars (present flags, ages, stale list)
  d := replace(d,
$o1$  v_has_rhr_fresh boolean; v_has_zone_today boolean; v_has_plan_today boolean;$o1$,
$n1$  v_has_rhr_fresh boolean; v_has_zone_today boolean; v_has_plan_today boolean;
  v_has_sleep_present boolean; v_has_hrv_present boolean; v_has_rhr_present boolean;
  v_sleep_age_h int; v_hrv_age_h int; v_rhr_age_h int; v_stale text[] := ARRAY[]::text[];$n1$);

  -- 2) compute present + age FIRST, then derive fresh from them
  d := replace(d,
$o2$  v_has_sleep_fresh := COALESCE(v_state_snap.has_sleep, false)
    AND v_state_snap.sleep_date IS NOT NULL
    AND (v_today - v_state_snap.sleep_date) * 24 <= v_fresh_sleep_h;
  v_has_hrv_fresh := COALESCE(v_state_snap.has_hrv, false)
    AND v_state_snap.hrv_date IS NOT NULL
    AND (v_today - v_state_snap.hrv_date) * 24 <= v_fresh_hrv_h;
  v_has_rhr_fresh := COALESCE(v_state_snap.has_resting_hr, false)
    AND v_state_snap.resting_hr_date IS NOT NULL
    AND (v_today - v_state_snap.resting_hr_date) * 24 <= v_fresh_rhr_h;$o2$,
$n2$  -- present = ever recorded (existence); fresh = present AND recent. (recovery-divergence fix)
  v_has_sleep_present := COALESCE(v_state_snap.has_sleep, false) AND v_state_snap.sleep_date IS NOT NULL;
  v_has_hrv_present   := COALESCE(v_state_snap.has_hrv, false) AND v_state_snap.hrv_date IS NOT NULL;
  v_has_rhr_present   := COALESCE(v_state_snap.has_resting_hr, false) AND v_state_snap.resting_hr_date IS NOT NULL;
  v_sleep_age_h := CASE WHEN v_has_sleep_present THEN (v_today - v_state_snap.sleep_date) * 24 ELSE NULL END;
  v_hrv_age_h   := CASE WHEN v_has_hrv_present   THEN (v_today - v_state_snap.hrv_date) * 24 ELSE NULL END;
  v_rhr_age_h   := CASE WHEN v_has_rhr_present   THEN (v_today - v_state_snap.resting_hr_date) * 24 ELSE NULL END;
  v_has_sleep_fresh := v_has_sleep_present AND v_sleep_age_h <= v_fresh_sleep_h;
  v_has_hrv_fresh   := v_has_hrv_present   AND v_hrv_age_h   <= v_fresh_hrv_h;
  v_has_rhr_fresh   := v_has_rhr_present   AND v_rhr_age_h   <= v_fresh_rhr_h;$n2$);

  -- 3) missing = ABSENT-only; stale tracked separately (no longer suppressed)
  d := replace(d,
$o3$  IF NOT v_has_sleep_fresh THEN v_missing := array_append(v_missing, 'sleep'); END IF;
  IF NOT v_has_hrv_fresh   THEN v_missing := array_append(v_missing, 'hrv'); END IF;
  IF NOT v_has_rhr_fresh   THEN v_missing := array_append(v_missing, 'resting_hr'); END IF;$o3$,
$n3$  IF NOT v_has_sleep_present THEN v_missing := array_append(v_missing, 'sleep'); END IF;
  IF NOT v_has_hrv_present   THEN v_missing := array_append(v_missing, 'hrv'); END IF;
  IF NOT v_has_rhr_present   THEN v_missing := array_append(v_missing, 'resting_hr'); END IF;
  IF v_has_sleep_present AND NOT v_has_sleep_fresh THEN v_stale := array_append(v_stale, 'sleep'); END IF;
  IF v_has_hrv_present   AND NOT v_has_hrv_fresh   THEN v_stale := array_append(v_stale, 'hrv'); END IF;
  IF v_has_rhr_present   AND NOT v_has_rhr_fresh   THEN v_stale := array_append(v_stale, 'resting_hr'); END IF;$n3$);

  -- 4) data_completeness: has_X = present; add has_X_fresh + ages + stale_metrics
  d := replace(d,
$o4$  v_data_completeness := jsonb_build_object(
    'has_sleep', v_has_sleep_fresh, 'has_hrv', v_has_hrv_fresh,
    'has_resting_hr', v_has_rhr_fresh, 'has_zone_data_today', v_has_zone_today,
    'has_plan_for_today', v_has_plan_today,
    'missing_metrics', to_jsonb(v_missing)
  );$o4$,
$n4$  v_data_completeness := jsonb_build_object(
    -- has_X = metric is PRESENT (ever recorded), consistent with
    -- athlete_state_snapshot.has_X. Freshness is the SEPARATE has_X_fresh flag so the
    -- guardrail can tell ABSENT from STALE from FRESH. (recovery-divergence fix)
    'has_sleep', v_has_sleep_present, 'has_hrv', v_has_hrv_present,
    'has_resting_hr', v_has_rhr_present, 'has_zone_data_today', v_has_zone_today,
    'has_sleep_fresh', v_has_sleep_fresh, 'has_hrv_fresh', v_has_hrv_fresh,
    'has_resting_hr_fresh', v_has_rhr_fresh,
    'sleep_age_hours', v_sleep_age_h, 'hrv_age_hours', v_hrv_age_h, 'resting_hr_age_hours', v_rhr_age_h,
    'freshness_thresholds_h', jsonb_build_object('sleep', v_fresh_sleep_h, 'hrv', v_fresh_hrv_h, 'resting_hr', v_fresh_rhr_h),
    'has_plan_for_today', v_has_plan_today,
    'missing_metrics', to_jsonb(v_missing),
    'stale_metrics', to_jsonb(v_stale)
  );$n4$);

  -- 5) morning_metrics: surface PRESENT values (not nulled when stale) + stale flags + dates
  d := replace(d,
$o5$        'morning_metrics', jsonb_build_object(
          'sleep_hours', CASE WHEN v_has_sleep_fresh THEN v_state_snap.sleep_hours ELSE NULL END,
          'hrv_ms',      CASE WHEN v_has_hrv_fresh   THEN v_state_snap.hrv_ms      ELSE NULL END,
          'resting_hr',  CASE WHEN v_has_rhr_fresh   THEN v_state_snap.resting_hr  ELSE NULL END,
          'as_of',       v_state_snap.snapshot_date
        )$o5$,
$n5$        'morning_metrics', jsonb_build_object(
          -- Surface PRESENT values (incl. stale) so the coach is not told data is
          -- absent when it merely aged out; *_stale + *_age_hours let it caveat. (recovery-divergence fix)
          'sleep_hours', CASE WHEN v_has_sleep_present THEN v_state_snap.sleep_hours ELSE NULL END,
          'hrv_ms',      CASE WHEN v_has_hrv_present   THEN v_state_snap.hrv_ms      ELSE NULL END,
          'resting_hr',  CASE WHEN v_has_rhr_present   THEN v_state_snap.resting_hr  ELSE NULL END,
          'sleep_stale',      v_has_sleep_present AND NOT v_has_sleep_fresh,
          'hrv_stale',        v_has_hrv_present   AND NOT v_has_hrv_fresh,
          'resting_hr_stale', v_has_rhr_present   AND NOT v_has_rhr_fresh,
          'sleep_age_hours', v_sleep_age_h, 'hrv_age_hours', v_hrv_age_h, 'resting_hr_age_hours', v_rhr_age_h,
          'as_of',       v_state_snap.snapshot_date,
          'sleep_date',  v_state_snap.sleep_date, 'hrv_date', v_state_snap.hrv_date, 'resting_hr_date', v_state_snap.resting_hr_date
        )$n5$);

  -- Assert every patch matched (abort rather than deploy a partial fix).
  IF position('v_has_sleep_present boolean' IN d) = 0 THEN RAISE EXCEPTION 'patch 1 (declares) did not match'; END IF;
  IF position('v_has_sleep_present := COALESCE' IN d) = 0 THEN RAISE EXCEPTION 'patch 2 (compute) did not match'; END IF;
  IF position('IF NOT v_has_sleep_present THEN v_missing' IN d) = 0 THEN RAISE EXCEPTION 'patch 3 (missing) did not match'; END IF;
  IF position('''stale_metrics''' IN d) = 0 THEN RAISE EXCEPTION 'patch 4 (data_completeness) did not match'; END IF;
  IF position('''sleep_stale''' IN d) = 0 THEN RAISE EXCEPTION 'patch 5 (morning_metrics) did not match'; END IF;
  -- Belt-and-braces: the old overloaded forms must be gone.
  IF position('''has_sleep'', v_has_sleep_fresh' IN d) <> 0 THEN RAISE EXCEPTION 'old has_sleep=fresh form still present'; END IF;

  EXECUTE d;
  RAISE NOTICE 'get_athlete_coaching_context patched: recovery divergence fixed (has_X=present, +has_X_fresh, +stale_metrics, missing=absent-only).';
END $mig$;
