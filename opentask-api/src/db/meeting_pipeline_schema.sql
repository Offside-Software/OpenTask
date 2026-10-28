DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'opentask' AND table_name = 'meetings' AND column_name = 'user_uuid'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'opentask' AND table_name = 'meetings' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE opentask.meetings RENAME COLUMN user_uuid TO created_by;
    END IF;
END $$;

ALTER TABLE opentask.meetings ADD COLUMN IF NOT EXISTS created_by TEXT;
-- Rows that never went through the pipeline (manual entries, legacy rows) count as COMPLETED.
-- Pipeline rows are written as PROCESSING and follow their latest job.
ALTER TABLE opentask.meetings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE opentask.meetings ADD COLUMN IF NOT EXISTS recall_bot_id TEXT;
ALTER TABLE opentask.meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_recall_bot_id
    ON opentask.meetings(recall_bot_id) WHERE recall_bot_id IS NOT NULL;

-- Legacy Python uploads were MANUAL_UPLOAD; the pipeline calls them MEDIA.
UPDATE opentask.meetings SET source_type = 'MEDIA' WHERE source_type = 'MANUAL_UPLOAD';

-- One row per processing run. A job reaches its project through its meeting.
CREATE TABLE IF NOT EXISTS opentask.meeting_jobs (
    id              BIGINT PRIMARY KEY,
    meeting_id      BIGINT NOT NULL REFERENCES opentask.meetings(id) ON DELETE CASCADE,
    source_type     TEXT NOT NULL,                       -- copy of the meeting's, never changes
    status          TEXT NOT NULL DEFAULT 'CREATED',     -- JobStatus
    meeting_date    TIMESTAMPTZ NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    attendee_ids    BIGINT[] NOT NULL DEFAULT '{}',      -- opentask.users.id
    r2_keys         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- storage keys, not URLs
    duration_sec    INTEGER,                             -- measured server-side by ffprobe
    gate            JSONB,                               -- GateResult
    attempts        INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,                         -- worker lease
    next_attempt_at TIMESTAMPTZ,                         -- retry or rate-limit delay
    last_error      TEXT
);
-- The DRAFT_APPROVAL alert raised for this job, resolved when the review finishes.
ALTER TABLE opentask.meeting_jobs ADD COLUMN IF NOT EXISTS alert_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_meeting_jobs_meeting_id ON opentask.meeting_jobs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_jobs_claim
    ON opentask.meeting_jobs(status, next_attempt_at)
    WHERE status IN ('QUEUED', 'TRANSCRIBING', 'GATING', 'EXTRACTING');

-- Normalized transcript per job, plus the per-chunk extraction checkpoint used to resume.
CREATE TABLE IF NOT EXISTS opentask.meeting_transcripts (
    job_id                BIGINT PRIMARY KEY REFERENCES opentask.meeting_jobs(id) ON DELETE CASCADE,
    language              TEXT,
    segments              JSONB NOT NULL,                -- Vec<Segment>
    extraction_checkpoint JSONB,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);
-- Per-part Whisper results while a recording is transcribed, for resume.
ALTER TABLE opentask.meeting_transcripts ADD COLUMN IF NOT EXISTS asr_checkpoint JSONB;

-- Evidence and the as-extracted snapshot for each task the pipeline created.
CREATE TABLE IF NOT EXISTS opentask.task_extraction_meta (
    task_id            BIGINT PRIMARY KEY REFERENCES opentask.tasks(id) ON DELETE CASCADE,
    job_id             BIGINT NOT NULL REFERENCES opentask.meeting_jobs(id) ON DELETE CASCADE,
    evidence_quote     TEXT NOT NULL,
    evidence_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    evidence_segment   INTEGER,
    evidence_start_sec INTEGER,
    confidence         TEXT NOT NULL,                    -- high | medium | low
    assignee_hint      TEXT,                             -- name as spoken
    resolved_user_id   BIGINT,                           -- unique member match; the draft stays unassigned
    due_text           TEXT,                             -- as spoken
    due_date           DATE,
    original           JSONB NOT NULL,                   -- the task as extracted, before review
    created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_extraction_meta_job_id ON opentask.task_extraction_meta(job_id);

-- Rejected drafts are deleted now. Remove the locked Archived column that used to hold them.
DELETE FROM opentask.tasks t
USING opentask.buckets b
WHERE t.bucket_id = b.id AND b.state = 'ARCHIVED' AND b.is_system_locked;
DELETE FROM opentask.buckets WHERE state = 'ARCHIVED' AND is_system_locked;

-- tasks.meeting_id becomes a real foreign key. Approved tasks outlive their meeting.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'opentask.tasks'::regclass AND conname = 'tasks_meeting_id_fkey'
    ) THEN
        UPDATE opentask.tasks t SET meeting_id = NULL
        WHERE t.meeting_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM opentask.meetings m WHERE m.id = t.meeting_id);
        ALTER TABLE opentask.tasks
            ADD CONSTRAINT tasks_meeting_id_fkey
            FOREIGN KEY (meeting_id) REFERENCES opentask.meetings(id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tasks_meeting_id ON opentask.tasks(meeting_id) WHERE meeting_id IS NOT NULL;

-- AI calls per UTC day, project (0 = none) and model: free-tier limits and project quotas.
-- own_key: made with the project's own API key rather than the shared one.
CREATE TABLE IF NOT EXISTS opentask.ai_usage_daily (
    day           DATE NOT NULL,
    project_id    BIGINT NOT NULL DEFAULT 0,
    model         TEXT NOT NULL,
    own_key       BOOLEAN NOT NULL DEFAULT FALSE,
    requests      INTEGER NOT NULL DEFAULT 0,
    tokens        BIGINT NOT NULL DEFAULT 0,
    audio_seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, project_id, model, own_key)
);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'opentask' AND table_name = 'ai_usage_daily' AND column_name = 'own_key'
    ) THEN
        ALTER TABLE opentask.ai_usage_daily ADD COLUMN own_key BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE opentask.ai_usage_daily DROP CONSTRAINT ai_usage_daily_pkey;
        ALTER TABLE opentask.ai_usage_daily ADD PRIMARY KEY (day, project_id, model, own_key);
    END IF;
END $$;

-- A project's own provider API key, AES-256-GCM encrypted with a key derived from SECRET_KEY.
CREATE TABLE IF NOT EXISTS opentask.project_ai_keys (
    project_id BIGINT NOT NULL REFERENCES opentask.projects(id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,
    key_cipher BYTEA NOT NULL,
    key_hint   TEXT NOT NULL,
    tier       TEXT NOT NULL DEFAULT 'free',
    updated_by BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, provider)
);
