-- Generalise athlete_settings to support multiple sports and goal types.
-- New fields: goal_type, sport, sport_other, target_type, target_event_name,
--             target_date, target_description, current_level, health_notes, lifecycle_state

alter table athlete_settings
  add column if not exists goal_type          text,
  add column if not exists sport              text,
  add column if not exists sport_other        text,
  add column if not exists target_type        text,
  add column if not exists target_event_name  text,
  add column if not exists target_date        date,
  add column if not exists target_description text,
  add column if not exists current_level      text,
  add column if not exists health_notes       text,
  add column if not exists lifecycle_state    text;

alter table athlete_settings
  add constraint chk_as_goal_type       check (goal_type       in ('compete','fitness','weight_loss','general','other')                      or goal_type       is null),
  add constraint chk_as_sport           check (sport           in ('running','cycling','triathlon','swimming','strength','other')             or sport           is null),
  add constraint chk_as_target_type     check (target_type     in ('event','milestone','open_ended')                                         or target_type     is null),
  add constraint chk_as_current_level   check (current_level   in ('beginner','recreational','competitive','elite')                          or current_level   is null),
  add constraint chk_as_lifecycle_state check (lifecycle_state in ('base_build','build','peak','taper','race','recovery','off_season')        or lifecycle_state is null);

-- Backfill existing user: running/compete athlete in base build targeting Munich Marathon 2026
update athlete_settings
set
  goal_type          = 'compete',
  sport              = 'running',
  sport_other        = null,
  target_type        = 'event',
  target_event_name  = 'Munich Marathon 2026',
  target_date        = '2026-10-12',
  target_description = 'Sub-3:00 marathon; secondary target 3:10 (4:15–4:31/km)',
  current_level      = 'competitive',
  health_notes       = 'C6 degenerative disc disease, right shoulder suspected bone spurs. Currently injury-free. Core work non-negotiable during ramp phases.',
  lifecycle_state    = 'base_build'
where user_id is not null;
