create table if not exists race_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  event_name  text,
  event_date  date,
  goal_type   text,
  result_raw  text,
  felt        text check (felt in ('great', 'ok', 'tough', 'didnt_complete')),
  notes       text,
  created_at  timestamptz default now()
);

alter table race_results enable row level security;

create policy "race_results_select" on race_results for select using (auth.uid() = user_id);
create policy "race_results_insert" on race_results for insert with check (auth.uid() = user_id);
create policy "race_results_update" on race_results for update using (auth.uid() = user_id);
