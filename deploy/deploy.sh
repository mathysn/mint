#!/usr/bin/env bash
# Puts the latest code online: pull, build, restart Mint's containers (migrations run at start).
# Only touches the "mint" Docker project; nothing else on the server.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "No .env here. Run deploy/setup.sh first."; exit 1; }

port="$(grep -E '^APP_PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d '\r')"; port="${port:-3080}"

echo "== Pulling the code"
git pull --ff-only

echo "== Building (a few minutes the first time)"
docker compose build app

echo "== Starting"
docker compose up -d --remove-orphans
docker image prune -f > /dev/null

echo "== Waiting for the game to answer"
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$port/api/health" > /dev/null 2>&1; then
    docker compose ps
    echo "Mint is up. Logs: docker compose logs -f app"
    exit 0
  fi
  sleep 2
done
docker compose ps
echo "Mint didn't answer after 90 s. Last logs:"
docker compose logs --tail 60 app
exit 1
