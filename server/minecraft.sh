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

# ── Java 25 (newest Minecraft versions need it) ──────────────────────────────
JAVA25_NEW=0
if ! ls /usr/lib/jvm 2>/dev/null | grep -q -- '-25-'; then
    say "installing Java 25"
    $APT update >/dev/null 2>&1
    if $APT install openjdk-25-jre-headless >/dev/null 2>&1; then say "Java 25 installed"; JAVA25_NEW=1
    else say "Java 25 install FAILED: $(apt-cache policy openjdk-25-jre-headless 2>/dev/null | grep -m1 Candidate)"; fi
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
    if ! sudo -n runuser -l amp -c "ampinstmgr -l" 2>/dev/null | grep -qi "ADS"; then
        PASS="Gn$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)7!"
        say "creating AMP's main panel (ADS) on port 8081"
        OUT=$(sudo -n runuser -l amp -c "ampinstmgr quickstart gnadmin '$PASS' 0.0.0.0 8081" 2>&1); RC=$?
        echo "$OUT" | grep -v "$PASS" | tail -8
        if [ $RC -eq 0 ] && sudo -n runuser -l amp -c "ampinstmgr -l" 2>/dev/null | grep -qi "ADS"; then
            set_status "{\"amp\":{\"user\":\"gnadmin\",\"pass\":\"$PASS\",\"port\":8081}}"
            say "AMP panel created (login is in the Owner Panel)"
        else say "AMP quickstart FAILED"; fi
    fi
    # The panel exists but its login was never saved (an earlier run was cut off): set a new one
    if sudo -n runuser -l amp -c "ampinstmgr -l" 2>/dev/null | grep -qi "ADS" && ! grep -q '"pass"' "$STATUS" 2>/dev/null; then
        ADS=$(sudo -n runuser -l amp -c "ampinstmgr -l" 2>/dev/null | grep -o 'ADS[0-9A-Za-z_]*' | head -1)
        PASS="Gn$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)7!"
        say "setting a new AMP login on $ADS"
        sudo -n runuser -l amp -c "ampinstmgr stop $ADS" >/dev/null 2>&1
        OUT=$(sudo -n runuser -l amp -c "ampinstmgr resetlogin $ADS gnadmin '$PASS'" 2>&1); RC=$?
        echo "$OUT" | grep -v "$PASS" | tail -5
        sudo -n runuser -l amp -c "ampinstmgr start $ADS" >/dev/null 2>&1
        if [ $RC -eq 0 ]; then set_status "{\"amp\":{\"user\":\"gnadmin\",\"pass\":\"$PASS\",\"port\":8081}}"; say "new AMP login saved (shown in the Owner Panel)"
        else say "resetting the AMP login FAILED"; fi
    fi
    # AMP only looks for Java when it starts: restart it after installing a new one
    if [ "$JAVA25_NEW" = 1 ]; then
        ADS=$(sudo -n runuser -l amp -c "ampinstmgr -l" 2>/dev/null | grep -o 'ADS[0-9A-Za-z_]*' | head -1)
        sudo -n runuser -l amp -c "ampinstmgr restartall" >/dev/null 2>&1 && say "AMP restarted so it sees Java 25"
    fi
    # Start AMP's instances when the VM boots
    ( sudo -n crontab -u amp -l 2>/dev/null | grep -q "ampinstmgr -b" ) || \
        { ( sudo -n crontab -u amp -l 2>/dev/null; echo "@reboot /opt/cubecoders/amp/ampinstmgr -b" ) | sudo -n crontab -u amp - && say "AMP set to start on boot"; }
    sudo -n systemctl enable ampinstmgr >/dev/null 2>&1
    sudo -n runuser -l amp -c "ampinstmgr -b" >/dev/null 2>&1
    curl -s -o /dev/null -w "AMP panel answers on 8081: HTTP %{http_code}\n" localhost:8081 | sed "s/^/$(stamp) /"
fi

# ── Plugins ─────────────────────────────────────────────────────────────────
# Plugins are installed from AMP's Store (Modrinth tab) so they show up there and
# AMP can update them. This script no longer downloads any plugins.

