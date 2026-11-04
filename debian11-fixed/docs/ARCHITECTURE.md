# Architecture — Debian Web Terminal

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │  Login Page  │    │       Terminal Dashboard          │  │
│  │  (React)     │    │  ┌────────────────────────────┐  │  │
│  │              │    │  │  <iframe src=ttyd_url>      │  │  │
│  │  username    │    │  │                            │  │  │
│  │  password    │    │  │  xterm.js (via ttyd)       │  │  │
│  └──────────────┘    │  │  WebSocket PTY             │  │  │
│                      │  └────────────────────────────┘  │  │
│                      └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │  HTTPS                           │  HTTPS/WSS
         ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                   VERCEL (Next.js 15)                        │
│                                                              │
│  ┌────────────────────────────┐  ┌───────────────────────┐  │
│  │      API Routes            │  │   Server Components   │  │
│  │                            │  │                       │  │
│  │  POST /api/auth/login      │  │  /login  (SSR)        │  │
│  │  POST /api/auth/logout     │  │  /terminal (SSR+auth) │  │
│  │  GET  /api/auth/session    │  │                       │  │
│  │  GET  /api/health          │  └───────────────────────┘  │
│  │  GET  /api/sandbox         │                              │
│  │  POST /api/sandbox         │                              │
│  └────────────┬───────────────┘                              │
└───────────────┼──────────────────────────────────────────────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
┌─────────────┐  ┌───────────────────────────────────────────┐
│   TURSO     │  │            VERCEL SANDBOX                  │
│  (libSQL)   │  │                                            │
│             │  │  Named: "debian-shared-terminal"           │
│  users      │  │  Image: debian-11-terminal:latest (VCR)    │
│  sessions   │  │  Ports: [7681]                             │
│  login_     │  │                                            │
│  attempts   │  │  ┌──────────────────────────────────────┐ │
│  audit_logs │  │  │  Debian GNU/Linux 11 (Bullseye)      │ │
│  terminal_  │  │  │                                      │ │
│  sessions   │  │  │  ttyd (port 7681)                    │ │
│  sandbox_   │  │  │    └── bash -l (root)                │ │
│  metadata   │  │  │    └── bash -l (root)  ← user 2      │ │
│             │  │  │    └── bash -l (root)  ← user 3      │ │
└─────────────┘  │  │                                      │ │
                 │  │  /workspace  (shared filesystem)     │ │
                 │  │  /root       (root home)             │ │
                 │  └──────────────────────────────────────┘ │
                 └───────────────────────────────────────────┘
```

## Component Descriptions

### Next.js App (Vercel)

| Route | Type | Purpose |
|---|---|---|
| `/` | Server Component | Redirect to `/login` or `/terminal` |
| `/login` | Server Component | Render login form if unauthenticated |
| `/terminal` | Server Component | Auth-gated terminal dashboard |
| `POST /api/auth/login` | API Route | Authenticate, set session cookie |
| `POST /api/auth/logout` | API Route | Invalidate session, clear cookie |
| `GET /api/auth/session` | API Route | Check current session |
| `GET /api/health` | API Route | Public health check (Turso ping) |
| `GET /api/sandbox` | API Route | Get sandbox status |
| `POST /api/sandbox` | API Route | Initialize/wake sandbox, return ttyd URL |

### Authentication Flow

```
1. User submits login form
2. POST /api/auth/login
3. Rate limit check (5 fails / 15 min / IP from Turso)
4. Look up user in Turso users table
5. Argon2id.verify(storedHash, inputPassword)
6. If valid: generate UUID session token, hash it, store in Turso sessions
7. Set HTTP-only Secure SameSite=Strict cookie with raw token
8. Record successful login attempt + audit log
9. Client redirects to /terminal

10. Every API request:
    a. Read cookie from request
    b. Hash it → look up in Turso sessions
    c. Verify not expired + user is active
    d. Update last_accessed_at
    e. Return session object to route handler
```

### Sandbox Lifecycle

```
First visit after cold start:
1. POST /api/sandbox (authenticated)
2. Sandbox.getOrCreate({ name, image, ports, timeout })
   → Sandbox doesn't exist → Vercel creates it from VCR image
   → onCreate callback fires:
      a. echo "root:$DEBIAN_ROOT_PASSWORD" | chpasswd
      b. Install ttyd if not in image
      c. Start ttyd on port 7681 (detached)
