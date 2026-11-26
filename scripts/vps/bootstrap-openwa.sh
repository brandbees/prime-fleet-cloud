#!/usr/bin/env bash
# Bootstrap OpenWA on a Prime Fleet shared/micro VPS.
# Idempotent: if healthy + API key present, exits 0 without rebuild.
set -euo pipefail

INSTALL_DIR="${OPENWA_INSTALL_DIR:-/home/admin/openwa-runtime}"
COMPOSE_FILE_NAME="docker-compose.openwa.yml"
PUBLIC_PORT="${OPENWA_PORT:-2785}"
IMAGE="${OPENWA_IMAGE:-ghcr.io/rmyndharis/openwa:latest}"

log() { printf '[bootstrap-openwa] %s\n' "$*"; }
die() { printf '[bootstrap-openwa] ERROR: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

wait_health() {
  local url="http://127.0.0.1:${PUBLIC_PORT}/api/health"
  local i
  for i in $(seq 1 60); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then
      log "health OK ($url)"
      return 0
    fi
    sleep 2
  done
  die "OpenWA health check timed out after ~120s ($url)"
}

read_api_key() {
  # Volume files are owned by the openwa user (mode 600) — read as root in the container.
  local key=""
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'openwa-api'; then
    key="$(docker exec -u 0 openwa-api sh -c 'tr -d "\r\n" </app/data/.api-key' 2>/dev/null || true)"
  fi
  if [[ -z "$key" && -r "${INSTALL_DIR}/.api-key.host" ]]; then
    key="$(tr -d '\r\n' <"${INSTALL_DIR}/.api-key.host" 2>/dev/null || true)"
  fi
  if [[ -z "$key" && -r "${INSTALL_DIR}/data/.api-key" ]]; then
    key="$(tr -d '\r\n' <"${INSTALL_DIR}/data/.api-key" 2>/dev/null || true)"
  fi
  printf '%s' "$key"
}

persist_host_key() {
  local key="$1"
  [[ -n "$key" ]] || return 0
  printf '%s\n' "$key" >"${INSTALL_DIR}/.api-key.host"
  chmod 600 "${INSTALL_DIR}/.api-key.host" || true
}

already_healthy() {
  curl -fsS -m 3 "http://127.0.0.1:${PUBLIC_PORT}/api/health" >/dev/null 2>&1 || return 1
  local key
  key="$(read_api_key || true)"
  [[ -n "${key}" ]]
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

need_cmd docker
need_cmd curl
docker compose version >/dev/null 2>&1 || die "docker compose plugin required"

if already_healthy; then
  KEY="$(read_api_key)"
  persist_host_key "$KEY"
  log "already running — skip install"
  printf 'OPENWA_BASE_URL=http://127.0.0.1:%s\n' "$PUBLIC_PORT"
  printf 'OPENWA_API_KEY=%s\n' "$KEY"
  exit 0
fi

mkdir -p "$INSTALL_DIR/data"
SRC_COMPOSE="${SCRIPT_DIR}/${COMPOSE_FILE_NAME}"
if [[ ! -f "$SRC_COMPOSE" ]]; then
  # When script is uploaded alone, expect compose beside it or in INSTALL_DIR.
  SRC_COMPOSE="${INSTALL_DIR}/${COMPOSE_FILE_NAME}"
fi
[[ -f "$SRC_COMPOSE" ]] || die "compose file not found: ${COMPOSE_FILE_NAME}"

cp -f "$SRC_COMPOSE" "${INSTALL_DIR}/${COMPOSE_FILE_NAME}"
cd "$INSTALL_DIR"

log "pull ${IMAGE}"
docker pull "$IMAGE"

log "compose up"
docker compose -f "$COMPOSE_FILE_NAME" up -d

wait_health

# API key is generated on first boot into /app/data/.api-key
KEY=""
for i in $(seq 1 30); do
  KEY="$(read_api_key || true)"
  [[ -n "$KEY" ]] && break
  sleep 2
done
[[ -n "$KEY" ]] || die "API key not found after start"
persist_host_key "$KEY"

log "bootstrap complete"
printf 'OPENWA_BASE_URL=http://127.0.0.1:%s\n' "$PUBLIC_PORT"
printf 'OPENWA_API_KEY=%s\n' "$KEY"
printf 'OPENWA_PUBLIC_HINT=http://<this-vps-ip>:%s\n' "$PUBLIC_PORT"
