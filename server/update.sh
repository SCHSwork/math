#!/bin/bash
# Runs every 5 minutes from pm2 ("gn-update", set up by i.sh). When server/server.js on
# GitHub (SCHSwork/math, main) changes, installs it and restarts the server.
# If the new version doesn't answer /health, the old one is put back.
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"
cd "$HOME/gn-data" || exit 1
mkdir -p state
exec >> state/update.log 2>&1
URL="https://raw.githubusercontent.com/SCHSwork/math/main/server"

stamp() { date "+%F %T"; }

# Keep the VM's clock right (VirtualBox clocks drift, and a wrong clock makes
# Firebase sign-ins look like they're from the future). Once is enough.
if [ ! -f state/ntp-on ]; then
    sudo -n timedatectl set-ntp true 2>/dev/null
    sudo -n systemctl restart systemd-timesyncd 2>/dev/null || sudo -n systemctl restart chrony 2>/dev/null
    touch state/ntp-on
    echo "$(stamp) turned on automatic clock sync"
fi

# The updater updates itself too (takes effect next run)
curl -fsSL "$URL/update.sh?$(date +%s)" -o update.new.sh 2>/dev/null && bash -n update.new.sh && ! cmp -s update.new.sh update.sh && { chmod +x update.new.sh; mv update.new.sh update.sh; echo "$(stamp) updater updated"; }
rm -f update.new.sh

curl -fsSL "$URL/deps.txt?$(date +%s)" -o deps.new.txt 2>/dev/null
if [ -s deps.new.txt ] && ! cmp -s deps.new.txt deps.txt; then
    echo "$(stamp) installing $(tr '\n' ' ' < deps.new.txt)"
    npm install $(cat deps.new.txt) --no-fund --no-audit --loglevel=error && mv deps.new.txt deps.txt
fi
rm -f deps.new.txt

curl -fsSL "$URL/server.js?$(date +%s)" -o server.new.js || { echo "$(stamp) couldn't reach GitHub"; exit 0; }
if cmp -s server.new.js server.js; then rm -f server.new.js; exit 0; fi
if ! node --check server.new.js; then echo "$(stamp) new version has a syntax error, not installed"; rm -f server.new.js; exit 1; fi
cp server.js server.js.bak
mv server.new.js server.js
pm2 restart gn-data --update-env >/dev/null
for i in 1 2 3 4 5 6; do sleep 5; curl -fs localhost:8080/health >/dev/null && { echo "$(stamp) updated to $(sha1sum server.js | cut -c1-7)"; pm2 save >/dev/null; exit 0; }; done
echo "$(stamp) new version didn't start, rolling back"
cp server.js.bak server.js
pm2 restart gn-data --update-env >/dev/null
