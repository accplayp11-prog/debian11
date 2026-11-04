#!/usr/bin/env bash
# =============================================================================
# Build and push the Debian 11 custom image to Vercel Container Registry (VCR)
# =============================================================================
# Usage: ./scripts/build-image.sh [team-slug] [project-slug] [tag]
#
# Prerequisites:
#   1. Docker installed and running locally
#   2. Vercel CLI installed: npm install -g vercel
#   3. Logged in to Vercel: vercel login
#   4. Linked to your project: vercel link
#
# This script will:
#   1. Authenticate Docker with VCR
#   2. Build the Debian 11 image
#   3. Tag it for VCR
#   4. Push it to VCR

set -euo pipefail

# --- Configuration ---
TEAM_SLUG="${1:-your-team-slug}"
PROJECT_SLUG="${2:-debian-web-terminal}"
IMAGE_TAG="${3:-latest}"
REPO_NAME="debian-11-terminal"

VCR_IMAGE="vcr.vercel.com/${TEAM_SLUG}/${PROJECT_SLUG}/${REPO_NAME}:${IMAGE_TAG}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Debian Web Terminal — VCR Image Builder        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Team:    ${TEAM_SLUG}"
echo "Project: ${PROJECT_SLUG}"
echo "Image:   ${VCR_IMAGE}"
echo ""

# --- Authenticate with VCR ---
echo "🔑 Authenticating Docker with Vercel Container Registry..."
vercel whoami > /dev/null 2>&1 || {
    echo "❌ Not logged in to Vercel. Run: vercel login"
    exit 1
}

# Get Vercel token and authenticate Docker
# Option 1: Using vercel vcr login (if available via plugin)
if command -v vercel >/dev/null 2>&1; then
    VERCEL_TOKEN=$(vercel whoami --token 2>/dev/null || echo "")
    if [ -z "$VERCEL_TOKEN" ]; then
        echo "Using VERCEL_TOKEN environment variable..."
        VERCEL_TOKEN="${VERCEL_TOKEN:-}"
    fi
fi

# Docker login to VCR
# Note: VCR uses your Vercel token as the password
echo "Logging in to vcr.vercel.com..."
echo "${VERCEL_TOKEN}" | docker login vcr.vercel.com \
    --username "$(vercel whoami)" \
    --password-stdin 2>/dev/null || {
    echo ""
    echo "⚠️  Automatic Docker login failed. Try manual authentication:"
    echo "   vercel vcr login  (if using Vercel CLI plugin)"
    echo "   OR"
    echo "   export DOCKER_HOST=... (if using Vercel's build system)"
    echo ""
    echo "Attempting to build anyway..."
}

# --- Build the image ---
echo ""
echo "🏗️  Building Debian 11 Docker image..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

docker build \
    --platform linux/amd64 \
    --tag "${REPO_NAME}:${IMAGE_TAG}" \
    --tag "${VCR_IMAGE}" \
    --file "${PROJECT_ROOT}/Dockerfile" \
    "${PROJECT_ROOT}"

echo ""
echo "✅ Image built successfully: ${REPO_NAME}:${IMAGE_TAG}"

# --- Push to VCR ---
echo ""
echo "📤 Pushing image to Vercel Container Registry..."
docker push "${VCR_IMAGE}"

echo ""
echo "✅ Image pushed: ${VCR_IMAGE}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo ""
echo "1. Set SANDBOX_IMAGE in Vercel environment variables:"
echo "   ${REPO_NAME}:${IMAGE_TAG}"
echo ""
echo "   OR if referencing the full VCR URL:"
echo "   ${VCR_IMAGE}"
echo ""
echo "2. The sandbox.ts library will use this image."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
