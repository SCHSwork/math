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
( crontab -l 2>/dev/null | grep -v "gn-data/update.sh"; echo "*/5 * * * * \$HOME/gn-data/update.sh >> \$HOME/gn-data/state/update.log 2>&1" ) | crontab -
echo "auto-update: $(crontab -l | grep -c gn-data/update.sh) cron job"
sleep 4
echo; echo "== status"; curl -s localhost:8080/api/status | head -c 300; echo
echo "== health"; curl -s localhost:8080/health; echo
