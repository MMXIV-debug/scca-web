#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SOLO_INSTALAR=0
ARGS_INICIAR=()
for arg in "$@"; do
  if [[ "$arg" == "--solo-instalar" || "$arg" == "-SoloInstalar" ]]; then
    SOLO_INSTALAR=1
  else
    ARGS_INICIAR+=("$arg")
  fi
done

# Colores si la salida es terminal
if [[ -t 1 ]]; then
  C_CYAN='\033[0;36m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_RED='\033[0;31m'
  C_RESET='\033[0m'
else
  C_CYAN='' C_GREEN='' C_YELLOW='' C_RED='' C_RESET=''
fi

info() { printf "%b%s%b\n" "$C_CYAN" "$1" "$C_RESET"; }
ok()   { printf "%b%s%b\n" "$C_GREEN" "$1" "$C_RESET"; }
warn() { printf "%b%s%b\n" "$C_YELLOW" "$1" "$C_RESET"; }
fail() { printf "%bError: %s%b\n" "$C_RED" "$1" "$C_RESET" >&2; exit 1; }

# Incluir rutas de usuario para Node.js local y .NET SDK 10
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export PATH="$HOME/.local/node/bin:$DOTNET_ROOT:$DOTNET_ROOT/tools:$HOME/.local/bin:$PATH"

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "Se necesitan permisos de administrador (sudo) para ejecutar: $*"
  fi
}

APT_UPDATED=0
instalar_paquete() {
  if command -v apt-get >/dev/null 2>&1; then
    if [[ "$APT_UPDATED" -eq 0 ]]; then
      run_root apt-get update -qq
      APT_UPDATED=1
    fi
    run_root apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf install -y "$@"
  elif command -v pacman >/dev/null 2>&1; then
    run_root pacman -Sy --noconfirm "$@"
  elif command -v zypper >/dev/null 2>&1; then
    run_root zypper --non-interactive install "$@"
  else
    return 1
  fi
}

descargar() {
  local url="$1" destino="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destino"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$destino" "$url"
  else
    instalar_paquete curl ca-certificates || fail "Falta curl o wget para descargar $url"
    curl -fsSL "$url" -o "$destino"
  fi
}

instalar_node_lts() {
  local arch node_arch tmp_dir archivo
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)  node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) fail "Arquitectura no soportada para descarga automática de Node.js: $arch. Instala Node.js 18+ manualmente." ;;
  esac

  info ">> Descargando e instalando Node.js 22 LTS en $HOME/.local/node..."
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN
  descargar "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" "$tmp_dir/SHASUMS256.txt"
  archivo="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-${node_arch}\.tar\.gz" "$tmp_dir/SHASUMS256.txt" | head -n 1 || true)"
  [[ -n "$archivo" ]] || fail "No se pudo resolver la descarga de Node.js 22 LTS para linux-${node_arch}."
  descargar "https://nodejs.org/dist/latest-v22.x/${archivo}" "$tmp_dir/$archivo"
  mkdir -p "$HOME/.local"
  rm -rf "$HOME/.local/node"
  mkdir -p "$HOME/.local/node"
  tar -xzf "$tmp_dir/$archivo" -C "$HOME/.local/node" --strip-components=1
}

buscar_python() {
  local cand ver
  for cand in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
      ver="$("$cand" --version 2>&1 || true)"
      if [[ "$ver" =~ Python\ 3\.(1[0-9]|[2-9][0-9]) ]]; then
        command -v "$cand"
        return 0
      fi
    fi
  done
  return 1
}

sdk10_instalado() {
  command -v dotnet >/dev/null 2>&1 && dotnet --list-sdks 2>/dev/null | grep -q '^10\.'
}

instalar_icu_si_falta() {
  if command -v apt-get >/dev/null 2>&1; then
    instalar_paquete libicu-dev || true
  elif command -v dnf >/dev/null 2>&1; then
    instalar_paquete libicu || true
  elif command -v pacman >/dev/null 2>&1; then
    instalar_paquete icu || true
  elif command -v zypper >/dev/null 2>&1; then
    instalar_paquete libicu || true
  fi
}

instalar_libgomp_si_falta() {
  if command -v apt-get >/dev/null 2>&1; then
    instalar_paquete libgomp1 || true
  elif command -v dnf >/dev/null 2>&1; then
    instalar_paquete libgomp || true
  elif command -v pacman >/dev/null 2>&1; then
    instalar_paquete gcc-libs || true
  elif command -v zypper >/dev/null 2>&1; then
    instalar_paquete libgomp1 || true
  fi
}

