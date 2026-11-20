#!/bin/bash
# Installs or updates the GN 2.0 Server in ~/gn-data (see server.js)
set -e
cd ~/gn-data
echo "node $(node -v)"
curl -fsSL "https://raw.githubusercontent.com/SCHSwork/math/main/server/server.js?$(date +%s)" -o server.js.new
node --check server.js.new
[ -f server.js ] && cp server.js "server.js.bak"
npm install express@4 firebase-admin@13 --no-fund --no-audit --loglevel=error
mv server.js.new server.js
pm2 restart gn-data --update-env 2>/dev/null || pm2 start server.js --name gn-data
pm2 save >/dev/null
sleep 4
echo; echo "== status"; curl -s localhost:8080/api/status; echo
echo "== health"; curl -s localhost:8080/health; echo
echo "== no-token save request (should be 401)"; curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/api/saves/abc/chunks/x
echo "== game file"; curl -s -o /dev/null -w "%{http_code} %{size_download} bytes\n" localhost:8080/gh/SCHSwork/math@main/manifest.json
pm2 logs gn-data --lines 5 --nostream
