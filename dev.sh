#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/psycho-form/psychoform"
SUPABASE_DIR="$ROOT_DIR/psycho-form"
FRONTEND_DIR="$ROOT_DIR/bfa-digital"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

info()  { echo -e "${BLUE}[dev]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }

BACKEND_PID=""
FRONTEND_PID=""

kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  local exit_code=$?
  echo ""
  info "Deteniendo procesos de desarrollo..."
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill_tree "$FRONTEND_PID"
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill_tree "$BACKEND_PID"
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  info "Frontend y Backend detenidos. (Supabase sigue activo en Docker; usa './dev.sh stop' para detenerlo)."
  exit "$exit_code"
}

ensure_java21() {
  if command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -qE 'version "21(\.|")'; then
    return 0
  fi
  if [[ -d /opt/homebrew/opt/openjdk@21/bin ]]; then
    export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
    export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
  elif [[ -d /usr/local/opt/openjdk@21/bin ]]; then
    export PATH="/usr/local/opt/openjdk@21/bin:$PATH"
    export JAVA_HOME="/usr/local/opt/openjdk@21"
  fi
}

ensure_docker_running() {
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker no está instalado. Ejecuta ./setup.sh primero."
    exit 1
  fi

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    info "Docker no está corriendo. Intentando abrir Docker Desktop..."
    open -a Docker || true
    local waited=0
    while ! docker info >/dev/null 2>&1; do
      if (( waited >= 60 )); then
        err "Docker Desktop no respondió después de 60s. Ábrelo manualmente y vuelve a intentar."
        exit 1
      fi
      sleep 2
      waited=$((waited + 2))
    done
    ok "Docker Desktop está listo."
  else
    err "El daemon de Docker no está corriendo. Inícialo (ej. 'sudo systemctl start docker') y vuelve a intentar."
    exit 1
  fi
}

load_env() {
  "$ROOT_DIR/env.sh" init >/dev/null
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
}

cmd_up() {
  local start_db=true
  if [[ "${1:-}" == "--no-db" ]]; then
    start_db=false
  fi

  ensure_java21
  load_env

  if [[ "$start_db" == "true" ]]; then
    ensure_docker_running
    info "Levantando base de datos y almacenamiento (Supabase)..."
    (
      cd "$SUPABASE_DIR"
      supabase start
    )
    ok "Supabase activo."

    # Si las llaves S3 están vacías en .env, intentar sincronizarlas desde Supabase
    if [[ -z "${BFA_STORAGE_S3_ACCESS_KEY:-}" || -z "${BFA_STORAGE_S3_SECRET_KEY:-}" ]]; then
      "$ROOT_DIR/env.sh" sync-supabase || true
      load_env
    fi
  else
    warn "Omitiendo inicio de Supabase (--no-db)."
  fi

  trap cleanup INT TERM EXIT

  info "Levantando Backend (Spring Boot en http://localhost:8080)..."
  (
    cd "$BACKEND_DIR"
    ./mvnw spring-boot:run 2>&1 | awk -v p="$(printf "${MAGENTA}[backend]${NC} ")" '{ print p $0; fflush() }'
  ) &
  BACKEND_PID=$!

  info "Levantando Frontend (Vite en http://localhost:5173)..."
  (
    cd "$FRONTEND_DIR"
    pnpm dev 2>&1 | awk -v p="$(printf "${CYAN}[frontend]${NC} ")" '{ print p $0; fflush() }'
  ) &
  FRONTEND_PID=$!

  echo ""
  ok "Servicios iniciados. Presiona Ctrl+C para detener Frontend y Backend."
  echo "  - Frontend:        http://localhost:5173"
  echo "  - Backend API:     http://localhost:8080"
  echo "  - Swagger UI:      http://localhost:8080/swagger-ui.html"
  echo "  - Supabase Studio: http://127.0.0.1:54323"
  echo ""

  wait "$BACKEND_PID" "$FRONTEND_PID"
}

cmd_stop() {
  info "Deteniendo Supabase..."
  if command -v supabase >/dev/null 2>&1; then
    (cd "$SUPABASE_DIR" && supabase stop) || warn "Supabase ya estaba detenido."
  fi
  ok "Entorno detenido."
}

cmd_status() {
  echo ""
  info "Estado de servicios:"
  if lsof -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    ok "Backend (8080):  CORRIENDO"
  else
    warn "Backend (8080):  DETENIDO"
  fi

  if lsof -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
    ok "Frontend (5173): CORRIENDO"
  else
    warn "Frontend (5173): DETENIDO"
  fi

  if command -v supabase >/dev/null 2>&1 && (cd "$SUPABASE_DIR" && supabase status >/dev/null 2>&1); then
    ok "Supabase (54321/54322): CORRIENDO"
  else
    warn "Supabase (54321/54322): DETENIDO"
  fi
  echo ""
}

usage() {
  cat <<EOF
Uso: ./dev.sh [comando] [opciones]

Comandos:
  up [--no-db]    Levanta Supabase (BD + S3), Backend y Frontend (por defecto)
  stop            Detiene los contenedores locales de Supabase
  status          Muestra qué servicios están activos
  help            Muestra esta ayuda
EOF
}

cmd="${1:-up}"
case "$cmd" in
  up)
    shift || true
    cmd_up "${1:-}"
    ;;
  --no-db)
    cmd_up "--no-db"
    ;;
  stop)
    cmd_stop
    ;;
  status)
    cmd_status
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    err "Comando desconocido: $cmd"
    usage
    exit 1
    ;;
esac
