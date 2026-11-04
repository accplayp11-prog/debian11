#!/usr/bin/env bash
# =============================================================================
# Vercel deployment script for Debian Web Terminal
# =============================================================================
# Usage: ./scripts/deploy.sh [--prod]
#
# This script:
#   1. Checks required environment variables exist in .env.local
#   2. Runs the database setup
#   3. Deploys to Vercel (preview by default, --prod for production)

set -euo pipefail

PROD="${1:-}"
DEPLOY_FLAGS=""
if [ "$PROD" = "--prod" ]; then
    DEPLOY_FLAGS="--prod"
    echo "🚀 Production deployment"
else
    echo "🚀 Preview deployment (use --prod for production)"
fi

# Check vercel CLI
command -v vercel >/dev/null 2>&1 || {
    echo "❌ Vercel CLI not found. Install with: npm install -g vercel"
    exit 1
}

# Check environment
if [ -f .env.local ]; then
    echo "✅ .env.local found"
else
    echo "⚠️  No .env.local found. Creating from .env.example..."
    echo "   Please fill in the required values before running setup."
    cp .env.example .env.local
fi

# Run database migrations
echo ""
echo "📦 Running database setup..."
npm run db:migrate

# Deploy
echo ""
echo "🚀 Deploying to Vercel..."
vercel deploy $DEPLOY_FLAGS

echo ""
echo "✅ Deployment complete"
