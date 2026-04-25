-- AC-143 / AC-138: link activities back to the scheduled session they
-- completed, so soft-deleting an activity can cleanly revert the session
-- back to 'planned'. Added nullable because most pre-existing activities
-- have no linked session and back-fill would be fuzzy.

alter table activities
  add column if not exists completed_session_id integer
    references scheduled_sessions(id) on delete set null;

create index if not exists activities_completed_session_id_idx
  on activities (completed_session_id)
  where completed_session_id is not null;
