# Security — Debian Web Terminal

## ⚠️ Critical Warning

This application exposes a **shared root Linux shell** to all authenticated users.
Any authenticated user has full `root` access to the Debian environment, including
the ability to read, modify, or delete any file, run any command, and access any
running process.

**This is appropriate only for:**
- Single-user personal deployments
- Fully-trusted internal team environments
- Development and testing scenarios

**It is NOT appropriate for:**
- Public-facing multi-tenant deployments
- Environments with untrusted users
- Production systems containing sensitive data

## Security Controls Implemented

### Authentication
- Username/password login backed by Turso
- Passwords hashed with **Argon2id** (memory=64MB, time=3, parallel=4)
- Initial admin password configured via environment variable (never hardcoded)
- Session tokens are random UUIDs, stored as SHA-256 hashes server-side

### Session Management
- **HTTP-only cookies** — session token is never accessible from JavaScript
- **Secure flag** — cookies only sent over HTTPS in production
- **SameSite=Strict** — prevents cross-site request forgery via cookie
- 24-hour session lifetime
- Session invalidated on logout

### Rate Limiting / Brute Force Protection
- Maximum **5 failed login attempts per IP per 15 minutes**
- All attempts (success and failure) recorded in Turso `login_attempts` table
- Rate limit checked before password verification

### Authorization
- Every API endpoint calls `requireAuth()` before any action
- Server Components call `getServerSession()` and redirect if unauthenticated
- The ttyd URL is **never** included in public HTML or client-side JS bundles
- The Vercel Sandbox management API is called only from server-side routes

### Transport
- Next.js enforces HTTPS on Vercel (HTTP requests redirect to HTTPS)
- WebSocket terminal connection uses WSS (via ttyd on Vercel Sandbox domain)
- Security headers set via `vercel.json`:
  - `X-Frame-Options: DENY` (prevents clickjacking)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

### Database
- All SQL queries use **parameterized arguments** (`args: [value]`) — no interpolation
- Database credentials in environment variables only, never in source code
- Turso auth token is server-side only, never sent to browser

### Secrets Management
- No secrets in source code or git history
- All secrets via environment variables
- `.gitignore` excludes `.env`, `.env.local`, and all `.env.*.local` files

## Audit Logging

The following events are recorded in the `audit_logs` table in Turso:

| Event | Logged Data |
|---|---|
| `login.success` | user_id, ip, user_agent |
| `login.failed` | username, ip, user_agent, reason |
| `logout` | user_id |
| `terminal.access` | user_id, ip (when sandbox URL is returned) |

## Known Limitations

1. **Shared root filesystem** — All users share the same `/` filesystem with root privileges.
2. **No command audit** — Individual shell commands are not logged (would require shell audit daemon like auditd inside the sandbox).
3. **Process isolation** — Users can see and kill each other's processes.
4. **No resource limits** — Users can consume all available CPU/RAM within the sandbox.
5. **Network access** — The Debian sandbox has outbound internet access by default (Vercel Sandbox network policy can restrict this).

## Hardening Recommendations (Post-Deployment)

For higher-security deployments, consider:

1. **Restrict Vercel Sandbox network egress:**
   ```ts
   await sandbox.updateNetworkPolicy({
     allow: ['archive.debian.org', 'pypi.org'],
   });
   ```

2. **Run ttyd as a non-root user** — Create a restricted user inside the sandbox image and configure ttyd to run commands as that user.

3. **Per-user sandbox instances** — Remove shared filesystem risk by giving each user their own sandbox (increases cost and cold-start time).

4. **Command logging** — Install `auditd` in the Debian image and ship logs to an external service.

5. **IP allowlisting** — Restrict login to known IP ranges at the Next.js middleware level.

6. **MFA** — Add TOTP as a second factor for the login flow.

## Responsible Disclosure

If you find a security vulnerability, please report it privately rather than opening a public issue.
