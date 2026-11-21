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

# ── Plugins for every Paper server in AMP ───────────────────────────────────
#   Geyser + Floodgate: Bedrock players (phones, consoles, Windows) can join
#   CoreProtect: logs every block change so griefing can be rolled back
# Only added if missing; restart the server in AMP to load them.
for MC in $(sudo -n find /home/amp/.ampdata/instances -mindepth 2 -maxdepth 2 -type d -name Minecraft 2>/dev/null); do
    sudo -n test -d "$MC" || continue
    sudo -n test -f "$MC/server.properties" || continue
    sudo -n mkdir -p "$MC/plugins"
    get_plugin() {   # name url
        if sudo -n sh -c "ls '$MC/plugins' | grep -qi '^$1'"; then return; fi
        if curl -fsSL "$2" -o "/tmp/$1.jar" && [ -s "/tmp/$1.jar" ]; then
            sudo -n mv "/tmp/$1.jar" "$MC/plugins/$1.jar" && sudo -n chown amp:amp "$MC/plugins/$1.jar" && say "added $1 to $(basename "$(dirname "$MC")")"
        else say "couldn't download $1"; fi
    }
    get_plugin Geyser-Spigot "https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot"
    get_plugin floodgate-spigot "https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot"
    CP=$(curl -fsSL 'https://api.modrinth.com/v2/project/coreprotect/version?loaders=%5B%22paper%22%5D' 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=JSON.parse(d)[0];process.stdout.write(v.files.find(f=>f.primary)?.url||v.files[0].url)}catch{}})')
    if [ -n "$CP" ]; then get_plugin CoreProtect "$CP"; else say "couldn't find a CoreProtect download"; fi
done

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
    # playit 1.x: the daemon waits for a secret. Make a claim code, show its link in
    # the Owner Panel, and wait (up to 2 hours) in the background for it to be
    # claimed; then save the secret where playitd reads it and restart it.
    if ! sudo -n test -s /etc/playit/playit.toml && ! pgrep -f "playit claim exchange" >/dev/null; then
        CODE=$(playit claim generate 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -oE '[A-Za-z0-9]{6,}' | tail -1)
        if [ -n "$CODE" ]; then
            URL=$(playit claim url "$CODE" 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -oE 'https://[^ ]+' | tail -1)
            if [ -n "$URL" ]; then
                set_status "{\"playitClaim\":\"$URL\"}"; say "playit claim link made (shown in the Owner Panel); waiting up to 2 hours for it to be claimed"
                setsid nohup bash -c '
                    cd "$HOME/gn-data"
                    OUT=$(timeout 7200 playit claim exchange "'"$CODE"'" 2>&1)
                    SECRET=$(echo "$OUT" | grep -oE "[0-9a-f]{64}" | tail -1)
                    if [ -n "$SECRET" ]; then
                        printf "secret_key = \"%s\"\n" "$SECRET" | sudo -n tee /etc/playit/playit.toml >/dev/null
                        sudo -n chown playit:playit /etc/playit/playit.toml; sudo -n chmod 640 /etc/playit/playit.toml
                        sudo -n systemctl restart playit
                        echo "$(date "+%F %T") playit claimed and connected" >> state/minecraft.log
                        node -e "const fs=require(\"fs\"),f=\"state/minecraft.json\";let s={};try{s=JSON.parse(fs.readFileSync(f,\"utf8\"))}catch{};delete s.playitClaim;s.playitClaimed=true;fs.writeFileSync(f,JSON.stringify(s,null,1))"
                    else
                        echo "$(date "+%F %T") playit claim not finished: $(echo "$OUT" | grep -v -E "[0-9a-f]{64}" | tail -3 | tr "\n" " ")" >> state/minecraft.log
                    fi' >/dev/null 2>&1 < /dev/null &
            else say "couldn't make a playit claim URL"; fi
        else say "couldn't make a playit claim code"; fi
    elif sudo -n test -s /etc/playit/playit.toml; then say "playit is already claimed"; fi
    set_status "{\"playitRunning\":$(systemctl is-active --quiet playit && echo true || echo false)}"
fi

set_status "{\"step\":\"done\",\"java\":$(ls /usr/lib/jvm 2>/dev/null | grep -q -- '-25-' && echo true || echo false),\"amp\":$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(JSON.stringify(s.amp||null))}catch{process.stdout.write("null")}' "$PWD/$STATUS")}"
say "== Minecraft setup finished"
