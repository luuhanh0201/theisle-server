#!/usr/bin/env bash
# backup-players.sh, copies of the player data, every hour (owner, 2026-10-09:
# until then nothing kept a second copy of it: a broken disk or a wrong command
# and every dino, garage slot, amber and bag was gone).
#
# On the VPS, as `isle` (deploy.sh puts this file in /home/isle/bin):
#   backup-players.sh run       one copy now (what cron runs at :17 every hour)
#   backup-players.sh cron      add the hourly line to isle's crontab (once)
#   backup-players.sh list      the copies there are
# On the owner's machine (DEPLOY_HOST in .env):
#   scripts/backup-players.sh pull      fetch the daily copies to ~/theisle-backups
#   scripts/backup-players.sh timer     pull once a day with a systemd user timer
#
# What a copy holds (one .tar.gz, paths from /home/isle): the game's PlayerData
# and Config, every mod's Saved/ (garage, prison, AI zones, events…) less
# StatsLogger's old rotated snapshots and live.json, and the bridge's data/
# (amber, bag, shop, quests, SVip…). Never its .env. Only READ: nothing under
# Saved/ is ever written, moved or deleted (AGENTS.md).
#
# Kept: the last 48 hourly copies, and the first copy of each day for 30 days
# (a hard link, no extra space). Log: backups/players/backup.log.
#
# Restoring is by hand, the owner's call, nobody online, the game stopped:
# unpack into a scratch folder (tar -xzf <copy> -C /tmp/restore), look, then
# copy back only what is needed (one player's file, one data/*.json), never
# a whole folder over the live one. Also in docs/deploy.md (local).

set -euo pipefail

HOME_ISLE="${ISLE_HOME:-/home/isle}"
OUT="${BACKUP_DIR:-$HOME_ISLE/backups/players}"
KEEP_HOURLY=48
KEEP_DAILY_DAYS=30
MODS=server/TheIsle/Binaries/Win64/Mods

PLAYERS=server/TheIsle/Saved/PlayerData

# The game's player database (TheIslePersistence.db, SQLite with a -wal,
# encrypted: it cannot be opened to check it) may be written while it is read:
# the .db and its -wal a moment apart would disagree. Copied first, alone, into
# a scratch folder; the same sizes and times before and after the copy = the
# game wrote nothing meanwhile. -shm is rebuilt by SQLite from the -wal, not
# copied. Never written to: cp reads the live files only.
stage_players() {
    local stage="$1" try before after
    for try in 1 2 3 4 5; do
        rm -rf "$stage"; mkdir -p "$stage/$PLAYERS"
        before="$(find "$PLAYERS" -maxdepth 1 -type f ! -name '*-shm' -printf '%f %s %T@\n' | sort)"
        find "$PLAYERS" -maxdepth 1 -type f ! -name '*-shm' -exec cp -p {} "$stage/$PLAYERS/" \;
        after="$(find "$PLAYERS" -maxdepth 1 -type f ! -name '*-shm' -printf '%f %s %T@\n' | sort)"
        [[ "$before" == "$after" ]] && return 0
        echo "$(date -Is) try $try: the game wrote PlayerData during the copy, again" >&2
        sleep 3
    done
    return 1
}

