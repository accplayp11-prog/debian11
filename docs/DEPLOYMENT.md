# Deployment Guide — Debian Web Terminal

Complete step-by-step instructions to go from source code to a live production deployment.

---

## Prerequisites

Install these tools before starting:

```bash
# Node.js 20+ (use nvm or the official installer)
node --version   # must be 20+

# Docker (for building the Debian image)
docker --version

# Vercel CLI
npm install -g vercel
vercel --version

# Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash
turso --version
```

---

## Step 1 — GitHub Repository

```bash
# 1. Create a new GitHub repository named debian-web-terminal
# (do this on github.com, then clone it)
git clone https://github.com/YOUR_USERNAME/debian-web-terminal.git temp-repo

# 2. Copy project files into the repo
cp -r /path/to/debian-web-terminal/* temp-repo/
cd temp-repo

# 3. Verify .gitignore is present (never commit secrets)
cat .gitignore

# 4. Initial commit
git add .
git commit -m "feat: initial Debian Web Terminal implementation"
git push origin main
```

---

## Step 2 — Turso Database Setup

```bash
# 1. Create a Turso account at https://app.turso.tech

# 2. Login via CLI
turso auth login

# 3. Create the database
turso db create debian-web-terminal

# 4. Get the database URL (copy this — you need it for env vars)
turso db show debian-web-terminal --url
# Output: libsql://debian-web-terminal-YOUR_ORG.turso.io

# 5. Create an auth token (copy this — keep it secret)
turso db tokens create debian-web-terminal
# Output: eyJhbGciOiJFZERTQSJ9.eyJ... (a JWT, keep this secret)

# 6. Verify connectivity (optional)
turso db shell debian-web-terminal "SELECT 1"
```

---

## Step 3 — Local Environment Setup

```bash
cd debian-web-terminal

# 1. Copy the environment template
cp .env.example .env.local

# 2. Generate secure secrets
openssl rand -base64 64    # Use for SESSION_SECRET
openssl rand -hex 16        # Use for DEBIAN_ROOT_PASSWORD

# 3. Edit .env.local with real values:
#    TURSO_DATABASE_URL=libsql://your-database.turso.io
#    TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSJ9...
#    INITIAL_ADMIN_USERNAME=yassine
#    INITIAL_ADMIN_PASSWORD=choose-a-strong-password
#    SESSION_SECRET=the-64-char-string-from-openssl
#    DEBIAN_ROOT_PASSWORD=the-hex-string-from-openssl
#    SANDBOX_NAME=debian-shared-terminal
#    SANDBOX_IMAGE=debian-11-terminal:latest
nano .env.local   # or use your preferred editor

# 4. Install dependencies
npm install
```

---

## Step 4 — Database Migrations

```bash
# Run migrations + seed the initial admin user
# This reads from .env.local automatically via tsx
npm run db:migrate
```

Expected output:
```
🔌 Connecting to Turso database...
📦 Running database migrations...
✅ Migrations complete
🔐 Creating admin user 'yassine'...
✅ Admin user 'yassine' created (id: xxxxxxxx-...)
✅ Database setup complete
```

---

## Step 5 — Build the Debian 11 Docker Image

The Debian 11 image is pushed to Vercel Container Registry (VCR).

```bash
# 1. Login to Vercel and link your project
vercel login
vercel link

# 2. Find your team slug and project slug
#    - Team slug: Vercel dashboard → your team → URL slug
#    - Project slug: Vercel dashboard → project name slug

# 3. Authenticate Docker with VCR
#    Option A: Using Vercel token
export VERCEL_TOKEN=$(cat ~/.local/share/com.vercel.cli/auth.json | jq -r '.token')
echo $VERCEL_TOKEN | docker login vcr.vercel.com \
  --username "your-vercel-email@example.com" \
  --password-stdin

#    Option B: Using vercel CLI plugin (if installed)
npx plugins add vercel/vercel-plugin
vercel vcr login

# 4. Build and push the image
./scripts/build-image.sh YOUR_TEAM_SLUG YOUR_PROJECT_SLUG latest

# This builds: vcr.vercel.com/YOUR_TEAM/YOUR_PROJECT/debian-11-terminal:latest
```

**What the Dockerfile does:**
- Uses `debian:bullseye-slim` as base
- Switches APT sources to `archive.debian.org` (required for Debian 11 archived repos)
- Installs: bash, git, python3, pip3, curl, wget, nano, vim, htop, net-tools, etc.
- Sets hostname to `debian`
- Creates `/workspace` directory
- Verifies `/etc/os-release` reports `Debian GNU/Linux 11` at build time

---

## Step 6 — Vercel Project Configuration

### 6a. Configure Environment Variables

