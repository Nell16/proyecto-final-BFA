#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}[setup]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }

OS="$(uname -s)"
if [[ "$OS" != "Darwin" && "$OS" != "Linux" ]]; then
  err "Sistema operativo no soportado automáticamente: $OS. Usa macOS o Linux (WSL2 en Windows)."
  exit 1
fi

info "Sistema detectado: $OS"

# ------------------------------------------------------------------------------
# 1. Gestor de paquetes (macOS: Homebrew)
# ------------------------------------------------------------------------------
ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew instalado: $(brew --version | head -n1)"
    return 0
  fi

  info "Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  ok "Homebrew instalado correctamente."
}

# ------------------------------------------------------------------------------
# 2. Instalación de herramientas base
# ------------------------------------------------------------------------------
install_macos_deps() {
  ensure_homebrew

  # Docker (necesario para Supabase local)
  if ! command -v docker >/dev/null 2>&1; then
    info "Instalando Docker Desktop..."
    brew install --cask docker
    warn "Docker Desktop fue instalado. Ábrelo desde Aplicaciones antes de levantar la BD."
  else
    ok "Docker instalado: $(docker --version)"
  fi

  # Node.js
  if ! command -v node >/dev/null 2>&1; then
    info "Instalando Node.js..."
    brew install node
  else
    ok "Node.js instalado: $(node -v)"
  fi

  # pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    info "Instalando pnpm..."
    brew install pnpm
  else
    ok "pnpm instalado: $(pnpm -v)"
  fi

  # Java 21 (OpenJDK 21)
  local has_java21=false
  if command -v java >/dev/null 2>&1; then
    if java -version 2>&1 | grep -qE 'version "21(\.|")'; then
      has_java21=true
    fi
  fi

  if [[ "$has_java21" == "false" ]]; then
    if [[ -d /opt/homebrew/opt/openjdk@21/bin ]]; then
      export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
      export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
      has_java21=true
    elif [[ -d /usr/local/opt/openjdk@21/bin ]]; then
      export PATH="/usr/local/opt/openjdk@21/bin:$PATH"
      export JAVA_HOME="/usr/local/opt/openjdk@21"
      has_java21=true
    fi
  fi

  if [[ "$has_java21" == "false" ]]; then
    info "Instalando OpenJDK 21..."
    brew install openjdk@21
    if [[ -d /opt/homebrew/opt/openjdk@21/bin ]]; then
      export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
      export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
    elif [[ -d /usr/local/opt/openjdk@21/bin ]]; then
      export PATH="/usr/local/opt/openjdk@21/bin:$PATH"
      export JAVA_HOME="/usr/local/opt/openjdk@21"
    fi
    warn "Para usar Java 21 en tu terminal habitual, agrega a tu ~/.zshrc:"
    warn "  export PATH=\"${JAVA_HOME}/bin:\$PATH\""
  else
    ok "Java 21 disponible: $(java -version 2>&1 | head -n1)"
  fi

  # Supabase CLI
  if ! command -v supabase >/dev/null 2>&1; then
    info "Instalando Supabase CLI..."
    brew install supabase/tap/supabase
  else
    ok "Supabase CLI instalado: $(supabase --version)"
  fi
}

install_linux_deps() {
  local pkg_mgr=""
  if command -v apt-get >/dev/null 2>&1; then
    pkg_mgr="apt"
  elif command -v dnf >/dev/null 2>&1; then
    pkg_mgr="dnf"
  fi

  # Node.js
  if ! command -v node >/dev/null 2>&1; then
    info "Instalando Node.js (22.x)..."
    if [[ "$pkg_mgr" == "apt" ]]; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif [[ "$pkg_mgr" == "dnf" ]]; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs
    else
      err "Instala Node.js >= 20 manualmente y vuelve a ejecutar ./setup.sh."
      exit 1
    fi
  else
    ok "Node.js instalado: $(node -v)"
  fi

  # pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    info "Instalando pnpm..."
    if command -v corepack >/dev/null 2>&1; then
      sudo corepack enable || corepack enable
      corepack prepare pnpm@latest --activate || npm install -g pnpm
    else
      npm install -g pnpm
    fi
  else
    ok "pnpm instalado: $(pnpm -v)"
  fi

  # Java 21
  if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | grep -qE 'version "21(\.|")'; then
    info "Instalando OpenJDK 21..."
    if [[ "$pkg_mgr" == "apt" ]]; then
      sudo apt-get update && sudo apt-get install -y openjdk-21-jdk
    elif [[ "$pkg_mgr" == "dnf" ]]; then
      sudo dnf install -y java-21-openjdk-devel
    else
      err "Instala Java 21 JDK manualmente y vuelve a ejecutar ./setup.sh."
      exit 1
    fi
  else
    ok "Java 21 disponible: $(java -version 2>&1 | head -n1)"
  fi

  # Docker
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker no está instalado. Instálalo (ej. https://docs.docker.com/engine/install/) para usar Supabase local."
  else
    ok "Docker instalado: $(docker --version)"
  fi

  # Supabase CLI
  if ! command -v supabase >/dev/null 2>&1; then
    info "Instalando Supabase CLI..."
    if command -v brew >/dev/null 2>&1; then
      brew install supabase/tap/supabase
    else
      npm install -g supabase || {
        warn "No se pudo instalar supabase globalmente con npm; intenta con Homebrew o descarga el binario desde GitHub."
      }
    fi
  else
    ok "Supabase CLI instalado: $(supabase --version)"
  fi
}

if [[ "$OS" == "Darwin" ]]; then
  install_macos_deps
else
  install_linux_deps
fi

# ------------------------------------------------------------------------------
# 3. Variables de entorno (.env y bfa-digital/.env.local)
# ------------------------------------------------------------------------------
info "Inicializando archivos de variables de entorno..."
chmod +x "$ROOT_DIR/env.sh" "$ROOT_DIR/dev.sh"
"$ROOT_DIR/env.sh" init

# ------------------------------------------------------------------------------
# 4. Dependencias del Frontend (bfa-digital)
# ------------------------------------------------------------------------------
info "Instalando dependencias del frontend (bfa-digital) con pnpm..."
(
  cd "$ROOT_DIR/bfa-digital"
  pnpm install
)
ok "Dependencias del frontend instaladas."

# ------------------------------------------------------------------------------
# 5. Dependencias del Backend (psycho-form/psychoform)
# ------------------------------------------------------------------------------
info "Preparando backend Spring Boot y descargando dependencias Maven..."
(
  cd "$ROOT_DIR/psycho-form/psychoform"
  chmod +x mvnw
  ./mvnw dependency:go-offline -q || ./mvnw test-compile -DskipTests -q
)
ok "Dependencias del backend listas."

# ------------------------------------------------------------------------------
# Resumen final
# ------------------------------------------------------------------------------
echo ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN} Setup completado correctamente${NC}"
echo -e "${GREEN}================================================================${NC}"
echo ""
echo "Herramientas:"
echo "  - Node.js:      $(node -v)"
echo "  - pnpm:         $(pnpm -v)"
echo "  - Java:         $(java -version 2>&1 | head -n1)"
echo "  - Supabase CLI: $(supabase --version 2>/dev/null || echo 'no instalado')"
echo "  - Docker:       $(docker --version 2>/dev/null || echo 'no instalado')"
echo ""
echo "Siguientes pasos:"
echo "  1. Asegúrate de que Docker esté corriendo."
echo "  2. Configura tus variables de entorno (opcional): ./env.sh"
echo "  3. Levanta todo el proyecto (BD + Backend + Frontend): ./dev.sh"
echo ""
