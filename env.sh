#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ENV="$ROOT_DIR/.env"
BACKEND_ENV_EXAMPLE="$ROOT_DIR/.env.example"
FRONTEND_ENV="$ROOT_DIR/bfa-digital/.env.local"
FRONTEND_ENV_EXAMPLE="$ROOT_DIR/bfa-digital/.env.example"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}[env]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }

init_envs() {
  if [[ ! -f "$BACKEND_ENV" ]]; then
    cp "$BACKEND_ENV_EXAMPLE" "$BACKEND_ENV"
    ok "Creado $BACKEND_ENV desde .env.example"
  else
    info "$BACKEND_ENV ya existe"
  fi

  if [[ ! -f "$FRONTEND_ENV" ]]; then
    cp "$FRONTEND_ENV_EXAMPLE" "$FRONTEND_ENV"
    ok "Creado $FRONTEND_ENV desde bfa-digital/.env.example"
  else
    info "$FRONTEND_ENV ya existe"
  fi
}

upsert_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  if [[ ! -f "$file" ]]; then
    init_envs
  fi

  if grep -qE "^${key}=" "$file"; then
    # Reemplazar línea existente de forma segura (compatible con macOS y Linux)
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      BEGIN { FS="="; OFS="=" }
      $1 == k { print k, v; next }
      { print }
    ' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
  else
    # Asegurar salto de línea final antes de agregar
    if [[ -s "$file" ]] && [[ "$(tail -c1 "$file" | wc -l)" -eq 0 ]]; then
      echo "" >> "$file"
    fi
    echo "${key}=${value}" >> "$file"
  fi
}

set_var() {
  local assignment="$1"
  if [[ "$assignment" != *"="* ]]; then
    err "Formato inválido. Usa: ./env.sh set CLAVE=VALOR"
    exit 1
  fi

  local key="${assignment%%=*}"
  local value="${assignment#*=}"

  if [[ -z "$key" ]]; then
    err "La clave no puede estar vacía."
    exit 1
  fi

  if [[ "$key" == VITE_* ]]; then
    upsert_var "$FRONTEND_ENV" "$key" "$value"
    ok "Actualizada variable de Frontend ($key) en bfa-digital/.env.local"
  else
    upsert_var "$BACKEND_ENV" "$key" "$value"
    ok "Actualizada variable de Backend ($key) en .env"
  fi
}

list_vars() {
  init_envs
  echo ""
  echo -e "${BLUE}=== Backend (.env) ===${NC}"
  grep -vE '^\s*(#|$)' "$BACKEND_ENV" || echo "(vacío)"
  echo ""
  echo -e "${BLUE}=== Frontend (bfa-digital/.env.local) ===${NC}"
  grep -vE '^\s*(#|$)' "$FRONTEND_ENV" || echo "(vacío)"
  echo ""
}

sync_supabase() {
  init_envs
  if ! command -v supabase >/dev/null 2>&1; then
    warn "Supabase CLI no está instalado; omitiendo sincronización S3."
    return 0
  fi

  local status_env
  if ! status_env="$(cd "$ROOT_DIR/psycho-form" && supabase status -o env 2>/dev/null)"; then
    warn "Supabase no está corriendo actualmente. Inicia Supabase primero o usa ./dev.sh."
    return 0
  fi

  local s3_key s3_secret
  s3_key="$(echo "$status_env" | grep -E '^(S3_PROTOCOL_ACCESS_KEY_ID|STORAGE_S3_ACCESS_KEY)=' | head -n1 | cut -d'=' -f2- | tr -d '"')"
  s3_secret="$(echo "$status_env" | grep -E '^(S3_PROTOCOL_ACCESS_KEY_SECRET|STORAGE_S3_SECRET_KEY)=' | head -n1 | cut -d'=' -f2- | tr -d '"')"

  if [[ -n "$s3_key" && -n "$s3_secret" ]]; then
    upsert_var "$BACKEND_ENV" "BFA_STORAGE_S3_ACCESS_KEY" "$s3_key"
    upsert_var "$BACKEND_ENV" "BFA_STORAGE_S3_SECRET_KEY" "$s3_secret"
    ok "Credenciales S3 de Supabase sincronizadas en .env"
  else
    warn "No se encontraron llaves S3 en 'supabase status -o env'."
  fi
}

interactive_menu() {
  init_envs
  while true; do
    echo ""
    echo -e "${BLUE}Gestor de Variables de Entorno — PsychoForm / BFA Digital${NC}"
    echo "1) Ver variables actuales"
    echo "2) Agregar o actualizar variable (ej. VITE_API_URL, BFA_JWT_SECRET, etc.)"
    echo "3) Sincronizar credenciales S3 desde Supabase local"
    echo "4) Restablecer desde .env.example (respaldando actuales)"
    echo "5) Salir"
    read -rp "Elige una opción [1-5]: " choice

    case "$choice" in
      1)
        list_vars
        ;;
      2)
        read -rp "Nombre de la variable (ej. VITE_FEATURE_SESSION_PAUSE o BFA_DB_PASSWORD): " var_key
        if [[ -z "$var_key" ]]; then
          warn "Nombre vacío, cancelado."
          continue
        fi
        read -rp "Valor para $var_key: " var_val
        set_var "${var_key}=${var_val}"
        ;;
      3)
        sync_supabase
        ;;
      4)
        local ts
        ts="$(date +%Y%m%d_%H%M%S)"
        [[ -f "$BACKEND_ENV" ]] && cp "$BACKEND_ENV" "${BACKEND_ENV}.bak.${ts}"
        [[ -f "$FRONTEND_ENV" ]] && cp "$FRONTEND_ENV" "${FRONTEND_ENV}.bak.${ts}"
        cp "$BACKEND_ENV_EXAMPLE" "$BACKEND_ENV"
        cp "$FRONTEND_ENV_EXAMPLE" "$FRONTEND_ENV"
        ok "Archivos restablecidos (respaldos guardados con sufijo .bak.${ts})."
        ;;
      5)
        break
        ;;
      *)
        warn "Opción inválida."
        ;;
    esac
  done
}

usage() {
  cat <<EOF
Uso: ./env.sh [comando]

Comandos:
  (sin args)         Abre el menú interactivo
  init               Crea .env y bfa-digital/.env.local si no existen
  list               Muestra todas las variables configuradas
  set CLAVE=VALOR    Agrega o actualiza una variable (VITE_* va al frontend, el resto al backend)
  sync-supabase      Extrae las llaves S3 de Supabase local y las guarda en .env
  help               Muestra esta ayuda
EOF
}

cmd="${1:-interactive}"
case "$cmd" in
  interactive)   interactive_menu ;;
  init)          init_envs ;;
  list)          list_vars ;;
  set)
    if [[ $# -lt 2 ]]; then
      err "Falta el argumento CLAVE=VALOR"
      exit 1
    fi
    set_var "$2"
    ;;
  sync-supabase) sync_supabase ;;
  help|-h|--help) usage ;;
  *)
    err "Comando desconocido: $cmd"
    usage
    exit 1
    ;;
esac