Go to: **Vercel Dashboard → Your Project → Settings → Environment Variables**

Add each variable for **Production** (and optionally Preview):

| Variable | Value | Secret |
|---|---|---|
| `TURSO_DATABASE_URL` | `libsql://your-db.turso.io` | Yes |
| `TURSO_AUTH_TOKEN` | `eyJ...` | Yes |
| `INITIAL_ADMIN_USERNAME` | `yassine` | No |
| `INITIAL_ADMIN_PASSWORD` | Your admin password | Yes |
| `SESSION_SECRET` | Your 64-char secret | Yes |
| `DEBIAN_ROOT_PASSWORD` | Your Debian root password | Yes |
| `SANDBOX_NAME` | `debian-shared-terminal` | No |
| `SANDBOX_IMAGE` | `debian-11-terminal:latest` | No |

**Note:** `VERCEL_OIDC_TOKEN`, `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID` are
set automatically by Vercel for functions running on Vercel infrastructure.
You only need to set `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID` if deploying
from outside Vercel (e.g. CI/CD pipelines using an access token).

### 6b. Enable Vercel Sandbox

Vercel Sandbox requires the Vercel Sandbox add-on on your plan.
Check: **Vercel Dashboard → Your Team → Billing → Add-ons**

---

## Step 7 — Deploy to Vercel

```bash
# Preview deployment (test before going live)
vercel deploy

# Production deployment
vercel deploy --prod
```

After deployment, Vercel outputs your URL:
```
✅ Production: https://debian-web-terminal.vercel.app [3s]
```

---

## Step 8 — Production Verification

```bash
# 1. Health check (should return {"status":"ok","database":"ok"})
curl https://your-deployment.vercel.app/api/health

# 2. Open in browser
open https://your-deployment.vercel.app

# 3. Login with username: yassine, password: (your INITIAL_ADMIN_PASSWORD)

# 4. After connecting, run in the terminal:
cat /etc/os-release
# Should show: Debian GNU/Linux 11 (Bullseye)

whoami
# Should show: root

hostname
# Should show: debian

python3 --version
# Should show: Python 3.9.x

git --version
# Should show: git version 2.30.x
```

---

## Updating the Debian Image

To update the image (e.g. add more packages):

```bash
# 1. Edit the Dockerfile
# 2. Rebuild and push with a new tag
./scripts/build-image.sh YOUR_TEAM YOUR_PROJECT v1.1

# 3. Update SANDBOX_IMAGE in Vercel env vars to: debian-11-terminal:v1.1

# 4. Redeploy
vercel deploy --prod

# 5. The existing named sandbox will continue to use the OLD image
#    until it is deleted and recreated. To force a fresh sandbox:
#    - Delete the sandbox via Vercel dashboard or CLI
#    - The next POST /api/sandbox call will create a fresh one from the new image
```

---

## Updating Admin Password

```bash
# Update INITIAL_ADMIN_PASSWORD in .env.local, then:
npm run db:seed
```

---

## CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - run: npm run typecheck

      - run: npm run build

      - name: Run database migrations
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          INITIAL_ADMIN_USERNAME: ${{ secrets.INITIAL_ADMIN_USERNAME }}
          INITIAL_ADMIN_PASSWORD: ${{ secrets.INITIAL_ADMIN_PASSWORD }}
          SANDBOX_NAME: debian-shared-terminal
        run: npm run db:migrate

      - name: Deploy to Vercel
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_TEAM_ID }}
        run: |
          npx vercel deploy --prod \
            --token $VERCEL_TOKEN \
            --yes
```

Add these secrets to your GitHub repository:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `INITIAL_ADMIN_USERNAME`
- `INITIAL_ADMIN_PASSWORD`
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID`

---

## Troubleshooting

### "Sandbox not found" error
The named sandbox may have been deleted. The next request will create a new one.
Filesystem state will be empty on a fresh sandbox.

### "ttyd connection refused"
- The sandbox may still be starting. Wait 10–15 seconds and retry.
- Check sandbox logs in Vercel dashboard.
- The ttyd binary may have failed to download. Add it to the Dockerfile instead.

### Login page shows "Invalid username or password"
- Verify `INITIAL_ADMIN_PASSWORD` matches what was used when running `db:migrate`.
- Run `npm run db:seed` to reset the password to the current env var value.

### "Too many failed login attempts"
- Wait 15 minutes (the rate limit window resets).
- Or manually delete rows from `login_attempts` table in Turso console.

### Database errors on startup
- Verify `TURSO_DATABASE_URL` starts with `libsql://`
- Verify `TURSO_AUTH_TOKEN` is not expired (create a new token with `turso db tokens create`)
- Check `/api/health` endpoint for detailed error message
