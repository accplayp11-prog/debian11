#!/usr/bin/env bash
# =============================================================================
# Build and push the Debian 11 image to Vercel Container Registry (VCR)
# =============================================================================
# Uses the OFFICIAL Vercel CLI workflow:
#   vercel vcr login docker     — authenticates Docker with VCR for this project
#   vercel vcr build docker .   — builds linux/amd64, pushes to VCR
#
# Prerequisites:
#   npm install -g vercel        (Vercel CLI)
#   vercel login                 (authenticate)
#   vercel link                  (link project — creates .vercel/project.json)
#   Docker Desktop / daemon running
#
# Usage:
#   ./scripts/build-image.sh [tag]
#   ./scripts/build-image.sh latest
#   ./scripts/build-image.sh v1.1
# =============================================================================

set -euo pipefail

REPO_NAME="debian-11-terminal"
IMAGE_TAG="${1:-latest}"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Debian Web Terminal — VCR Image Builder            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Repository : ${REPO_NAME}"
echo "Tag        : ${IMAGE_TAG}"
echo ""

# --- Verify prerequisites ---
command -v vercel >/dev/null 2>&1 || {
  echo "❌ Vercel CLI not found. Install: npm install -g vercel"
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  echo "❌ Docker not found. Install Docker Desktop."
  exit 1
}
vercel whoami >/dev/null 2>&1 || {
  echo "❌ Not logged in to Vercel. Run: vercel login"
  exit 1
}
[ -f ".vercel/project.json" ] || {
  echo "❌ Project not linked. Run: vercel link"
  exit 1
}

# --- Authenticate Docker with VCR for this project ---
echo "🔑 Authenticating Docker with VCR..."
vercel vcr login docker
echo "✅ Docker authenticated with VCR"
echo ""

# --- Build and push with the official CLI command ---
# vercel vcr build docker:
#   - Builds the Dockerfile in the current directory
#   - Targets linux/amd64 (required by Vercel Sandbox)
#   - Applies zstd compression (recommended)
#   - Pushes directly to vcr.vercel.com/<team>/<project>/<repo>:<tag>
#   - The <team> and <project> are read from .vercel/project.json automatically

echo "🏗️  Building and pushing Debian 11 image to VCR..."
echo "    Command: vercel vcr build docker . ${REPO_NAME}:${IMAGE_TAG} --push"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$PROJECT_ROOT"
vercel vcr build docker . "${REPO_NAME}:${IMAGE_TAG}" --push

echo ""
echo "✅ Image pushed: ${REPO_NAME}:${IMAGE_TAG}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXT STEPS:"
echo ""
echo "1. Check the image is READY in Vercel dashboard:"
echo "   Project → Storage → Container Registry"
echo "   Wait for status: Ready  (not Preparing/Unoptimized)"
echo ""
echo "2. Verify/set SANDBOX_IMAGE in Vercel env vars:"
echo "   SANDBOX_IMAGE=${REPO_NAME}:${IMAGE_TAG}"
echo ""
echo "3. Redeploy your Vercel project."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
