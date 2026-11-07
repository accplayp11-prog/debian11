-- =============================================================================
-- Migration 002: Multi-User Sandboxes, Managed Processes, Supervisor
-- Debian Web Terminal — Turso (libSQL) Database
-- =============================================================================

-- Per-user sandbox table
-- Each user gets their own isolated Sandbox with its own persistent filesystem.
CREATE TABLE IF NOT EXISTS user_sandboxes (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    sandbox_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'unknown',
    ttyd_port INTEGER NOT NULL DEFAULT 7681,
    last_started_at INTEGER,
    last_stopped_at INTEGER,
    last_heartbeat_at INTEGER,
    terminal_url TEXT,
    image TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Managed background processes
-- Users can register long-running processes to be restarted after sandbox recovery.
CREATE TABLE IF NOT EXISTS managed_processes (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    working_dir TEXT NOT NULL DEFAULT '/root',
    restart_policy TEXT NOT NULL DEFAULT 'on-failure',
    -- 'always' | 'on-failure' | 'never'
    log_file TEXT,
    env_config TEXT,
    -- JSON blob of non-sensitive env key names (not values)
    status TEXT NOT NULL DEFAULT 'stopped',
    -- 'running' | 'stopped' | 'failed' | 'starting'
    pid INTEGER,
    -- last known PID (may be stale after sandbox resume)
    failure_count INTEGER NOT NULL DEFAULT 0,
    max_failures INTEGER NOT NULL DEFAULT 5,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_started_at INTEGER,
    last_stopped_at INTEGER,
    last_error TEXT,
    -- Flag: interactive processes (shells, etc.) are NOT auto-restarted
    is_interactive INTEGER NOT NULL DEFAULT 0
);

-- Supervisor heartbeats: record each time the supervisor ran
CREATE TABLE IF NOT EXISTS supervisor_heartbeats (
    id TEXT PRIMARY KEY NOT NULL,
    ran_at INTEGER NOT NULL DEFAULT (unixepoch()),
    action TEXT NOT NULL,
    -- 'check' | 'resume' | 'skip' (locked) | 'error'
    sandbox_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    result TEXT,
    -- JSON
    duration_ms INTEGER,
    error TEXT
);

-- Recovery events: detailed record of each sandbox recovery
CREATE TABLE IF NOT EXISTS recovery_events (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    sandbox_name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    -- 'supervisor' | 'user-request' | 'startup'
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER,
    success INTEGER,
    -- 1 = success, 0 = failure
    processes_restarted INTEGER NOT NULL DEFAULT 0,
    processes_failed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    details TEXT
    -- JSON
);

-- Supervisor lock: prevents duplicate concurrent supervisor runs
CREATE TABLE IF NOT EXISTS supervisor_lock (
    id TEXT PRIMARY KEY NOT NULL DEFAULT 'global',
    locked_at INTEGER,
    lock_expires_at INTEGER,
    locked_by TEXT
    -- hostname or request ID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_sandboxes_user_id ON user_sandboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sandboxes_status ON user_sandboxes(status);
CREATE INDEX IF NOT EXISTS idx_managed_processes_user_id ON managed_processes(user_id);
CREATE INDEX IF NOT EXISTS idx_managed_processes_status ON managed_processes(status);
CREATE INDEX IF NOT EXISTS idx_supervisor_heartbeats_ran_at ON supervisor_heartbeats(ran_at);
CREATE INDEX IF NOT EXISTS idx_recovery_events_user_id ON recovery_events(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_events_started_at ON recovery_events(started_at);

-- Initialize supervisor lock row
INSERT OR IGNORE INTO supervisor_lock (id, locked_at, lock_expires_at, locked_by)
VALUES ('global', NULL, NULL, NULL);
