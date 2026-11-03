#!/usr/bin/env bash
# One-time setup of Mint on a server that already runs other things (Discord bots in screen).
# Additive only, and it asks before each change:
#   - installs Docker if it is missing (running processes are not touched);
#   - writes /opt/mint/.env with fresh secrets;
#   - opens ports 80/443 if the ufw firewall is on (SSH rules stay as they are);
#   - adds the nightly backup in its own file, /etc/cron.d/mint.
# It never reboots, never restarts or stops other services, never changes SSH or other packages.
# Run from the cloned repo: sudo bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$PWD"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ask() { local a; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash deploy/setup.sh"; exit 1; }

say "This server now"
free -h | head -2
df -h / | tail -1
echo "screen sessions: $(screen -ls 2>/dev/null | grep -c 'tached' || true)"
web_ports="$(ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
if [[ -n "$web_ports" ]]; then echo "Ports 80/443 already used:"; ss -ltnpH '( sport = :80 or sport = :443 )'; else echo "Ports 80/443 are free."; fi

say "Docker"
if docker compose version > /dev/null 2>&1; then
  docker --version
else
  echo "Docker isn't installed. The official script (get.docker.com) adds it; nothing running is stopped."
  if ask "Install Docker now?"; then
    curl -fsSL https://get.docker.com | sh
  else
    echo "Docker is required. Stopping here."; exit 1
  fi
fi

say "Settings (.env)"
if [[ -f .env ]]; then
  echo ".env already exists, left as is."
else
  cp .env.production.example .env
  chmod 600 .env
  for key in POSTGRES_PASSWORD CRON_SECRET IP_HASH_SALT; do
    sed -i "s/^$key=.*/$key=$(openssl rand -hex 32)/" .env
  done
  if [[ -n "$web_ports" ]]; then
    sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' .env
    echo "Ports 80/443 are taken: Caddy is off. Point your web server at 127.0.0.1:3080 (deploy/nginx-mint.conf)."
  fi
  echo "Created .env with new secrets. Now fill in the domain and Discord values:  nano $DIR/.env"
fi

say "Firewall"
if command -v ufw > /dev/null && ufw status | grep -q 'Status: active'; then
  if ufw status | grep -qE '^(80|443)(/tcp)? +ALLOW'; then
    echo "80/443 already allowed."
  elif ask "ufw is on. Allow 80/tcp, 443/tcp and 443/udp (web traffic)? SSH rules are not changed."; then
    ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
  fi
else
  echo "ufw isn't active. If the server has a Hetzner Cloud Firewall, allow TCP 80 and 443 there."
fi

say "Nightly backup"
if [[ -f /etc/cron.d/mint ]]; then
  echo "/etc/cron.d/mint already exists."
elif ask "Add the nightly database backup at 02:30 server time (/etc/cron.d/mint)?"; then
  mkdir -p "$DIR/backups" && chmod 700 "$DIR/backups"
  printf '30 2 * * * root bash %s/deploy/backup.sh >> %s/backups/backup.log 2>&1\n' "$DIR" "$DIR" > /etc/cron.d/mint
  chmod 644 /etc/cron.d/mint
  echo "Added."
fi

say "Next"
echo "1. nano $DIR/.env   (MINT_DOMAIN, APP_BASE_URL, Discord, R2)"
echo "2. Point the domain's DNS A record at this server: $(curl -fsS -4 https://ifconfig.me 2>/dev/null || echo '<server IP>')"
echo "3. bash deploy/deploy.sh"
