# Regenerate-on-source-change (DESIGN — deferred, build-ready)

Status: **DESIGN ONLY — not built.** Attached to the deferred Coach's-Take
rolling-refresh ticket. Authored 2026-06-09 (analyze-activity correctness cycle,
feature_request 9808c786 injury-staleness). This is the generalised mechanism
that the injury-staleness fix (approach B) should be built as — one mechanism,
not an injury-only trigger.

## Problem

Several coaching artifacts are **generated once and stored**, then rendered
verbatim from the DB:

- `activities.coach_analysis` (Path A, `api/analyze-activity.js`) — structured
  per-activity read. Stores active injuries, cadence, zone reads at generation
  time.
- `activities.raw_data.coach_take_audit` / the prose Coach's Take
  (`api/claude-proxy.js`) — the deferred macro "rolling refresh" target.
- (future) any artifact derived from athlete settings / zones / plan.

When the **source state changes after generation**, the stored artifact goes
stale. Observed: activity 333's `coach_analysis` flagged "Left Calf — Active,
Follow-up Overdue, recommend medical review" at 07:22; the calf was resolved in
`injury_reports` at 14:54; the card still showed it active ~4.5h later because
the stored artifact is rendered verbatim and `analyze-activity` skips
re-generation (`decideSkip` → `'exists'`).

The live injury **read** is already correct (`injury_reports.status='active'`,
overdue computed live) — the defect is purely the frozen stored artifact.

## Why not a serve-time overlay

The native app reads `coach_analysis` straight from the DB (PostgREST,
`app/activity/[id].tsx`); `analyze-activity` is POST+secret with no serve/read
path. A live overlay would require a native change or a new read endpoint/view —
out of the "server-only / no native / no EAS" scope. So the fix is to
**regenerate the stored artifact when its source state changes.**

## Design

### Source-change triggers (what invalidates)

| Source event | Affected artifact(s) | Affected scope |
|---|---|---|
| `injury_reports.status` change (active↔resolved/closed) | `coach_analysis` (injury section); prose Coach's Take | the athlete's recent analysed activities (bounded window, see below) |
| Zone recalibration (`athlete_settings.hr_zones` / `training_zones` change) | `coach_analysis` (effort_read / zone distribution) | recent analysed activities with HR data |
| (future) plan edits (`scheduled_sessions` for a past date already executed) | `coach_analysis` (execution_vs_plan) | the matched completed activity |

### Scope guard (avoid full-table re-runs)

Regeneration MUST be bounded — never a full-table sweep:

- **Time window:** only activities with `date >= now() - INTERVAL '14 days'`
  (tunable). Older cards are effectively immutable; a stale injury flag on a
  3-month-old activity is not worth the cost.
- **Already-generated only:** only rows where `coach_analysis IS NOT NULL`
  (nothing to refresh otherwise; pending rows get the fresh state on first
  generation anyway).
- **Non-superseded only:** skip rows the dual-source dedup marked as duplicates
  (`raw_data.duplicate_of` set) — regenerate the canonical row only.
- **Per-athlete:** keyed off the changed source row's `user_id`; never cross-user.

A typical injury status change therefore touches **0–N recent activities**
(usually a handful), not the table.

### The 30s / pg_net timeout constraint

`trigger_analyze_activity` already nurses the pg_net ~5s send limit by being
**fire-and-forget** (does not await the LLM). A status-change trigger that
re-runs `analyze-activity` (force) across N activities **synchronously** would
risk the same timeout, multiplied by N LLM calls. Options, in preference order:

1. **Enqueue, don't call inline (recommended).** The trigger writes N rows to a
   small `regeneration_queue` table (`user_id`, `activity_id`, `reason`,
   `requested_at`) — a cheap INSERT, well under the pg_net/statement budget.
   A worker drains the queue:
   - a Supabase cron (`pg_cron`) every minute calling a batch endpoint, **or**
   - a Vercel cron hitting `analyze-activity` with `force` per queued row.
   This decouples the (fast) trigger from the (slow) N LLM calls and gives
   natural retry/idempotency (dedupe queue rows by `activity_id`).
2. **Bounded inline fan-out via pg_net (fallback).** The trigger fires N
   independent fire-and-forget `pg_net.http_post` calls to `analyze-activity`
   (`{ activity_id, force:true }`), one per recent activity. Each POST returns
   immediately (the endpoint does not await the LLM on the trigger path). Simple,
   no new table — but N grows unbounded with the window and there is no retry
   ledger. Acceptable only if N is hard-capped (e.g. ≤ 10).

### Reuse of the existing tested path

No new generation logic. Regeneration is just the existing
`analyze-activity` **force** path (`force:true` → `decideSkip` bypasses
`'exists'`, bumps `coach_analysis_version`). That path is already exercised by
the architect's post-deploy force-re-runs. The only new code is the
trigger + queue + worker plumbing.

### Coach's-Take rolling-refresh reuse

The prose Coach's Take (`coach_take_audit`) is the same stale-stored-artifact
pattern. It should reuse this mechanism: the rolling refresh becomes "enqueue
the Coach's Take surface on the same source-change events (+ a time-based
freshness sweep)" rather than a bespoke refresher. Build the
`regeneration_queue` + worker generically (artifact-type column:
`coach_analysis` | `coach_take`) so both consume one drain loop.

## What this cycle did NOT do

No trigger, no queue, no worker were built (architect decision 2026-06-09,
DECISION 1 — defer B, design-only). Activity 333 and other stale cards are
cleared this cycle by the architect's manual post-deploy **force**-re-run, which
also picks up the FIX 2 cadence doubling. This document makes B build-ready as a
follow-up.
