-- AC-138: nightly cron to hard-delete soft-deleted activities after 7 days.
-- Deletion cascades to activity_streams (ON DELETE CASCADE) and sets
-- coaching_memory.activity_id to NULL (ON DELETE SET NULL) so coach memory
-- survives the purge but stops pointing at the deleted row.

-- Requires pg_cron extension. Safe to run twice — unschedule is idempotent.

create extension if not exists pg_cron;

-- Remove prior schedule under the same name before rescheduling.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'purge_soft_deleted_activities';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'purge_soft_deleted_activities',
  '0 3 * * *',
  $$
    delete from activities
    where is_deleted = true
      and deleted_at is not null
      and deleted_at < now() - interval '7 days'
  $$
);
