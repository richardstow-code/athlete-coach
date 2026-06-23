-- 20260623_coaching_context_recovery_divergence_gate.sql
-- Behavioural gate for the recovery-divergence fix. Run AFTER applying
-- 20260623_coaching_context_recovery_divergence.sql. Fully transactional
-- (ROLLBACK) — it deletes-then-restores the athlete's recovery rows to build a
-- deterministic fixture, asserts the RPC output, and persists nothing. Run as a
-- single transaction (psql: \i file; or paste the whole thing). RAISEs on the
-- first failure; prints "RECOVERY-DIVERGENCE GATE PASSED" on success.

BEGIN;
DO $$
DECLARE
  v_uid uuid := '40cfe68e-faea-491c-b410-0093572f02d6'; -- single athlete (full context)
  v_ctx jsonb; v_dc jsonb; v_mm jsonb;
BEGIN
  -- Isolate the recovery source so the fixture is deterministic (ROLLBACK restores it).
  DELETE FROM health_metrics  WHERE user_id = v_uid;
  DELETE FROM health_snapshots WHERE user_id = v_uid;

  -- ── ABSENT: no recovery rows → genuinely NOT AVAILABLE ──────────────────
  v_ctx := get_athlete_coaching_context(v_uid, 'briefing', NULL, NULL, NULL);
  v_dc  := v_ctx->'core'->'data_completeness';
  IF NOT (v_dc->'missing_metrics' @> '["sleep"]'::jsonb) THEN
    RAISE EXCEPTION 'ABSENT: sleep should be in missing_metrics (got %)', v_dc->'missing_metrics';
  END IF;
  IF (v_dc->>'has_sleep')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'ABSENT: has_sleep should be false'; END IF;
  RAISE NOTICE 'OK absent: sleep flagged NOT AVAILABLE';

  -- ── PRESENT-BUT-STALE: snapshot 3 days old (> 36h sleep / 24h hrv+rhr) ───
  INSERT INTO health_snapshots(user_id, date, sleep_hours, hrv_ms, resting_hr, created_at)
    VALUES (v_uid, (now() AT TIME ZONE 'Europe/Vienna')::date - 3, 7.2, 65, 48, now());

  v_ctx := get_athlete_coaching_context(v_uid, 'briefing', NULL, NULL, NULL);
  v_dc  := v_ctx->'core'->'data_completeness';
  v_mm  := v_ctx->'surface_extras'->'morning_metrics';

  -- stale is NOT suppressed as missing (the bug)...
  IF v_dc->'missing_metrics' @> '["sleep"]'::jsonb THEN
    RAISE EXCEPTION 'STALE sleep wrongly suppressed as missing (would gag the coach)';
  END IF;
  -- ...it is flagged stale...
  IF NOT (v_dc->'stale_metrics' @> '["sleep"]'::jsonb) THEN
    RAISE EXCEPTION 'STALE sleep not flagged in stale_metrics (got %)', v_dc->'stale_metrics';
  END IF;
  -- ...present, not fresh...
  IF (v_dc->>'has_sleep')::boolean IS NOT TRUE  THEN RAISE EXCEPTION 'has_sleep should be true (present)'; END IF;
  IF (v_dc->>'has_sleep_fresh')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'has_sleep_fresh should be false (stale)'; END IF;
  -- ...and the real value is surfaced, not nulled.
  IF v_mm->>'sleep_hours' IS NULL THEN RAISE EXCEPTION 'STALE sleep value was suppressed (nulled) in morning_metrics'; END IF;
  IF (v_mm->>'sleep_stale')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'morning_metrics.sleep_stale not set'; END IF;
  RAISE NOTICE 'OK stale: sleep surfaced (% h) with stale flag, not suppressed', v_mm->>'sleep_hours';

  RAISE NOTICE 'RECOVERY-DIVERGENCE GATE PASSED';
END $$;
ROLLBACK;
