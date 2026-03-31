#!/usr/bin/env bash
set -euo pipefail

echo "    Cursor2API Linux one-click deployment"
echo "Checking Linux environment and starting deployment..."

# 1. Check/install Node.js (v20)
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "[Env] Node.js/npm not found, installing via NodeSource (Ubuntu/Debian)..."
    if ! command -v curl &> /dev/null; then
        echo "Installing curl..."
        sudo apt-get update && sudo apt-get install -y curl
    fi
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "[Env] Node.js/npm installed: $(node -v) / npm: $(npm -v)"
else
    echo "[Env] Node.js/npm already installed: $(node -v) / npm: $(npm -v)"
fi

# 2. Check/install PM2
if ! command -v pm2 &> /dev/null; then
    echo "[Env] pm2 not found, installing globally via npm..."
    sudo npm install -g pm2
    echo "[Env] pm2 installed: $(pm2 -v)"
else
    echo "[Env] pm2 already installed: $(pm2 -v)"
fi

# 3. Install deps and build
echo "[Build] Installing production dependencies..."
npm ci
echo "[Build] Compiling TypeScript (npm run build)..."
npm run build

# 4. Configure PM2
echo "[Deploy] Cleaning old PM2 process (if any)..."
pm2 delete cursor2api || true

# 5. Start service
echo "[Deploy] Starting service with PM2..."

# Set production env
export NODE_ENV=production
export PORT=${PORT:-3010}
export TIMEOUT=${TIMEOUT:-120}

pm2 start npm --name cursor2api -- start

# 6. Save and enable startup
echo "[Deploy] Saving PM2 process list for restarts..."
pm2 save
pm2 startup systemd -u $USER --hp $HOME

echo "Deployment complete! 🚀"
echo "PM2 quick commands:"
echo "▶ Logs:            pm2 logs cursor2api"
echo "▶ Monitor:         pm2 monit"
echo "▶ Restart:         pm2 restart cursor2api"
