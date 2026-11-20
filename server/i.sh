#!/bin/bash
# Installs the GN 2.0 Server in ~/gn-data (see server.js). Only needed once:
# after that, update.sh (run every 5 minutes by cron) keeps it up to date.
set -e
cd ~/gn-data
echo "node $(node -v)"
URL="https://raw.githubusercontent.com/SCHSwork/math/main/server"
curl -fsSL "$URL/update.sh?$(date +%s)" -o update.sh && chmod +x update.sh
curl -fsSL "$URL/deps.txt?$(date +%s)" -o deps.txt
npm install $(cat deps.txt) --no-fund --no-audit --loglevel=error
curl -fsSL "$URL/server.js?$(date +%s)" -o server.new.js
node --check server.new.js
[ -f server.js ] && cp server.js server.js.bak
mv server.new.js server.js
pm2 restart gn-data --update-env 2>/dev/null || pm2 start server.js --name gn-data
pm2 save >/dev/null
mkdir -p state
# Auto-update: pm2 runs update.sh every 5 minutes (and keeps doing it after reboots)
( crontab -l 2>/dev/null | grep -v "gn-data/update.sh" | crontab - ) 2>/dev/null || true
pm2 delete gn-update >/dev/null 2>&1 || true
pm2 start "$HOME/gn-data/update.sh" --name gn-update --interpreter bash --cron-restart "*/5 * * * *" --no-autorestart >/dev/null
pm2 save >/dev/null
echo "auto-update: $(pm2 jlist | grep -c '"name":"gn-update"') pm2 job"
sleep 4
echo; echo "== status"; curl -s localhost:8080/api/status | head -c 300; echo
echo "== health"; curl -s localhost:8080/health; echo