# ── playit.gg ───────────────────────────────────────────────────────────────
if ! command -v playit >/dev/null; then
    say "installing playit"
    curl -fsSL https://playit-cloud.github.io/ppa/key.gpg | gpg --dearmor | sudo -n tee /etc/apt/trusted.gpg.d/playit.gpg >/dev/null
    echo "deb [signed-by=/etc/apt/trusted.gpg.d/playit.gpg] https://playit-cloud.github.io/ppa/data ./" | sudo -n tee /etc/apt/sources.list.d/playit-cloud.list >/dev/null
    $APT update >/dev/null 2>&1
    $APT install playit >/dev/null 2>&1 && say "playit installed" || say "playit install FAILED"
fi
if command -v playit >/dev/null; then
    # Keep playit current (Bedrock tunnels for Geyser need 1.2+)
    $APT update >/dev/null 2>&1
    BEFORE=$(playit --version 2>/dev/null | head -1)
    $APT install --only-upgrade playit >/dev/null 2>&1
    AFTER=$(playit --version 2>/dev/null | head -1)
    [ "$BEFORE" != "$AFTER" ] && { say "playit updated: $BEFORE -> $AFTER"; sudo -n systemctl restart playit; }
    say "playit version: $AFTER"
    # Bedrock's new NetherNet connections need playit's Geyser tunnel, which needs
    # agent 1.2+. The apt source may lag, so look for a newer .deb on playit's site
    # and GitHub, and install it if it's newer.
    CUR=$(echo "$AFTER" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if dpkg --compare-versions "${CUR:-0}" lt 1.2.0; then
        echo "--- looking for playit 1.2+:"
        apt-cache policy playit 2>/dev/null | sed -n '1,6p'
        PAGES=$(for u in https://playit.gg/download/linux https://playit.gg/download https://api.github.com/repos/playit-cloud/playit-agent/releases; do curl -fsSL -m 30 "$u" 2>/dev/null; echo; done)
        for js in $(echo "$PAGES" | grep -oE '/_next/static/[^"]+\.js|/assets/[^"]+\.js' | sort -u | head -40); do
            PAGES="$PAGES $(curl -fsSL -m 20 "https://playit.gg$js" 2>/dev/null)"
        done
        echo "$PAGES" | grep -oE 'https?://[^"'"'"' )]+' | grep -iE 'playit[^ ]*(amd64|x86_64)' | sort -u | head -15
        DEB=$(echo "$PAGES" | grep -oE 'https?://[^"'"'"' )]+\.deb' | grep -iE 'amd64|x86_64' | sort -uV | tail -1)
        if [ -n "$DEB" ]; then
            say "trying $DEB"
            if curl -fsSL -m 120 "$DEB" -o /tmp/playit-new.deb && [ -s /tmp/playit-new.deb ]; then
                NEWV=$(dpkg-deb -f /tmp/playit-new.deb Version 2>/dev/null)
                if dpkg --compare-versions "${NEWV:-0}" gt "${CUR:-0}"; then
                    sudo -n cp /etc/playit/playit.toml /tmp/playit-secret-backup.toml 2>/dev/null
                    $APT install /tmp/playit-new.deb >/dev/null 2>&1 && say "playit $NEWV installed from $DEB" || say "installing playit $NEWV FAILED"
                    sudo -n test -s /etc/playit/playit.toml || { sudo -n cp /tmp/playit-secret-backup.toml /etc/playit/playit.toml && sudo -n chown playit:playit /etc/playit/playit.toml; }
                    sudo -n systemctl restart playit
                    say "playit version now: $(playit --version 2>/dev/null | head -1)"
                else say "that .deb is version ${NEWV:-unknown}, not newer"; fi
            else say "couldn't download it"; fi
        else say "no newer playit .deb found on playit.gg or GitHub"; fi
        echo "---"
    fi
    sudo -n systemctl enable --now playit >/dev/null 2>&1
    sleep 15
    JLOG=$(sudo -n journalctl -u playit --no-pager -q -o cat -n 300 2>/dev/null)
    echo "--- playit's own log (last lines):"; echo "$JLOG" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tail -15; echo "---"
    CLAIM=$(echo "$JLOG" | grep -o 'https://playit\.gg/[A-Za-z0-9/_-]*claim[A-Za-z0-9/_-]*' | tail -1)
    if [ -n "$CLAIM" ]; then set_status "{\"playitClaim\":\"$CLAIM\"}"; say "playit claim link found (shown in the Owner Panel)"
    else say "no playit claim link in its log (already claimed, or still starting)"; fi
    if [ -z "$CLAIM" ]; then
        echo "--- playit details:"
        playit --version 2>&1 | head -2
        playit --help 2>&1 | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | head -30
        playit claim --help 2>&1 | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | head -15
        systemctl cat playit 2>/dev/null | grep -i '^ExecStart'
        sudo -n ls -la /etc/playit /var/log/playit /var/lib/playit 2>&1 | head -20
        LOGF=$(sudo -n find /var/log/playit /var/lib/playit /etc/playit -type f -name '*.log*' 2>/dev/null | head -1)
        [ -n "$LOGF" ] && { echo "tail of $LOGF:"; sudo -n tail -20 "$LOGF" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g'; }
        CLAIM=$(sudo -n grep -rhoa 'https://playit\.gg/[A-Za-z0-9/_-]*claim[A-Za-z0-9/_-]*' /var/log/playit /var/lib/playit /etc/playit 2>/dev/null | tail -1)
        [ -n "$CLAIM" ] && { set_status "{\"playitClaim\":\"$CLAIM\"}"; say "playit claim link found in its files"; }
        echo "---"
    fi
    # playit 1.x: playitd only takes its secret from "playit setup" (over its IPC
    # socket), not from the file. If it's still waiting for one, run "playit setup"
    # in the background: it makes a claim link (shown in the Owner Panel), waits
    # for it to be claimed, and hands the secret to playitd itself.
    sleep 3
    PLOG=$(sudo -n tail -3 /var/log/playit/playit.log 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g')
    echo "--- playitd log:"; echo "$PLOG"; echo "---"
    if echo "$PLOG" | tail -1 | grep -q "Waiting for frontend secret provisioning" && ! pgrep -f "playit setup" >/dev/null; then
        playit setup --help 2>&1 | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | head -12
        sudo -n rm -f /tmp/playit-setup.out
        setsid nohup sudo -n timeout 7200 script -qfc "playit setup" /tmp/playit-setup.out >/dev/null 2>&1 < /dev/null &
        for i in $(seq 1 20); do
            sleep 2
            URL=$(sudo -n cat /tmp/playit-setup.out 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -oE 'https://playit\.gg/[^ ]+' | tail -1)
            [ -n "$URL" ] && break
        done
        echo "--- playit setup says:"; sudo -n cat /tmp/playit-setup.out 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr '\r' '\n' | grep -v '^\s*$' | tail -8; echo "---"
        if [ -n "$URL" ]; then set_status "{\"playitClaim\":\"$URL\",\"playitClaimed\":false}"; say "new playit claim link from 'playit setup' (shown in the Owner Panel)"
        else say "'playit setup' didn't give a claim link"; fi
    elif echo "$PLOG" | grep -qi "Waiting for frontend secret"; then :
    else say "playitd has its secret"; set_status '{"playitClaimed":true}'; fi
    set_status "{\"playitRunning\":$(systemctl is-active --quiet playit && echo true || echo false)}"
fi

# ── GN Proxy (Velocity): listen on the port AMP gave it (25566), not GN Craft's ─
for VT in $(sudo -n find /home/amp/.ampdata/instances -maxdepth 4 -path '*GNProxy*' -name velocity.toml 2>/dev/null); do
    if sudo -n grep -q '^bind = "0.0.0.0:25565"' "$VT"; then
        sudo -n sed -i 's/^bind = "0.0.0.0:25565"/bind = "0.0.0.0:25566"/' "$VT" && say "GN Proxy now listens on 25566"
    fi
done

# ── GN Proxy (Velocity) in front of GN Craft ───────────────────────────────
# Everyone joins through GN Proxy (port 25566): Java, Bedrock (Geyser moves to
# the proxy) and Eaglercraft (EaglerXServer, WebSocket on the same port, reached
# through the Cloudflare tunnel). GN Craft only accepts players sent by the proxy
# (Velocity modern forwarding). Files are changed here; they take effect when
# GN Craft and GN Proxy are restarted in AMP. Safe to run again.
PX=$(sudo -n find /home/amp/.ampdata/instances -maxdepth 4 -path '*GNProxy*' -name velocity.toml 2>/dev/null | head -1)
MC=$(sudo -n find /home/amp/.ampdata/instances -maxdepth 3 -path '*GNCraft*' -name server.properties 2>/dev/null | head -1)
if [ -n "$PX" ] && [ -n "$MC" ]; then
    PD=$(dirname "$PX"); MD=$(dirname "$MC")
    SECRET=$(sudo -n cat "$PD/forwarding.secret" 2>/dev/null | tr -d '\r\n')
    if [ -z "$SECRET" ]; then
        SECRET=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
        echo -n "$SECRET" | sudo -n tee "$PD/forwarding.secret" >/dev/null
    fi
    # velocity.toml: modern forwarding, one server (GN Craft), show GN Craft's MOTD/players
    sudo -n cat "$PX" > /tmp/velocity.toml
    python3 - /tmp/velocity.toml <<'EOF'
import re, sys
f = sys.argv[1]; t = open(f).read()
t = re.sub(r'(?m)^player-info-forwarding-mode = .*$', 'player-info-forwarding-mode = "modern"', t)
t = re.sub(r'(?m)^ping-passthrough = .*$', 'ping-passthrough = "ALL"', t)
t = re.sub(r'(?m)^forwarding-secret-file = .*$', 'forwarding-secret-file = "forwarding.secret"', t)
t = re.sub(r'(?ms)^\[servers\].*?(?=^\[advanced\])',
    '[servers]\ngncraft = "127.0.0.1:25565"\ntry = [\n\t"gncraft"\n]\n\n[forced-hosts]\n\n', t)
open(f, "w").write(t)
EOF
    if ! sudo -n cmp -s /tmp/velocity.toml "$PX"; then
        sudo -n cp "$PX" "$PX.before-gncraft" 2>/dev/null
        sudo -n cp /tmp/velocity.toml "$PX" && say "GN Proxy: velocity.toml now sends players to GN Craft"
    fi
    rm -f /tmp/velocity.toml
    # Plugins on the proxy
    sudo -n mkdir -p "$PD/plugins"
    pget() {   # name url
        if sudo -n sh -c "ls '$PD/plugins' | grep -qi '^$1.*\\.jar$'"; then return; fi
        if curl -fsSL "$2" -o "/tmp/$1.jar" && [ -s "/tmp/$1.jar" ]; then
            sudo -n mv "/tmp/$1.jar" "$PD/plugins/$1.jar" && say "GN Proxy: added $1"
        else rm -f "/tmp/$1.jar"; say "GN Proxy: couldn't download $1"; fi
    }
    pmod() {   # name slug: newest Velocity build on Modrinth
        local U
        U=$(curl -fsSL "https://api.modrinth.com/v2/project/$2/version?loaders=%5B%22velocity%22%5D" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=JSON.parse(d)[0];const f=v.files.find(f=>f.primary)||v.files[0];process.stdout.write(f.url)}catch{}})')
        if [ -n "$U" ]; then pget "$1" "$U"; else say "GN Proxy: couldn't find $1"; fi
    }
    pget Geyser-Velocity "https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/velocity"
    pget floodgate-velocity "https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/velocity"
    # ViaVersion lives on the proxy: Velocity 4 only speaks to 1.13+ clients on
    # its own, so browser (1.8) players need ViaVersion + ViaBackwards + ViaRewind
    # here. It must NOT also be on GN Craft: Grim (anti-cheat) only kicks
    # proxied players when ViaVersion is on the backend too.
    for J in $(sudo -n sh -c "ls '$PD/plugins/disabled' 2>/dev/null | grep -iE '^via(version|backwards|rewind).*\.jar$'"); do
        sudo -n mv "$PD/plugins/disabled/$J" "$PD/plugins/$J" && say "GN Proxy: ViaVersion back on the proxy ($J)"
    done
    pmod ViaVersion viaversion
    pmod ViaBackwards viabackwards
    pmod ViaRewind viarewind
    pmod EaglerXServer eaglercraftxserver
    # Bedrock moves to the proxy: same Geyser settings (incl. playit NetherNet) and floodgate key
    G="$MD/plugins/Geyser-Spigot/config.yml"
    if sudo -n test -f "$G" && ! sudo -n test -f "$PD/plugins/geyser/config.yml"; then
        sudo -n mkdir -p "$PD/plugins/geyser"
        sudo -n cp "$G" "$PD/plugins/geyser/config.yml" && say "GN Proxy: copied GN Craft's Geyser settings (Bedrock/playit)"
    fi
    if sudo -n test -f "$MD/plugins/floodgate/key.pem" && ! sudo -n test -f "$PD/plugins/floodgate/key.pem"; then
        sudo -n mkdir -p "$PD/plugins/floodgate"
        sudo -n cp "$MD/plugins/floodgate/key.pem" "$PD/plugins/floodgate/key.pem" && say "GN Proxy: copied floodgate key"
    fi
    sudo -n mkdir -p "$MD/plugins/moved-to-proxy"
    for J in $(sudo -n sh -c "ls '$MD/plugins' | grep -i '^geyser.*\\.jar$'"); do
        sudo -n mv "$MD/plugins/$J" "$MD/plugins/moved-to-proxy/$J" && say "GN Craft: Geyser moved to GN Proxy ($J)"
    done
    # No ViaVersion on GN Craft (it's on the proxy; see above)
    for J in $(sudo -n sh -c "ls '$MD/plugins' | grep -iE '^via(version|backwards|rewind).*\.jar$'"); do
        sudo -n mv "$MD/plugins/$J" "$MD/plugins/moved-to-proxy/$J" && say "GN Craft: ViaVersion moved to GN Proxy ($J)"
    done
    # GN Craft: only accept players from the proxy
    sudo -n sed -i 's/^online-mode=true/online-mode=false/' "$MC"
    PG="$MD/config/paper-global.yml"
    if sudo -n test -f "$PG"; then
        sudo -n cat "$PG" > /tmp/paper-global.yml
        SECRET="$SECRET" node -e '
const fs=require("fs"),Y=require("yaml"),f="/tmp/paper-global.yml";
const d=Y.parseDocument(fs.readFileSync(f,"utf8"));
d.setIn(["proxies","velocity","enabled"],true);
d.setIn(["proxies","velocity","online-mode"],true);
d.setIn(["proxies","velocity","secret"],process.env.SECRET);
fs.writeFileSync(f,d.toString());'
        if ! sudo -n cmp -s /tmp/paper-global.yml "$PG"; then
            sudo -n cp /tmp/paper-global.yml "$PG" && say "GN Craft: now only accepts players from GN Proxy"
        fi
        rm -f /tmp/paper-global.yml
    fi
    sudo -n chown -R amp:amp "$PD" "$MD/plugins" "$MD/config" "$MC"
    say "GN Proxy setup done: restart GN Craft, then GN Proxy, in AMP"
fi

# EaglerXServer joins the Velocity listener whose address matches inject_address;
# its default is 25565, but GN Proxy listens on 25566.
LT=$(sudo -n find /home/amp/.ampdata/instances -path '*GNProxy*' -name listeners.toml 2>/dev/null | head -1)
if [ -n "$LT" ] && sudo -n grep -q 'inject_address = "0.0.0.0:25565"' "$LT"; then
    sudo -n sed -i 's/inject_address = "0.0.0.0:25565"/inject_address = "0.0.0.0:25566"/' "$LT" && sudo -n chown amp:amp "$LT" \
        && say "GN Proxy: Eaglercraft now on port 25566 (restart GN Proxy in AMP)"
fi

# What browser (Eaglercraft) players see in their server list: GN Craft's name,
# description and icon instead of "An EaglercraftX server", and 20 player slots.
LT=$(sudo -n find /home/amp/.ampdata/instances -path '*GNProxy*' -name listeners.toml 2>/dev/null | head -1)
if [ -n "$LT" ] && [ -n "$MD" ] && [ -n "$PD" ]; then
    sudo -n sed -i 's/^\(\s*\)server_motd = .*/\1server_motd = ["\&a\&lGN Craft", "\&7Java, Bedrock \& browser - survival"]/' "$LT"
    if sudo -n test -f "$MD/server-icon.png"; then
        sudo -n cp "$MD/server-icon.png" "$PD/server-icon.png"
        sudo -n mkdir -p "$PD/plugins/eaglerxserver" && sudo -n cp "$MD/server-icon.png" "$PD/plugins/eaglerxserver/server-icon.png"
    fi
    sudo -n sed -i 's/^show-max-players = .*/show-max-players = 20/' "$PX"
    sudo -n chown -R amp:amp "$PD"
    say "GN Proxy: browser players see GN Craft's name and icon (restart GN Proxy in AMP)"
fi

# ── GNCraftLogin: browser players sign in with their GN 2.0 account ─────────
# A small plugin for GN Proxy, built here from the source below (needs a JDK).
# Rebuilt when the source changes. Restart GN Proxy in AMP to load it.
if [ -n "$PD" ] && sudo -n test -f "$PD/minecraft_server.jar" && sudo -n test -f "$PD/plugins/EaglerXServer.jar"; then
    command -v javac >/dev/null || { say "installing a Java compiler (for GN Proxy's sign-in plugin)"; $APT install openjdk-25-jdk-headless >/dev/null 2>&1 || $APT install openjdk-21-jdk-headless >/dev/null 2>&1; }
    B=/tmp/gncraftlogin; rm -rf "$B"; mkdir -p "$B/src/gn/craft" "$B/out"
    cat > "$B/src/gn/craft/GNCraftLogin.java" <<'JAVAEOF'
package gn.craft;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.PreLoginEvent;
import net.lax1dude.eaglercraft.backend.server.api.velocity.event.EaglercraftLoginEvent;
import org.slf4j.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// GN Craft sign-in for browser (Eaglercraft) players. The GN Craft page puts a
// pass from the GN 2.0 Server in the address (?t=...). This checks it with the
// GN 2.0 Server on this machine and lets the player in under their GN 2.0
// username, skipping the Mojang check only for them. Everyone else (Java) is
// still checked by Mojang as usual.
public class GNCraftLogin {
    private static final Pattern PASS = Pattern.compile("[?&]t=([A-Za-z0-9_-]{10,64})");
    private static final Pattern OK = Pattern.compile("\"ok\":true");
    private static final Pattern NAME = Pattern.compile("\"name\":\"([A-Za-z0-9_]{3,16})\"");
    private static final Pattern ID = Pattern.compile("\"uuid\":\"([0-9a-f-]{36})\"");
    private final Logger log;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final Map<String, Long> browserNames = new ConcurrentHashMap<>();

    @Inject
    public GNCraftLogin(Logger log) { this.log = log; }

    private static String key() {
        try { return Files.readString(Path.of("plugins", "gncraftlogin", "key.txt")).trim(); } catch (Exception e) { return ""; }
    }

    @Subscribe
    public void onBrowserLogin(EaglercraftLoginEvent e) {
        String path = e.getLoginConnection().getWebSocketPath();
        Matcher m = PASS.matcher(path == null ? "" : path);
        if (!m.find()) { e.setKickMessage("Open GN Craft on GN 2.0 while signed in to play."); return; }
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080/api/mc/redeem?t=" + m.group(1) + "&k=" + key()))
                .timeout(Duration.ofSeconds(5)).GET().build();
            String body = http.send(req, HttpResponse.BodyHandlers.ofString()).body();
            Matcher n = NAME.matcher(body), u = ID.matcher(body);
            if (!OK.matcher(body).find() || !n.find() || !u.find()) {
                e.setKickMessage("Your GN Craft pass ran out. Close this tab and open GN Craft on GN 2.0 again.");
                return;
            }
            String name = n.group(1);
            e.setProfileUsername(name);
            e.setProfileUUID(UUID.fromString(u.group(1)));
            browserNames.put(name.toLowerCase(Locale.ROOT), System.currentTimeMillis());
            log.info("GN Craft browser sign-in: " + name);
        } catch (Exception ex) {
            log.warn("GN Craft couldn't check a browser sign-in: " + ex);
            e.setKickMessage("GN Craft couldn't check your sign-in. Try again in a minute.");
        }
    }

    // Right after a browser sign-in, its login skips Mojang (browser players
    // have no Mojang account). Only for that name, only for a few seconds.
    @Subscribe
    public void onPreLogin(PreLoginEvent e) {
        Long at = browserNames.remove(e.getUsername().toLowerCase(Locale.ROOT));
        if (at != null && System.currentTimeMillis() - at < 15000) {
            e.setResult(PreLoginEvent.PreLoginComponentResult.forceOfflineMode());
        }
    }
}
JAVAEOF
    printf '%s' '{"id":"gncraftlogin","name":"GNCraftLogin","version":"1.0","description":"GN 2.0 sign-in for browser players","authors":["GN 2.0"],"main":"gn.craft.GNCraftLogin","dependencies":[{"id":"eaglerxserver","optional":false}]}' > "$B/out/velocity-plugin.json"
    SRCHASH=$(cat "$B/src/gn/craft/GNCraftLogin.java" "$B/out/velocity-plugin.json" | sha1sum | cut -c1-12)
    if [ "$SRCHASH" != "$(cat state/gncraftlogin-built 2>/dev/null)" ] || ! sudo -n test -f "$PD/plugins/GNCraftLogin.jar"; then
        sudo -n cat "$PD/minecraft_server.jar" > "$B/velocity.jar"; sudo -n cat "$PD/plugins/EaglerXServer.jar" > "$B/eagler.jar"
        if javac --release 21 -nowarn -cp "$B/velocity.jar:$B/eagler.jar" -d "$B/out" "$B/src/gn/craft/GNCraftLogin.java" > "$B/javac.log" 2>&1 \
           && (cd "$B/out" && jar cf "$B/GNCraftLogin.jar" .); then
            sudo -n cp "$B/GNCraftLogin.jar" "$PD/plugins/GNCraftLogin.jar" && echo "$SRCHASH" > state/gncraftlogin-built
            say "GN Proxy: built the GN 2.0 sign-in plugin (restart GN Proxy in AMP)"
        else
            say "GN Proxy: couldn't build the sign-in plugin: $(grep -m2 -E 'error' "$B/javac.log" | tr '\n' ' ' | cut -c1-200)"
        fi
    fi
    # The key it uses to ask the GN 2.0 Server about passes
    if [ -s state/mc-login.key ]; then
        sudo -n mkdir -p "$PD/plugins/gncraftlogin"
        sudo -n cp state/mc-login.key "$PD/plugins/gncraftlogin/key.txt"
        sudo -n chmod 600 "$PD/plugins/gncraftlogin/key.txt"
    fi
    sudo -n chown -R amp:amp "$PD/plugins"
    rm -rf "$B"
fi

# ── GNCraftBrowser: browser players skip Grim on GN Craft ───────────────────
# Built here against the Paper API that Paper unpacks into libraries/.
if [ -n "$MD" ]; then
    PAPI=$(sudo -n find "$MD/libraries" -name 'paper-api-*.jar' 2>/dev/null | sort | tail -1)
    if [ -n "$PAPI" ] && command -v javac >/dev/null; then
        B=/tmp/gncraftbrowser; rm -rf "$B"; mkdir -p "$B/src/gn/craft" "$B/out"
        cat > "$B/src/gn/craft/Browser.java" <<'JAVAEOF'
package gn.craft;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.plugin.java.JavaPlugin;

// Browser (Eaglercraft) players come in through GN Proxy with UUIDs starting
// 6e637261 (set by GNCraftLogin from their GN 2.0 account). Their movement is
// translated from an old game version, which Grim reads as cheating and keeps
// teleporting them back, so they skip Grim. Everyone else is still checked.
public class Browser extends JavaPlugin implements Listener {
    @Override
    public void onEnable() { getServer().getPluginManager().registerEvents(this, this); }

    private void exempt(Player p) {
        if (p.getUniqueId().toString().startsWith("6e637261-") && !p.hasPermission("grim.exempt")) p.addAttachment(this, "grim.exempt", true);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onLogin(PlayerLoginEvent e) { exempt(e.getPlayer()); }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onJoin(PlayerJoinEvent e) { exempt(e.getPlayer()); }
}
JAVAEOF
        printf 'name: GNCraftBrowser\nversion: "1.0"\nmain: gn.craft.Browser\napi-version: "1.21"\ndescription: GN 2.0 browser players skip Grim\nsoftdepend: [GrimAC]\n' > "$B/out/plugin.yml"
        SRCHASH=$(cat "$B/src/gn/craft/Browser.java" "$B/out/plugin.yml" | sha1sum | cut -c1-12)
        if [ "$SRCHASH" != "$(cat state/gncraftbrowser-built 2>/dev/null)" ] || ! sudo -n test -f "$MD/plugins/GNCraftBrowser.jar"; then
            # The Paper API needs its own libraries (Adventure etc.) on the classpath too
            CP=$(sudo -n find "$MD/libraries" -name '*.jar' 2>/dev/null | paste -sd: -)
            if sudo -n javac --release 21 -nowarn -cp "$CP" -d "$B/out" "$B/src/gn/craft/Browser.java" > "$B/javac.log" 2>&1 \
               && sudo -n chown -R "$(id -u):$(id -g)" "$B/out" \
               && (cd "$B/out" && jar cf "$B/GNCraftBrowser.jar" .); then
                sudo -n cp "$B/GNCraftBrowser.jar" "$MD/plugins/GNCraftBrowser.jar" && sudo -n chown amp:amp "$MD/plugins/GNCraftBrowser.jar" \
                    && echo "$SRCHASH" > state/gncraftbrowser-built && say "GN Craft: built the browser-player plugin (restart GN Craft in AMP)"
            else
                say "GN Craft: couldn't build the browser-player plugin: $(grep -m2 -E 'error' "$B/javac.log" | tr '\n' ' ' | cut -c1-200)"
            fi
        fi
        rm -rf "$B"
    elif [ -z "$PAPI" ]; then say "GN Craft: no Paper API jar found in libraries/"; fi
fi

# ── What players see: a welcome with the useful commands, and a short /help ──
# Essentials shows motd.txt on join and help.txt for /help (instead of its huge
# list of every command). Run "essentials reload" in GN Craft's console (or
# restart it) after these change.
if [ -n "$MD" ] && sudo -n test -d "$MD/plugins/Essentials"; then
    cat > /tmp/gn-motd.txt <<'TXTEOF'
&a&lWelcome to GN Craft, {PLAYER}!
&7One survival world for Java, Bedrock and browser players.
&e/sethome &7save a spot   &e/home &7go back to it
&e/tpa <name> &7visit a friend   &e/back &7go back after dying
&6Golden shovel&7: right-click two corners to claim land so nobody can grief it
&7Type &e/help &7to see everything you can do.
TXTEOF
    cat > /tmp/gn-help.txt <<'TXTEOF'
&a&l--- GN Craft commands ---
&eHomes &7(up to 3): &f/sethome [name]&7, &f/home [name]&7, &f/delhome <name>
&eVisit friends: &f/tpa <player> &7asks to go to them, &f/tpahere <player> &7asks them to come to you
&eAnswer a request: &f/tpaccept &7or &f/tpdeny
&eGo back: &f/back &7returns to where you died or last teleported
&eChat: &f/msg <player> <text>&7, &f/r <text> &7replies, &f/list &7shows who's on, &f/afk
&eProtect your stuff: &7hold a &6golden shovel &7and right-click two opposite corners to claim land
&eShare a claim: &f/trust <player>&7, &f/untrust <player>&7, &f/abandonclaim &7gives it up
&7You earn more claim blocks the longer you play.
TXTEOF
    for F in motd help; do
        if ! sudo -n cmp -s "/tmp/gn-$F.txt" "$MD/plugins/Essentials/$F.txt"; then
            sudo -n cp "/tmp/gn-$F.txt" "$MD/plugins/Essentials/$F.txt" && sudo -n chown amp:amp "$MD/plugins/Essentials/$F.txt" \
                && say "GN Craft: updated the player $F (run essentials reload)"
        fi
        rm -f "/tmp/gn-$F.txt"
    done
fi

# ── GN Proxy test: does Eaglercraft's WebSocket answer, locally and through Cloudflare?
wstest() {   # label url
    local R
    R=$(curl -s -m 8 -o /dev/null -w '%{http_code}' --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Origin: https://schswork.github.io" "$2")
    say "GN Proxy test: $1 answered HTTP ${R:-nothing} (101 = WebSocket OK) [run 14]"
}
wstest "localhost:25566" "http://127.0.0.1:25566/"
wstest "eagler.learnresearch.org" "https://eagler.learnresearch.org/"
LT=$(sudo -n find /home/amp/.ampdata/instances -path '*GNProxy*' -name listeners.toml 2>/dev/null | head -1)
[ -n "$LT" ] && sudo -n grep -nE '^\s*(forward_ip|forward_secret|dual_stack|inject_address|listener_name)\s*=' "$LT" | head -6 | sed 's/^/GN Proxy test listeners.toml: /' | while read -r l; do say "$l"; done

# ── GN Proxy (Velocity) report: what AMP created, for setting it up ─────────
echo "--- AMP instances:"; sudo -n ls /home/amp/.ampdata/instances 2>/dev/null
for VT in $(sudo -n find /home/amp/.ampdata/instances -maxdepth 4 -name velocity.toml 2>/dev/null); do
    echo "--- $VT"; sudo -n grep -nE '^\s*(bind|online-mode|player-info-forwarding-mode|try|\[servers\]|[a-z0-9_-]+ = "[0-9.]+:[0-9]+")' "$VT"
    echo "files:"; sudo -n ls "$(dirname "$VT")"
done
for K in $(sudo -n find /home/amp/.ampdata/instances -maxdepth 2 -iname '*.kvp' 2>/dev/null | grep -i -E 'proxy|velocity'); do
    echo "--- $K"; sudo -n grep -iE 'port|bind|memory|servertype' "$K" | head -15
done
echo "---"

set_status "{\"step\":\"done\",\"java\":$(ls /usr/lib/jvm 2>/dev/null | grep -q -- '-25-' && echo true || echo false),\"amp\":$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(JSON.stringify(s.amp||null))}catch{process.stdout.write("null")}' "$PWD/$STATUS")}"
say "== Minecraft setup finished"
