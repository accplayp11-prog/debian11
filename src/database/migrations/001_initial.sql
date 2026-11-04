-- =============================================================================
-- Migration 001: Initial Schema
-- Debian Web Terminal — Turso (libSQL) Database
-- =============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_login_at INTEGER
);

-- Sessions table (HTTP session tokens)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
    is_active INTEGER NOT NULL DEFAULT 1
);

-- Login attempts table (for rate limiting / brute force protection)
CREATE TABLE IF NOT EXISTS login_attempts (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource TEXT,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Terminal sessions table (tracks active WebSocket terminal connections)
CREATE TABLE IF NOT EXISTS terminal_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sandbox_name TEXT NOT NULL,
    connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
    disconnected_at INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- Sandbox metadata table (tracks the shared Sandbox state)
CREATE TABLE IF NOT EXISTS sandbox_metadata (
    id TEXT PRIMARY KEY NOT NULL DEFAULT 'shared',
    sandbox_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    last_started_at INTEGER,
    last_stopped_at INTEGER,
    image TEXT,
    notes TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time ON login_attempts(username, attempted_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user_id ON terminal_sessions(user_id);
