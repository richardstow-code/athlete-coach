-- AC-148: saved sensors per user. BLE peripheral UUIDs are opaque on
-- iOS so ble_uuid is nullable (virtual sensors like HealthKit Watch HR
-- have no BLE UUID). RLS restricts each row to its owner.

create table if not exists saved_sensors (
  id                 serial primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  ble_uuid           text,
  display_name       text not null,
  device_model       text,
  service_uuids      text[] not null default '{}',
  sensor_type        text not null check (sensor_type in (
    'hr','power','cadence','footpod','speed','combo','healthkit_hr'
  )),
  sport_defaults     text[] not null default '{}',
  last_connected_at  timestamptz,
  first_paired_at    timestamptz not null default now(),
  is_active          boolean not null default true,
  unique (user_id, ble_uuid)
);

create index if not exists saved_sensors_user_last_idx
  on saved_sensors (user_id, last_connected_at desc);

alter table saved_sensors enable row level security;

drop policy if exists saved_sensors_owner on saved_sensors;
create policy saved_sensors_owner
  on saved_sensors
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
