-- =======================================================
-- OpenTask Database Schema (Supabase PostgreSQL)
-- =======================================================

CREATE SCHEMA IF NOT EXISTS opentask;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS opentask.users (
    id BIGINT PRIMARY KEY,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    telegram_chat_id TEXT DEFAULT '',
    gh_username TEXT,
    gh_access_token TEXT,
    gh_id TEXT,
    email TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_gh_id ON opentask.users(gh_id);
CREATE INDEX IF NOT EXISTS idx_users_gh_username ON opentask.users(gh_username);
CREATE INDEX IF NOT EXISTS idx_users_email ON opentask.users(email);

-- 2. Projects Table
CREATE TABLE IF NOT EXISTS opentask.projects (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    gh_repo_url TEXT[] DEFAULT '{}',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Buckets Table (Kanban Columns)
CREATE TABLE IF NOT EXISTS opentask.buckets (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled',
    state TEXT NOT NULL DEFAULT 'TODO',
    is_system_locked BOOLEAN DEFAULT FALSE,
    order_idx INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_buckets_project_id ON opentask.buckets(project_id);

-- 4. Tasks Table
CREATE TABLE IF NOT EXISTS opentask.tasks (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    bucket_id BIGINT REFERENCES opentask.buckets(id) ON DELETE CASCADE,
    meeting_id BIGINT,
    parent_task_id BIGINT,
    lead_assignee_id BIGINT REFERENCES opentask.users(id) ON DELETE SET NULL,
    suggested_assignee_id BIGINT REFERENCES opentask.users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'OTHER',
    weight INT DEFAULT 3,
    branch_name TEXT,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    order_idx INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON opentask.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_bucket_id ON opentask.tasks(bucket_id);

-- 5. Project Members Table
CREATE TABLE IF NOT EXISTS opentask.project_member (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES opentask.users(id) ON DELETE CASCADE,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'MEMBER',
    kpi_score FLOAT DEFAULT 0.0,
    max_capacity INT DEFAULT 10,
    current_load INT DEFAULT 0,
    gh_username TEXT,
    UNIQUE(user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_member_project_id ON opentask.project_member(project_id);

-- 6. Alerts Table
CREATE TABLE IF NOT EXISTS opentask.alerts (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES opentask.users(id) ON DELETE CASCADE,
    context_id BIGINT,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    title TEXT,
    description TEXT,
    type TEXT,
    severity TEXT DEFAULT 'info',
    suggested_actions TEXT[] DEFAULT '{}',
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON opentask.alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_project_id ON opentask.alerts(project_id);

-- 7. Activities Table
CREATE TABLE IF NOT EXISTS opentask.activities (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    user_name TEXT,
    action TEXT,
    target TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activities_project_id ON opentask.activities(project_id);

-- 8. Meetings Table
CREATE TABLE IF NOT EXISTS opentask.meetings (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    user_uuid TEXT,
    title TEXT,
    date TEXT,
    time TEXT,
    duration TEXT,
    source_type TEXT,
    mom_summary TEXT,
    key_decisions JSONB,
    action_items JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meetings_project_id ON opentask.meetings(project_id);

-- 9. Project History Table (Audit Trail & Timeline)
CREATE TABLE IF NOT EXISTS opentask.project_history (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    user_id BIGINT,
    user_name TEXT,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id BIGINT,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_history_project_id ON opentask.project_history(project_id);
CREATE INDEX IF NOT EXISTS idx_project_history_created_at ON opentask.project_history(created_at);
CREATE INDEX IF NOT EXISTS idx_project_history_proj_created ON opentask.project_history(project_id, created_at DESC);

-- 10. GitHub Installations Table (links GitHub App installations to projects)
CREATE TABLE IF NOT EXISTS opentask.github_installations (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL,
    account_login TEXT NOT NULL,
    account_type TEXT DEFAULT 'Organization',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gh_installations_project ON opentask.github_installations(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gh_installations_unique ON opentask.github_installations(project_id, installation_id);

-- 11. PR Reviews Table (persists AI verdict results per PR)
CREATE TABLE IF NOT EXISTS opentask.pr_reviews (
    id BIGINT PRIMARY KEY,
    project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
    task_id BIGINT REFERENCES opentask.tasks(id) ON DELETE SET NULL,
    repo_full_name TEXT NOT NULL,
    pr_number INT NOT NULL,
    pr_title TEXT,
    pr_url TEXT,
    verdict TEXT NOT NULL,
    feedback TEXT,
    matched_task_title TEXT,
    completeness_score INT DEFAULT 0,
    reviewed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_project ON opentask.pr_reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_task ON opentask.pr_reviews(task_id);

-- Migration: Add repo_url to tasks table
ALTER TABLE opentask.tasks ADD COLUMN IF NOT EXISTS repo_url TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_repo_url ON opentask.tasks(repo_url);

-- Migration: Add api_key to projects table for AI Agent access
ALTER TABLE opentask.projects ADD COLUMN IF NOT EXISTS api_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_api_key ON opentask.projects(api_key) WHERE api_key IS NOT NULL;

