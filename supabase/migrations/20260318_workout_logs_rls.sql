alter table workout_logs add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table workout_logs enable row level security;
create policy "own_workout_logs" on workout_logs using (auth.uid() = user_id) with check (auth.uid() = user_id);