# 1. Node.js LTS (18+)
NODE_MAJOR=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
fi
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  instalar_node_lts
fi
ok "OK Node.js: $(node --version) ($(command -v node))"

# 2. Python 3.10+
PYTHON_EXE="$(buscar_python || true)"
if [[ -z "$PYTHON_EXE" ]]; then
  info ">> Instalando Python 3..."
  if command -v apt-get >/dev/null 2>&1; then
    instalar_paquete python3 python3-venv python3-pip || fail "No se pudo instalar Python 3."
  elif command -v pacman >/dev/null 2>&1; then
    instalar_paquete python python-pip || fail "No se pudo instalar Python 3."
  else
    instalar_paquete python3 python3-pip || fail "No se pudo instalar Python 3."
  fi
  PYTHON_EXE="$(buscar_python || true)"
  [[ -n "$PYTHON_EXE" ]] || fail "No se encontró Python 3.10+ en el sistema. Instálalo manualmente y vuelve a ejecutar."
fi
ok "OK Python: $("$PYTHON_EXE" --version) ($PYTHON_EXE)"

# 3. .NET SDK 10.0
if ! sdk10_instalado; then
  info ">> Instalando .NET SDK 10.0 en $DOTNET_ROOT..."
  TMP_DOTNET="$(mktemp)"
  trap 'rm -f "$TMP_DOTNET"' EXIT
  descargar "https://dot.net/v1/dotnet-install.sh" "$TMP_DOTNET"
  bash "$TMP_DOTNET" --channel 10.0 --install-dir "$DOTNET_ROOT"
  rm -f "$TMP_DOTNET"
  trap - EXIT
  if ! sdk10_instalado; then
    warn "Verificando librerías nativas de .NET (ICU)..."
    instalar_icu_si_falta
  fi
  sdk10_instalado || fail ".NET SDK 10.0 se instaló pero dotnet no responde. Revisa $DOTNET_ROOT."
fi
ok "OK .NET SDK: $(dotnet --version)"

# 4. Dependencias de Node.js
if [[ ! -d "node_modules/pg" || ! -d "node_modules/express" ]]; then
  info ">> Instalando dependencias de Node.js..."
  if [[ -f "package-lock.json" ]]; then
    if ! npm ci; then
      warn "npm ci falló; reintentando con npm install..."
      npm install || fail "Falló la instalación de paquetes de Node.js."
    fi
  else
    npm install || fail "Falló la instalación de paquetes de Node.js."
  fi
fi
ok "OK Node modules listos."

# 5. Entorno virtual de Python (.venv) y requirements.txt
PY_VENV="$SCRIPT_DIR/.venv/bin/python"
if [[ ! -x "$PY_VENV" ]]; then
  if [[ -d ".venv/Scripts" ]]; then
    warn ">> Detectado .venv de Windows; recreando .venv para Linux..."
    rm -rf .venv
  fi
  info ">> Creando entorno virtual .venv..."
  if ! "$PYTHON_EXE" -m venv .venv; then
    if command -v apt-get >/dev/null 2>&1; then
      warn "Falta el módulo venv de Python; instalando python3-venv..."
      PY_MM="$("$PYTHON_EXE" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
      instalar_paquete "python${PY_MM}-venv" python3-venv || instalar_paquete python3-venv || true
      rm -rf .venv
      "$PYTHON_EXE" -m venv .venv || fail "No se pudo crear .venv."
    else
      fail "No se pudo crear .venv. Asegúrate de tener el módulo venv de Python instalado."
    fi
  fi
  [[ -x "$PY_VENV" ]] || fail "No se pudo crear .venv."
fi

if ! "$PY_VENV" -c "import requests, psycopg2, dotenv, sqlalchemy, pandas, sklearn, xgboost, joblib, fastapi, pydantic, uvicorn" 2>/dev/null; then
  info ">> Instalando dependencias de Python (requirements.txt)..."
  "$PY_VENV" -m pip install --upgrade pip
  "$PY_VENV" -m pip install -r requirements.txt || fail "Falló la instalación de requirements.txt."
  if ! "$PY_VENV" -c "import xgboost" 2>/dev/null; then
    warn "Verificando librería OpenMP (libgomp) para xgboost..."
    instalar_libgomp_si_falta
  fi
fi
ok "OK Entorno .venv y paquetes Python listos."

