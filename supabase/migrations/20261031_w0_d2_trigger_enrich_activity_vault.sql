-- W0-D2 (#20): trigger_enrich_activity reads its secret from Vault; the
-- inline service_role JWT and the inline webhook secret are removed.
--
-- enrich-activity runs with verify_jwt = false and authorises callers on
-- x-webhook-secret alone, so the trigger sends no Supabase key at all.
-- Probe on 31 Oct 2026: a POST with no apikey and no Authorization reaches
-- the function and gets 403 from its own secret check.
--
-- Precondition: Vault holds a secret named 'enrich_webhook_secret' equal to
-- the enrich-activity function secret ENRICH_WEBHOOK_SECRET. Without it the
-- trigger logs a warning and skips enrichment, same as analyze_activity_on_complete.
--
-- SECURITY DEFINER because inserts arrive as service_role and authenticated,
-- and only the owner can read vault.decrypted_secrets.

create or replace function public.trigger_enrich_activity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_secret text;
begin
  -- On INSERT: fires if status = 'pending'
  -- On UPDATE: only fires if status changed TO 'pending' (prevents infinite loops)
  if new.enrichment_status = 'pending' and
     (tg_op = 'INSERT' or old.enrichment_status is distinct from 'pending') then

    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'enrich_webhook_secret'
    limit 1;

    if v_secret is null then
      raise warning '[enrich_activity] vault secret missing; skipping activity %', new.id;
      return new;
    end if;

    perform net.http_post(
      url := 'https://yjuhzmknabedjklsgbje.supabase.co/functions/v1/enrich-activity',
      body := jsonb_build_object(
        'type',   tg_op,
        'table',  'activities',
        'record', to_jsonb(new)
      ),
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.trigger_enrich_activity() from public, anon, authenticated;
