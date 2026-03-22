# Activity Streams

## What streams are fetched and why

After each new Strava activity is ingested (via the database webhook that fires on activities INSERT), the `enrich-activity` edge function fetches 5 stream types from the Strava API:

| Stream | Why |
|---|---|
| `heartrate` | Zone time computation, coaching zone discipline feedback |
| `cadence` | Cadence quality and trend analysis |
| `altitude` | Grade computation for pace-on-hills analysis |
| `velocity_smooth` | Grade correlation (pace penalty per % grade) |
| `latlng` | Future: GPS-based route analysis, segment detection |

Strava endpoint:
```
GET /api/v3/activities/{id}/streams?keys=heartrate,cadence,altitude,velocity_smooth,latlng&key_by_type=true
```

Not all streams are present for every activity (e.g. an indoor run has no latlng; some watches don't record cadence). Missing streams are handled gracefully — stored as null per sample.

---

## 10-second downsampling

Raw Strava streams are at 1-second resolution. This is downsampled to every 10th sample to reduce storage size while preserving enough resolution for zone and cadence analysis.

- **heartrate, cadence, altitude, latlng**: Spot-sample at index 0, 10, 20, 30...
- **velocity_smooth**: Average of the 10 surrounding points (smoother, avoids single-point spikes)
- **time offset**: Each sample has `t` = seconds from activity start (0, 10, 20...)

A 1-hour run at 1s resolution = ~3,600 samples per stream type. After downsampling: ~360 samples.

---

## `activity_streams` table

```sql
CREATE TABLE activity_streams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id   BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  strava_id     BIGINT NOT NULL,
  samples       JSONB NOT NULL,
  zone_seconds  JSONB DEFAULT NULL,
  cadence_stats JSONB DEFAULT NULL,
  grade_correlation JSONB DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(activity_id)
);
```

### `samples` format

Array of objects, one per 10-second interval:
```json
[
  { "t": 0,   "hr": 138, "cad": 166, "alt": 312.4, "vel": 3.18, "lat": 47.721, "lng": 13.082 },
  { "t": 10,  "hr": 142, "cad": 168, "alt": 312.6, "vel": 3.21, "lat": 47.722, "lng": 13.083 },
  ...
]
```

Fields:
- `t` — seconds from activity start
- `hr` — heart rate (bpm), null if no HR data
- `cad` — cadence (spm), null if no cadence
- `alt` — altitude (m), null if no altitude
- `vel` — velocity (m/s), averaged over 10 surrounding points, null if not available
- `lat`, `lng` — coordinates, null if no GPS

---

## How `zone_seconds` is computed

Uses the athlete's current effective HR zones (from `athlete_settings.hr_zones` if calibrated, else `training_zones`, else system defaults).

For each sample with a non-null HR value, 10 seconds is added to the appropriate zone bucket.

```json
{ "z1": 120, "z2": 1840, "z3": 340, "z4": 60, "z5": 0 }
```

This is written to:
- `activity_streams.zone_seconds` — full record
- `activities.zone_data` — same value, for quick access without joining streams

---

## How `cadence_stats` is computed

From samples where `cad > 0`:
- `avg` — mean cadence across the activity
- `trend` — array of 5 segment averages (equal-length time segments across the activity)

```json
{ "avg": 172, "trend": [168, 170, 173, 174, 172] }
```

A trend that rises (e.g. [165, 168, 172, 174, 175]) suggests cadence improves as the athlete warms up or focuses. A declining trend may indicate fatigue.

---

## How `grade_correlation` is computed

For each consecutive pair of samples where both altitude and velocity are present:
1. Compute altitude delta (m)
2. Estimate horizontal distance from average velocity × time interval
3. Compute grade = (alt_delta / distance) × 100 (%)
4. Compute Pearson correlation between grade values and velocity values

```json
{ "correlation": -0.62 }
```

Interpretation:
- `< -0.5` → strong pace penalty on hills (pace drops significantly on climbs)
- `-0.2` to `-0.5` → moderate grade effect
- `> -0.2` → minimal grade effect (flat course or athlete maintains pace well on hills)

---

## Zone Calibration

HR zone boundaries used for `zone_seconds` computation are read from `athlete_settings.hr_zones` (if calibrated) or fall back to defaults matching the coaching system prompt:

| Zone | Default |
|---|---|
| Z1 | < 125 bpm |
| Z2 | 125–140 bpm |
| Z3 | 141–158 bpm |
| Z4 | 159–172 bpm |
| Z5 | > 172 bpm |

Calibration runs automatically every 10th enriched activity, or manually via Settings → Training Zones → Recalibrate zones.

See [`/docs/admin-workflows.md`](./admin-workflows.md) for zone calibration SQL.
