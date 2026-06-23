-- 20260623_analyze_activity_regen_on_injury_zone_change.sql  (ticket 9808c786)
--
-- BUG: activities.coach_analysis is generated ONCE (trg_analyze_activity_on_complete,
-- on enrichment→complete) and rendered verbatim by the native app. It bakes in the
-- ACTIVE-injury set + zones at generation time and never re-evaluates. When an
-- injury is later RESOLVED in injury_reports, the stored card still shows it active
-- and keeps a medical-review recommendation — a coaching-trust failure.
--
-- FIX (regenerate-on-source-change, targeted slice): when an injury's active-ness
-- changes, or zones change, pg_net POST analyze-activity with force:true for the
-- affected already-analysed activities. analyze-activity re-reads the CURRENT
-- injury_reports/zones and regenerates; its injury/zone source-fingerprint guard
-- (this same ticket) skips the LLM for activities whose baked-in source is
-- unchanged, so these triggers are safe to fire broadly.
--
-- Mirrors analyze_activity_on_complete(): SECURITY DEFINER, search_path='', vault
-- secret 'analyze_activity_secret', same URL + headers. Single-athlete (WHEN guard).
--
-- DEPLOY: architect applies via Supabase MCP, then runs the behavioural gate
-- (resolve an active injury → the activity's card regenerates without the active /
-- medical-review language). analyze-activity (Vercel) must be deployed first.

-- ── Injury active-status change → regenerate analysed-since-reported activities ──
CREATE OR REPLACE FUNCTION public.regenerate_analyses_on_injury_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_secret text;
  v_url text := 'https://athlete-coach-alpha.vercel.app/api/analyze-activity';
  r record;
begin
  -- Only when the injury's ACTIVE-ness actually crosses (active <-> not active).
  if (new.status = 'active') is not distinct from (old.status = 'active') then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'analyze_activity_secret' limit 1;
  if v_secret is null then
    raise warning '[regen_injury] vault secret missing; skipping injury %', new.id;
    return new;
  end if;

  -- Activities whose stored analysis was generated WHILE this injury was active
  -- (i.e. could have baked it in): coach_analysis present, generated on/after the
  -- injury was reported.
  for r in
    select id from public.activities
    where user_id = new.user_id
      and is_deleted is not true
      and coach_analysis is not null
      and coach_analysis_generated_at >= new.reported_at
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-analyze-secret', v_secret),
      body := jsonb_build_object('activity_id', r.id, 'force', true, 'reason', 'injury_change'),
      timeout_milliseconds := 30000
    );
  end loop;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_regen_analysis_on_injury ON public.injury_reports;
CREATE TRIGGER trg_regen_analysis_on_injury
AFTER UPDATE OF status ON public.injury_reports
FOR EACH ROW
WHEN (new.status IS DISTINCT FROM old.status
      AND new.user_id = '40cfe68e-faea-491c-b410-0093572f02d6'::uuid)
EXECUTE FUNCTION public.regenerate_analyses_on_injury_change();

-- ── Zone change → regenerate recent (14d) analysed activities ───────────────────
CREATE OR REPLACE FUNCTION public.regenerate_analyses_on_zone_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_secret text;
  v_url text := 'https://athlete-coach-alpha.vercel.app/api/analyze-activity';
  r record;
begin
  -- Only when the zone definitions actually change.
  if new.training_zones is not distinct from old.training_zones
     and new.hr_zones is not distinct from old.hr_zones then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'analyze_activity_secret' limit 1;
  if v_secret is null then
    raise warning '[regen_zone] vault secret missing; skipping zone change for user %', new.user_id;
    return new;
  end if;

  -- Zones can affect any recent card's zone language; regenerate the last 14 days
  -- of analysed activities. The zone-fingerprint guard skips the LLM where the
  -- effective zones for an activity are unchanged.
  for r in
    select id from public.activities
    where user_id = new.user_id
      and is_deleted is not true
      and coach_analysis is not null
      and date >= (now() - interval '14 days')
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-analyze-secret', v_secret),
      body := jsonb_build_object('activity_id', r.id, 'force', true, 'reason', 'zone_change'),
      timeout_milliseconds := 30000
    );
  end loop;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_regen_analysis_on_zone ON public.athlete_settings;
CREATE TRIGGER trg_regen_analysis_on_zone
AFTER UPDATE OF training_zones, hr_zones ON public.athlete_settings
FOR EACH ROW
WHEN (new.user_id = '40cfe68e-faea-491c-b410-0093572f02d6'::uuid)
EXECUTE FUNCTION public.regenerate_analyses_on_zone_change();