# 6. Paquetes NuGet de .NET (limpia artefactos si el proyecto se copió desde Windows)
ASSETS="backend/Scca.Api/obj/project.assets.json"
NECESITA_RESTORE=0
if [[ ! -f "$ASSETS" ]]; then
  NECESITA_RESTORE=1
elif grep -qE '[A-Za-z]:\\\\' "$ASSETS" 2>/dev/null; then
  warn ">> Detectados artefactos .NET de Windows; regenerando para Linux..."
  rm -rf backend/Scca.Api/obj backend/Scca.Api/bin/iniciador
  NECESITA_RESTORE=1
fi
if [[ "$NECESITA_RESTORE" -eq 1 ]]; then
  info ">> Restaurando paquetes de .NET (dotnet restore)..."
  dotnet restore backend/Scca.Api/Scca.Api.csproj || fail "Falló dotnet restore."
fi
ok "OK Paquetes .NET restaurados."

# 7. Configuración de .env
RUTA_ENV="$SCRIPT_DIR/.env"
if [[ ! -f "$RUTA_ENV" ]]; then
  warn ">> No existe .env; creando desde plantilla..."
  if [[ -f ".env.example" ]]; then
    cp ".env.example" "$RUTA_ENV"
  else
    cat > "$RUTA_ENV" <<'EOF'
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/sistema_calidad_aire
JWT_SECRET=REEMPLAZAR_POR_UN_SECRETO_PRIVADO
IOT_API_KEY=REEMPLAZAR_POR_LA_CLAVE_DEL_ESP32
PORT=3000
EOF
  fi
fi

"$PY_VENV" - "$RUTA_ENV" <<'PYEOF'
import pathlib, re, secrets, sys

ruta = pathlib.Path(sys.argv[1])
lineas = ruta.read_text(encoding='utf-8').splitlines()

def obtener(clave):
    pat = re.compile(r'^\s*' + re.escape(clave) + r'\s*=(.*)$')
    for l in lineas:
        m = pat.match(l)
        if m:
            return m.group(1).strip()
    return None

def fijar(clave, valor):
    pat = re.compile(r'^\s*' + re.escape(clave) + r'\s*=')
    for i, l in enumerate(lineas):
        if pat.match(l):
            lineas[i] = f'{clave}={valor}'
            return
    lineas.append(f'{clave}={valor}')

cambio = False
db_url = obtener('DATABASE_URL')
if not db_url or re.search(r'USUARIO:(CLAVE|CONTRASENA)@', db_url):
    entrada = input('Pega tu DATABASE_URL (postgresql://usuario:clave@host:puerto/base): ').strip()
    if not entrada:
        sys.exit('Se requiere DATABASE_URL válida en .env para iniciar SCCA.')
    fijar('DATABASE_URL', entrada)
    cambio = True

jwt = obtener('JWT_SECRET')
if not jwt or jwt.startswith('REEMPLAZAR_POR_'):
    fijar('JWT_SECRET', secrets.token_hex(32))
    cambio = True

iot = obtener('IOT_API_KEY')
if not iot or iot.startswith('REEMPLAZAR_POR_'):
    fijar('IOT_API_KEY', secrets.token_hex(32))
    print('>> Se generó IOT_API_KEY aleatoria. Si conectas un ESP32 físico, iguala esta clave en su firmware.')
    cambio = True

if cambio:
    ruta.write_text('\n'.join(lineas) + '\n', encoding='utf-8')
PYEOF
ok "OK Archivo .env configurado."

# 8. Preparación inicial del registro local de modelos de demostración
REGISTRO_DEMO="ml_engine/registro_modelos_demo/registro.json"
if [[ ! -f "$REGISTRO_DEMO" ]]; then
  info ">> Generando registro inicial de modelos ML de demostración..."
  if ! "$PY_VENV" -u ml_engine/ciclo_automatico.py; then
    warn "No se pudo completar el ciclo inicial de modelos ML (continuando de todas formas)."
  fi
fi
ok "OK Registro ML listo."

# 9. Arrancar la aplicación
if [[ "$SOLO_INSTALAR" -eq 1 ]]; then
  ok ">> Instalación y verificación completadas (--solo-instalar)."
  exit 0
fi

ok ">> Todo listo. Iniciando SCCA (node iniciar.js)..."
if [[ "${#ARGS_INICIAR[@]}" -gt 0 ]]; then
  exec node iniciar.js "${ARGS_INICIAR[@]}"
else
  exec node iniciar.js
fi