pack() {
    local out="$1" stage="$2" paths=(server/TheIsle/Saved/Config bridge/data) d rc=0
    for d in "$MODS"/*/Saved; do [[ -d "$d" ]] && paths+=("$d"); done
    # Low priority: the game keeps the CPU and the disk. Exit 1 = a file changed
    # while it was read (a mod or the bridge saving JSON): the next hour has it.
    nice -n 19 ionice -c3 tar -czf "$out" \
        --exclude="$MODS/StatsLogger/Saved/snapshots.ndjson.*" \
        --exclude="$MODS/StatsLogger/Saved/live.json" \
        --exclude='*.part' --exclude='*.tmp' \
        --warning=no-file-changed --warning=no-file-shrank \
        "${paths[@]}" -C "$stage" "$PLAYERS" || rc=$?
    (( rc <= 1 )) && gzip -t "$out"
}

run() {
    mkdir -p "$OUT/hourly" "$OUT/daily"
    local stamp tmp file stage="$OUT/.stage" steady=1
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    file="$OUT/hourly/players-$stamp.tar.gz"
    tmp="$file.part"
    cd "$HOME_ISLE"
    stage_players "$stage" || steady=0
    if ! pack "$tmp" "$stage"; then
        rm -rf "$tmp" "$stage"; echo "$(date -Is) FAILED: tar" >&2; exit 1
    fi
    rm -rf "$stage"
    mv "$tmp" "$file"
    # The day's first steady copy is also the daily one.
    local day="$OUT/daily/players-${stamp:0:8}.tar.gz"
    (( steady )) && [[ ! -e "$day" ]] && ln "$file" "$day"
    # Oldest first: past the newest KEEP_HOURLY, and daily copies older than KEEP_DAILY_DAYS.
    ls -1 "$OUT"/hourly/players-*.tar.gz | head -n -"$KEEP_HOURLY" | xargs -r rm -f
    find "$OUT/daily" -name 'players-*.tar.gz' -mtime +"$KEEP_DAILY_DAYS" -delete
    if (( steady )); then
        echo "$(date -Is) ok $(du -h "$file" | cut -f1) $file"
    else
        echo "$(date -Is) WARN kept, but the game kept writing PlayerData during the copy: $file" >&2
    fi
}

cron() {
    local line="17 * * * * $HOME_ISLE/bin/backup-players.sh run >> $OUT/backup.log 2>&1"
    mkdir -p "$OUT"
    if crontab -l 2>/dev/null | grep -qF 'backup-players.sh run'; then
        echo "already in crontab"
    else
        { crontab -l 2>/dev/null || true; echo "$line"; } | crontab -
        echo "added: $line"
    fi
}

list() {
    echo "hourly:"; ls -1sh "$OUT"/hourly/ 2>/dev/null | tail -n +2
    echo "daily:";  ls -1sh "$OUT"/daily/ 2>/dev/null | tail -n +2
    du -sh "$OUT" 2>/dev/null
}

# --- on the owner's machine --------------------------------------------------
local_env() {
    local root
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    [[ -f "$root/.env" ]] && set -a && . "$root/.env" && set +a
    : "${DEPLOY_HOST:?DEPLOY_HOST missing (.env)}"
}

pull() {
    local_env
    local dest="${PULL_DIR:-$HOME/theisle-backups}"
    mkdir -p "$dest"
    # The daily copies only; none deleted here (the VPS keeps 30 days, this machine all).
    rsync -a "$DEPLOY_HOST:$OUT/daily/" "$dest/"
    echo "$(date -Is) pulled to $dest: $(ls -1 "$dest" | wc -l) copies, $(du -sh "$dest" | cut -f1)"
}

timer() {
    local self units=~/.config/systemd/user
    self="$(realpath "${BASH_SOURCE[0]}")"
    mkdir -p "$units"
    cat > "$units/theisle-backup-pull.service" <<EOF
[Unit]
Description=Fetch The Isle player data copies from the VPS

[Service]
Type=oneshot
ExecStart=$self pull
EOF
    # Persistent: a day the machine was off is made up when it comes back.
    cat > "$units/theisle-backup-pull.timer" <<EOF
[Unit]
Description=Fetch The Isle player data copies once a day

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=15min

[Install]
WantedBy=timers.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now theisle-backup-pull.timer
    systemctl --user list-timers theisle-backup-pull.timer --no-pager
}

case "${1:-}" in
    run) run ;;
    cron) cron ;;
    list) list ;;
    pull) pull ;;
    timer) timer ;;
    *) sed -n '2,26p' "$0"; exit 2 ;;
esac
