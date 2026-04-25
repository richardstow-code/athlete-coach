-- AC-149: label each HR sample with its provenance so we can reason about
-- data quality in downstream coaching (Polar H10 BLE vs Apple Watch via
-- HealthKit vs GPS-only session with no HR source).

alter table activity_streams
  add column if not exists source text;

-- Existing rows from pre-AC-149 recordings were chest-strap only.
update activity_streams
set source = 'polar_h10'
where source is null
  and hr is not null;

update activity_streams
set source = 'gps_only'
where source is null;
