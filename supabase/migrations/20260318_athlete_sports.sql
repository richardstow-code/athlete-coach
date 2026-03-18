-- Step 1: Create athlete_sports table
create extension if not exists "uuid-ossp";

create table athlete_sports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  sport_raw text not null,
  sport_category text,
  priority text not null default 'supporting',
  current_goal_raw text,
  target_date date,
  target_metric text,
  lifecycle_state text default 'planning',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table athlete_sports enable row level security;
create policy "own_athlete_sports" on athlete_sports
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Step 2: Drop sport/goal columns from athlete_settings (now live on athlete_sports)
alter table athlete_settings
  drop column if exists sport_raw,
  drop column if exists sport_category,
  drop column if exists sport,
  drop column if exists sport_other,
  drop column if exists target_raw,
  drop column if exists target_event_name,
  drop column if exists target_date,
  drop column if exists target_description,
  drop column if exists target_type,
  drop column if exists target_metric,
  drop column if exists lifecycle_state;
