# Debian Web Terminal

A browser-based Debian GNU/Linux 11 (Bullseye) terminal, authenticated with Turso and running on Vercel Sandbox.

---

## Overview

| Feature | Detail |
|---|---|
| OS | Debian GNU/Linux 11 (Bullseye) |
| Terminal | xterm.js via ttyd WebSocket PTY |
| Auth backend | Turso (libSQL) with Argon2id password hashing |
| Compute | Vercel Sandbox (persistent named sandbox) |
| Framework | Next.js 15 (App Router) |
| Security | HTTP-only cookies, rate limiting, audit logs |

### Architecture

```
Browser (xterm.js)
  │
  └── HTTPS/WSS ──► Next.js on Vercel
                        │
                        ├── /api/auth/* ──► Turso (libSQL)
                        │                  (users, sessions, audit)
                        │
                        └── /api/sandbox ──► Vercel Sandbox SDK
                                             getOrCreate("debian-shared-terminal")
                                             │
                                             └── Debian 11 image (VCR)
                                                 └── ttyd (WebSocket PTY)
                                                     └── bash -l (root shell)
```

**Multi-user model:**
- ONE shared Debian 11 Sandbox for all authenticated users.
- Each user gets their own independent bash shell process via ttyd.
- The filesystem (`/`) is shared — all users see the same files.
- Files persist across sandbox stop/resume via Vercel's automatic filesystem snapshots.
- Running processes (ttyd, bash) do NOT survive a stop/resume — they are restarted in `onResume`.

---

## Prerequisites

- Node.js 20+
- Docker (for building the Debian image)
- Vercel CLI: `npm install -g vercel`
- Vercel account with Sandbox access
- Turso account: https://app.turso.tech

---

## Setup Instructions

### Step 1: Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/debian-web-terminal.git
cd debian-web-terminal
npm install
```

### Step 2: Create Turso database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Login
turso auth login

# Create database
turso db create debian-web-terminal

# Get database URL
turso db show debian-web-terminal --url
# Output: libsql://debian-web-terminal-YOUR_ORG.turso.io

# Create auth token
turso db tokens create debian-web-terminal
# Output: eyJ... (your auth token)
```

### Step 3: Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in:

```env
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token-here
INITIAL_ADMIN_USERNAME=yassine
INITIAL_ADMIN_PASSWORD=your-secure-password
SESSION_SECRET=your-64-char-random-string
DEBIAN_ROOT_PASSWORD=your-debian-root-password
SANDBOX_NAME=debian-shared-terminal
SANDBOX_IMAGE=debian-11-terminal:latest
VERCEL_PROJECT_ID=your-project-id
VERCEL_TEAM_ID=your-team-id
```

Generate secrets:
```bash
openssl rand -base64 64  # SESSION_SECRET
openssl rand -hex 16     # DEBIAN_ROOT_PASSWORD
```

### Step 4: Run database migrations and seed admin

```bash
npm run db:migrate
```

This creates all tables and the initial admin user (`yassine` with your configured password).

### Step 5: Link Vercel project

```bash
vercel login
vercel link
vercel env pull  # Pulls VERCEL_OIDC_TOKEN and project IDs to .env.local
```

### Step 6: Build and push the Debian 11 image to Vercel Container Registry

```bash
# Find your team slug and project slug from Vercel dashboard
./scripts/build-image.sh YOUR_TEAM_SLUG YOUR_PROJECT_SLUG latest
```

This:
1. Authenticates Docker with VCR
2. Builds the Debian 11 image (uses `archive.debian.org` for archived Bullseye repos)
3. Pushes to `vcr.vercel.com/team-slug/project-slug/debian-11-terminal:latest`

After pushing, set `SANDBOX_IMAGE` in Vercel to `debian-11-terminal:latest`.

### Step 7: Configure Vercel environment variables

In the Vercel dashboard (Settings → Environment Variables), add:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | Your Turso URL |
| `TURSO_AUTH_TOKEN` | Your Turso token |
| `INITIAL_ADMIN_USERNAME` | `yassine` |
| `INITIAL_ADMIN_PASSWORD` | Your admin password |
| `SESSION_SECRET` | Your 64-char secret |
| `DEBIAN_ROOT_PASSWORD` | Your Debian root password |
| `SANDBOX_NAME` | `debian-shared-terminal` |
| `SANDBOX_IMAGE` | `debian-11-terminal:latest` |
| `VERCEL_PROJECT_ID` | Your Vercel project ID |
| `VERCEL_TEAM_ID` | Your Vercel team ID |

### Step 8: Deploy

```bash
# Preview deployment
vercel deploy

# Production deployment
vercel deploy --prod
```