3. sandbox.domain(7681) → public HTTPS URL
4. Return URL to client
5. Client loads ttyd URL in iframe

Subsequent visits (sandbox running):
1. POST /api/sandbox
2. Sandbox.getOrCreate → sandbox exists and is running → returns immediately
3. Return same URL

After sandbox stops (timeout / idle):
1. POST /api/sandbox
2. Sandbox.getOrCreate → sandbox stopped → Vercel resumes from snapshot
   → onResume callback fires:
      a. Restart ttyd (processes don't survive stop/resume)
3. Filesystem is restored from automatic snapshot
4. Return URL to client
```

### Multi-User Terminal Architecture

Each authenticated user gets their **own independent bash shell** via ttyd's
multi-client mode. The key facts:

- ttyd spawns a **new bash process** for each WebSocket connection
- Each shell has its own process space (PID, environment, working directory)
- All shells share the **same filesystem** (`/`, `/home`, `/workspace`, etc.)
- All shells run as **root** (same UID 0)
- Terminal I/O is completely independent — users cannot see each other's output
- Files created by one user are immediately visible to others

This is intentional: it matches the requirement for a shared Debian filesystem
with per-user independent shell sessions.

### Security Architecture

```
Threat: Unauthenticated access to terminal
Mitigation: All /api/sandbox endpoints require valid session cookie.
            Server Components check getServerSession() before rendering.
            ttyd URL is never exposed in public HTML or JS bundles.

Threat: Session hijacking
Mitigation: HTTP-only cookies (not accessible from JS).
            Secure flag (HTTPS only in production).
            SameSite=Strict (no cross-site requests).
            Server-side session validation on every request.
            Session tokens stored as SHA-256 hashes in Turso.

Threat: Brute force login
Mitigation: Rate limit: 5 failed attempts per 15 minutes per IP.
            Tracked in Turso login_attempts table.
            Argon2id with high memory cost (64MB) makes offline attacks slow.

Threat: SQL injection
Mitigation: All queries use parameterized args ([]).
            No string interpolation into SQL.

Threat: Password leakage
Mitigation: Argon2id with salt (memory=64MB, time=3, parallel=4).
            Passwords never logged or returned in API responses.
            Initial password from env var, not source code.

Threat: CSRF
Mitigation: SameSite=Strict cookie attribute.
            JSON Content-Type required for POST endpoints.
            Origin validation on API routes.
```

## Database Schema

```sql
users           — id, username, password_hash (argon2id), is_active, is_admin
sessions        — id, user_id, token_hash (sha256), ip, ua, expires_at, is_active
login_attempts  — id, username, ip, success, attempted_at
audit_logs      — id, user_id, action, resource, details, ip, ua, created_at
terminal_sessions — id, user_id, session_id, sandbox_name, connected_at
sandbox_metadata  — id='shared', sandbox_name, status, last_started_at
```

## Persistence Model

| Data | Storage | Survives |
|---|---|---|
| User accounts | Turso | Forever |
| Session tokens | Turso | Until expiry (24h) |
| Login history | Turso | Forever |
| Audit logs | Turso | Forever |
| Debian filesystem | Vercel Sandbox snapshot | Stop/resume ✓, delete ✗ |
| Running processes | Sandbox RAM | Stop/resume ✗ (restarted in onResume) |

## Vercel Sandbox Constraints (Documented Facts)

1. **ENTRYPOINT/CMD not executed** — Custom image processes must be started via `runCommand()`.
2. **Filesystem persistence** — Automatic snapshots on stop. Filesystem is restored on resume.
3. **Process survival** — Processes do NOT survive stop/resume. Use `onResume` hook to restart.
4. **Named sandboxes** — Identified by `name` per project. Use `getOrCreate()` for idempotency.
5. **Port exposure** — Up to 4 ports. Access via `sandbox.domain(port)` → `https://*.vercel.run`.
6. **Image source** — Must be in Vercel Container Registry (VCR). Push with `docker push vcr.vercel.com/...`.
7. **Authentication** — Uses `VERCEL_OIDC_TOKEN` automatically on Vercel. Local dev needs `vercel env pull`.
8. **SDK version** — `@vercel/sandbox` v2.x uses named sandboxes (not anonymous ephemeral IDs).
