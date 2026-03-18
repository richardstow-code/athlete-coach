-- Step 1: Add cycle fields to athlete_settings
alter table athlete_settings
  add column if not exists cycle_tracking_enabled  boolean default false,
  add column if not exists cycle_length_avg        integer,
  add column if not exists cycle_is_irregular      boolean default false,
  add column if not exists cycle_last_period_date  date,
  add column if not exists cycle_notes             text;

-- Step 2: Create cycle_logs table (one log per user per day)
create table if not exists cycle_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete cascade not null,
  created_at         timestamptz default now(),
  log_date           date not null default current_date,
  phase_reported     text check (phase_reported in ('feeling_good','low_energy','high_energy','pms','menstruating','other')),
  notes              text,
  override_intensity text check (override_intensity in ('reduce','maintain','rest')),
  unique(user_id, log_date)
);

alter table cycle_logs enable row level security;
create policy "cycle_logs_select" on cycle_logs for select using (auth.uid() = user_id);
create policy "cycle_logs_insert" on cycle_logs for insert with check (auth.uid() = user_id);
create policy "cycle_logs_update" on cycle_logs for update using (auth.uid() = user_id);
create policy "cycle_logs_delete" on cycle_logs for delete using (auth.uid() = user_id);
