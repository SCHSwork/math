#!/bin/bash
# Minecraft hosting on the GN 2.0 server VM, installed once by update.sh:
#   - Java 21 (for Minecraft 1.21+)
#   - AMP by CubeCoders (the owner's licence), web panel on port 8081 (8080 is the GN 2.0 Server)
#   - playit.gg agent: lets Java (TCP 25565) and Bedrock (UDP 19132, Geyser) players in
#     without port forwarding and without showing the home IP
# The AMP login and the playit claim link are written to state/minecraft.json,
# which only the site owner can see (Owner Panel → Minecraft Server, /api/owner/minecraft).
# Everything is logged to state/minecraft.log. Safe to run again.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$HOME/gn-data" || exit 1
mkdir -p state
LOG=state/minecraft.log
exec >> "$LOG" 2>&1
stamp() { date "+%F %T"; }
say() { echo "$(stamp) $*"; }
STATUS=state/minecraft.json
set_status() { node -e '
const fs=require("fs"),f=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
Object.assign(s,JSON.parse(process.argv[2]),{at:Date.now()});fs.writeFileSync(f,JSON.stringify(s,null,1))' "$STATUS" "$1"; }
export DEBIAN_FRONTEND=noninteractive
APT="sudo -n apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"

say "== Minecraft setup starting"
set_status '{"step":"starting"}'

# ── Java 21 ─────────────────────────────────────────────────────────────────
if ! java -version 2>&1 | grep -q '"21'; then
    say "installing Java 21"
    $APT update >/dev/null 2>&1
    $APT install openjdk-21-jre-headless >/dev/null 2>&1 && say "Java 21 installed" || say "Java 21 install FAILED"
fi

# ── AMP (CubeCoders) ────────────────────────────────────────────────────────
if ! command -v ampinstmgr >/dev/null; then
    say "installing AMP's instance manager"
    $APT install gnupg ca-certificates curl >/dev/null 2>&1
    curl -fsSL https://cdn-repo.c7rs.com/archive.key | gpg --dearmor | sudo -n tee /usr/share/keyrings/cubecoders-archive-keyring.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cubecoders-archive-keyring.gpg] https://cdn-repo.c7rs.com/ debian/" | sudo -n tee /etc/apt/sources.list.d/cubecoders.list >/dev/null
    $APT update >/dev/null 2>&1
    $APT install ampinstmgr >/dev/null 2>&1 && say "ampinstmgr installed" || say "ampinstmgr install FAILED"
fi
if command -v ampinstmgr >/dev/null; then
    id amp >/dev/null 2>&1 || { sudo -n useradd -d /home/amp -m amp -s /bin/bash && say "created the amp user"; }
    if ! sudo -n -u amp -H ampinstmgr -l 2>/dev/null | grep -qi "ADS"; then
        PASS="Gn$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)7!"
        say "creating AMP's main panel (ADS) on port 8081"
        OUT=$(sudo -n -u amp -H ampinstmgr quickstart gnadmin "$PASS" 0.0.0.0 8081 2>&1); RC=$?
        echo "$OUT" | tail -8
        if [ $RC -eq 0 ] && sudo -n -u amp -H ampinstmgr -l 2>/dev/null | grep -qi "ADS"; then
            set_status "{\"amp\":{\"user\":\"gnadmin\",\"pass\":\"$PASS\",\"port\":8081}}"
            say "AMP panel created (login is in the Owner Panel)"
        else say "AMP quickstart FAILED"; fi
    fi
    # Start AMP's instances when the VM boots
    ( sudo -n crontab -u amp -l 2>/dev/null | grep -q "ampinstmgr -b" ) || \
        { ( sudo -n crontab -u amp -l 2>/dev/null; echo "@reboot /opt/cubecoders/amp/ampinstmgr -b" ) | sudo -n crontab -u amp - && say "AMP set to start on boot"; }
    sudo -n systemctl enable ampinstmgr >/dev/null 2>&1
    sudo -n -u amp -H ampinstmgr -b >/dev/null 2>&1
    curl -s -o /dev/null -w "AMP panel answers on 8081: HTTP %{http_code}\n" localhost:8081 | sed "s/^/$(stamp) /"
fi

# ── playit.gg ───────────────────────────────────────────────────────────────
if ! command -v playit >/dev/null; then
    say "installing playit"
    curl -fsSL https://playit-cloud.github.io/ppa/key.gpg | gpg --dearmor | sudo -n tee /etc/apt/trusted.gpg.d/playit.gpg >/dev/null
    echo "deb [signed-by=/etc/apt/trusted.gpg.d/playit.gpg] https://playit-cloud.github.io/ppa/data ./" | sudo -n tee /etc/apt/sources.list.d/playit-cloud.list >/dev/null
    $APT update >/dev/null 2>&1
    $APT install playit >/dev/null 2>&1 && say "playit installed" || say "playit install FAILED"
fi
if command -v playit >/dev/null; then
    sudo -n systemctl enable --now playit >/dev/null 2>&1
    sleep 15
    CLAIM=$(sudo -n journalctl -u playit --no-pager -q -n 300 2>/dev/null | grep -o 'https://playit\.gg/claim/[A-Za-z0-9]*' | tail -1)
    if [ -n "$CLAIM" ]; then set_status "{\"playitClaim\":\"$CLAIM\"}"; say "playit claim link found (shown in the Owner Panel)"
    else say "no playit claim link in its log (already claimed, or still starting)"; fi
    set_status "{\"playitRunning\":$(systemctl is-active --quiet playit && echo true || echo false)}"
fi

set_status "{\"step\":\"done\",\"java\":$(java -version 2>&1 | grep -q '"21' && echo true || echo false),\"amp\":$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(JSON.stringify(s.amp||null))}catch{process.stdout.write("null")}' "$PWD/$STATUS")}"
say "== Minecraft setup finished"
