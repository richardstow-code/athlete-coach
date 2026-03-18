-- Migrate athlete_settings from single shared row (id=1) to per-user rows
-- scoped by user_id with RLS.

-- 1. Add user_id column
alter table athlete_settings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2. Back-fill existing row with the first user in auth.users (single-user install)
--    Safe to run on an empty auth.users — update simply no-ops.
update athlete_settings
set user_id = (select id from auth.users order by created_at limit 1)
where id = 1 and user_id is null;

-- 3. Enable RLS
alter table athlete_settings enable row level security;

-- 4. Policies
--    Each user can read and write only their own row.
create policy "athlete_settings: owner select"
  on athlete_settings for select
  using (user_id = auth.uid());

create policy "athlete_settings: owner insert"
  on athlete_settings for insert
  with check (user_id = auth.uid());

create policy "athlete_settings: owner update"
  on athlete_settings for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "athlete_settings: owner delete"
  on athlete_settings for delete
  using (user_id = auth.uid());