### Step 9: Run database migrations in production

```bash
# Run against production Turso database
npm run db:migrate
```

### Step 10: Verify

1. Open your Vercel URL
2. You should see the login page
3. Log in with username `yassine` and your configured password
4. The terminal should start (may take 10–30s on first boot)
5. Run: `cat /etc/os-release`
6. Output should confirm Debian GNU/Linux 11 (Bullseye)

---

## Running Tests

```bash
# Local unit tests (no credentials required)
npx tsx tests/unit.test.ts

# TypeScript compilation check
npm run typecheck

# Production build test
npm run build
```

---

## Project Structure

```
debian-web-terminal/
├── Dockerfile                  # Debian 11 image for Vercel Sandbox
├── README.md
├── .env.example                # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts
├── vercel.json
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   ├── globals.css         # Global styles
│   │   ├── page.tsx            # Root redirect
│   │   ├── login/
│   │   │   └── page.tsx        # Login page (server component)
│   │   ├── terminal/
│   │   │   └── page.tsx        # Terminal page (auth-gated)
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/      # POST: authenticate user
│   │       │   ├── logout/     # POST: invalidate session
│   │       │   └── session/    # GET: check session status
│   │       ├── sandbox/        # GET/POST: sandbox management
│   │       └── health/         # GET: health check
│   ├── components/
│   │   ├── LoginForm.tsx       # Login UI (client component)
│   │   ├── TerminalDashboard.tsx  # Terminal UI shell
│   │   └── TerminalClient.tsx  # xterm.js / ttyd iframe
│   ├── lib/
│   │   ├── auth.ts             # Authentication & session logic
│   │   ├── turso.ts            # Turso database client
│   │   ├── sandbox.ts          # Vercel Sandbox management
│   │   └── security.ts         # Security utilities
│   └── database/
│       └── migrations/
│           └── 001_initial.sql  # Schema: users, sessions, audit
├── scripts/
│   ├── setup-database.ts       # DB migrations + admin seed
│   ├── build-image.sh          # Docker build + VCR push
│   └── deploy.sh               # Vercel deployment helper
└── tests/
    └── unit.test.ts            # Local + remote test suite
```

---

## Security Notes

This system exposes a **shared root shell** to all authenticated users.

**Security measures implemented:**
- Authentication required before any terminal access
- HTTP-only, Secure, SameSite=Strict session cookies
- Argon2id password hashing (memory: 64MB, time: 3 iterations)
- Rate limiting: 5 failed attempts per 15 min per IP
- Brute force protection via login attempt tracking in Turso
- Origin validation for all API requests
- Server-side session validation on every API call
- Audit logging of all logins, logouts, and terminal access
- No credentials in frontend bundles (all in Next.js server routes)
- SQL injection prevention via parameterized queries

**Known security consequences of a shared root shell:**
- All authenticated users have full root access to the same environment
- Any user can read/modify/delete files created by other users
- Any user can run arbitrary commands including destructive ones
- This is appropriate for single-user or fully-trusted environments
- For multi-user isolation, use separate sandbox instances per user

---

## Vercel Sandbox Runtime Notes

- **Persistence**: The Debian filesystem is automatically snapshotted when the sandbox stops. Files survive stop/resume.
- **Process survival**: Running processes (ttyd) do NOT survive a stop. The `onResume` hook restarts them.
- **Timeout**: The sandbox auto-stops after 2 hours of inactivity. It wakes on the next request.
- **Custom image**: The Dockerfile uses `archive.debian.org` to handle Debian 11's archived repository state.
- **Cold start**: First boot of a new sandbox takes ~15–30 seconds. Subsequent resumes are faster.
- **ENTRYPOINT/CMD**: Vercel Sandbox ignores these in custom images. Services are started via `runCommand()`.

---

## Troubleshooting

**Terminal shows "Starting sandbox…" for >60 seconds:**
- The Vercel Sandbox may be cold-starting or the ttyd binary is being downloaded.
- Check `/tmp/ttyd.log` inside the sandbox for errors.

**Login fails with "Too many failed login attempts":**
- Wait 15 minutes (the rate limit window).
- Or check the `login_attempts` table in Turso to verify the issue.

**`cat /etc/os-release` doesn't show Debian 11:**
- The custom Docker image was not pushed to VCR, or `SANDBOX_IMAGE` is incorrect.
- Verify with: `vercel vcr list` and check the image was pushed.

**ttyd not connecting:**
- Port `7681` may not be exposed. Check `ports: [7681]` in `sandbox.ts`.
- Check sandbox logs via Vercel dashboard.

---

## License

MIT
# debian11
