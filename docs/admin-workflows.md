# Admin Workflows

## Feature Requests & Bug Reports

### How submissions flow

1. User opens modal (via roadmap `+ Request` button, footer "Report a bug" link, Settings, or HelpBot).
2. Modal writes directly to `feature_requests` (type = `feature` | `bug`).
3. Modal calls `notify-feature-request` edge function — which writes to `admin_notifications` and sends an email (if `ADMIN_EMAIL` and `RESEND_API_KEY` are set in Supabase secrets).
4. Email is non-fatal: if Resend is not configured, the submission is still saved to the DB.

### Triage a new submission

```sql
-- View all unread admin notifications
SELECT * FROM admin_notifications WHERE read_at IS NULL ORDER BY created_at DESC;

-- Mark as read
UPDATE admin_notifications SET read_at = NOW() WHERE id = <id>;

-- View all feature requests in triage
SELECT id, type, title, description, vote_count, priority, created_at
FROM feature_requests
WHERE status = 'triage'
ORDER BY vote_count DESC, created_at DESC;
```

### Change a request's status

```sql
UPDATE feature_requests SET status = 'in_review' WHERE id = '<uuid>';
UPDATE feature_requests SET status = 'designing' WHERE id = '<uuid>';
UPDATE feature_requests SET status = 'in_dev'    WHERE id = '<uuid>';
UPDATE feature_requests SET status = 'completed' WHERE id = '<uuid>';
```

### Decline a request (with reason shown to users)

```sql
UPDATE feature_requests
SET status = 'declined',
    decline_reason = 'Out of scope for a single-athlete app.'
WHERE id = '<uuid>';
```

The `decline_reason` is displayed in the roadmap UI under declined cards.

### Set priority

```sql
UPDATE feature_requests SET priority = 'high' WHERE id = '<uuid>';
-- priority values: low | normal | high | critical
```

### Notify users of a status change

```sql
-- Insert a notification for all users who voted on a request
INSERT INTO feature_notifications (user_id, feature_id, message)
SELECT fv.user_id,
       fr.id,
       'Update on "' || fr.title || '": now ' || fr.status
FROM feature_requests fr
JOIN feature_votes fv ON fv.feature_id = fr.id
WHERE fr.id = '<uuid>';
```

Users see a notification badge on the settings icon until they open the roadmap (which marks all as seen).

---

## Tables

| Table | Purpose |
|---|---|
| `feature_requests` | All feature requests and bug reports |
| `feature_votes` | One row per user per request (dedup via unique index) |
| `feature_notifications` | Per-user notifications for status changes |
| `admin_notifications` | Internal log of all submissions (never exposed to users) |

### `feature_requests` columns

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `type` | TEXT | `feature` or `bug` |
| `title` | TEXT | Short label |
| `description` | TEXT | Full description (bugs include screen + frequency) |
| `status` | TEXT | `triage` → `in_review` → `designing` → `in_dev` → `completed` / `declined` |
| `priority` | TEXT | `low` / `normal` / `high` / `critical` |
| `vote_count` | INT | Cached count |
| `decline_reason` | TEXT | Shown on the roadmap card if declined |
| `admin_notes` | TEXT | Internal only, not shown to users |
| `created_by` | UUID | FK to auth.users |

---

## Edge function secrets

Set in Supabase dashboard → Settings → Edge Functions → Secrets:

| Secret | Purpose |
|---|---|
| `ADMIN_EMAIL` | Recipient address for submission emails |
| `RESEND_API_KEY` | Resend API key for sending emails |

If neither is set, submissions still save to `admin_notifications` — no email is sent.
