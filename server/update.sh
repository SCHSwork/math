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
# Firebase sign-ins look like they're from the future). If the clock isn't
# being synced, install chrony (a time-sync service) and step the clock now.
if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" != "yes" ] && [ ! -f state/ntp-tried-$(date +%F) ]; then
    touch state/ntp-tried-$(date +%F)
    echo "$(stamp) clock not synced, fixing"
    sudo -n timedatectl set-ntp true 2>&1
    if ! command -v chronyc >/dev/null; then sudo -n apt-get install -y chrony >/dev/null 2>&1 && echo "$(stamp) installed chrony"; fi
    sudo -n systemctl enable --now chrony 2>&1
    sleep 3
    sudo -n chronyc -a makestep 2>&1
    echo "$(stamp) clock now $(date -u +%T) UTC, synced: $(timedatectl show -p NTPSynchronized --value 2>/dev/null)"
fi

# Drive health checks (server.js checkDrive) use smartctl
if ! command -v smartctl >/dev/null && [ ! -f state/smart-tried-$(date +%F) ]; then
    touch state/smart-tried-$(date +%F)
    sudo -n apt-get install -y --no-install-recommends smartmontools >/dev/null 2>&1 && echo "$(stamp) installed smartmontools"
fi

# Use all of the disk. When the VM's disk is made bigger (or Ubuntu left part of
# it unused, which its installer does by default), grow the partition, the LVM
# volume and the file system to fill it. Safe while running. Checked hourly.
ROOTSRC=$(findmnt -n -o SOURCE /)
if [[ "$ROOTSRC" == /dev/mapper/* ]] && [ ! -f state/grow-tried-$(date +%F-%H) ]; then
    rm -f state/grow-tried-*; touch state/grow-tried-$(date +%F-%H)
    PV=$(sudo -n pvs --noheadings -o pv_name 2>/dev/null | head -1 | tr -d ' ')
    if [ -n "$PV" ]; then
        DISK=/dev/$(lsblk -no pkname "$PV" | head -1); PART=$(echo "$PV" | grep -o '[0-9]*$')
        command -v growpart >/dev/null || sudo -n apt-get install -y cloud-guest-utils >/dev/null 2>&1
        if [ -n "$PART" ] && sudo -n growpart "$DISK" "$PART" >/dev/null 2>&1; then echo "$(stamp) partition $PV grown to fill $DISK"; fi
        sudo -n pvresize "$PV" >/dev/null 2>&1
        FREE=$(sudo -n vgs --noheadings --units b --nosuffix -o vg_free 2>/dev/null | head -1 | tr -d ' ')
        if [ "${FREE:-0}" -gt 1073741824 ]; then
            sudo -n lvextend -r -l +100%FREE "$ROOTSRC" >/dev/null 2>&1 && echo "$(stamp) disk grown: $(df -h / | awk 'NR==2{print $2" total, "$4" free"}')"
        fi
    fi
fi

# The updater updates itself too (takes effect next run)
curl -fsSL "$URL/update.sh?$(date +%s)" -o update.new.sh 2>/dev/null && bash -n update.new.sh && ! cmp -s update.new.sh update.sh && { chmod +x update.new.sh; mv update.new.sh update.sh; echo "$(stamp) updater updated"; }
rm -f update.new.sh

# Minecraft hosting (AMP + Java + playit, see minecraft.sh): runs once, and again
# whenever minecraft.sh changes. In the background, so the updater isn't held up.
curl -fsSL "$URL/minecraft.sh?$(date +%s)" -o minecraft.new.sh 2>/dev/null
if [ -s minecraft.new.sh ] && bash -n minecraft.new.sh; then
    NEW=$(sha1sum minecraft.new.sh | cut -c1-12)
    if [ "$NEW" != "$(cat state/minecraft-ran 2>/dev/null)" ] && ! pgrep -f "gn-data/minecraft.sh" >/dev/null; then
        mv minecraft.new.sh minecraft.sh; chmod +x minecraft.sh; echo "$NEW" > state/minecraft-ran
        echo "$(stamp) running minecraft.sh"
        setsid nohup timeout 1800 bash "$HOME/gn-data/minecraft.sh" >/dev/null 2>&1 < /dev/null &
    fi
fi
rm -f minecraft.new.sh

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
