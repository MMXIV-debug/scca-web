param(
  [switch]$SoloInstalar
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Actualizar-Path {
  $rutasSistema = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [Environment]::GetEnvironmentVariable('Path', 'User')
  ) -join ';'

  $candidatas = @(
    'C:\Program Files\nodejs',
    'C:\Program Files\dotnet'
  )
  foreach ($patron in @(
    "$env:LocalAppData\Programs\Python\Python3*",
    'C:\Program Files\Python3*',
    'C:\Python3*'
  )) {
    Get-Item -Path $patron -ErrorAction SilentlyContinue | ForEach-Object {
      $candidatas += $_.FullName
      $scripts = Join-Path $_.FullName 'Scripts'
      if (Test-Path $scripts) { $candidatas += $scripts }
    }
  }

  $existentes = @($candidatas | Where-Object { $_ -and (Test-Path $_) })
  $partes = @($existentes + ($rutasSistema -split ';')) | Where-Object { $_ } | Select-Object -Unique
  $env:Path = $partes -join ';'
}

function Instalar-Winget($id, $nombre) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Falta winget para instalar $nombre. Instala 'App Installer' desde Microsoft Store o instala $nombre manualmente."
  }
  Write-Host ">> Instalando $nombre..." -ForegroundColor Cyan
  & winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar $nombre (winget código $LASTEXITCODE)." }
  Actualizar-Path
}

function Buscar-Python {
  $candidatos = @()
  foreach ($patron in @(
    "$env:LocalAppData\Programs\Python\Python3*\python.exe",
    'C:\Program Files\Python3*\python.exe',
    'C:\Python3*\python.exe'
  )) {
    $candidatos += Get-Item -Path $patron -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object { $_.FullName }
  }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and $cmd.Source -notlike '*WindowsApps*') {
    $candidatos += $cmd.Source
  }

  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    foreach ($exe in ($candidatos | Select-Object -Unique)) {
      $ver = & $exe --version 2>&1
      if ($LASTEXITCODE -eq 0 -and "$ver" -match 'Python 3\.(1[1-9]|[2-9]\d)') {
        return $exe
      }
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
      $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path $exe)) {
        $ver = & $exe --version 2>&1
        if ($LASTEXITCODE -eq 0 -and "$ver" -match 'Python 3\.(1[1-9]|[2-9]\d)') {
          return $exe
        }
      }
    }
  } finally {
    $ErrorActionPreference = $prev
  }
  return $null
}

function Sdk10-Instalado {
  if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $sdks = & dotnet --list-sdks 2>$null
    return ($LASTEXITCODE -eq 0 -and [bool]($sdks | Select-String '^10\.'))
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Nuevo-SecretoHex {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
}

function Obtener-ValorEnv($lineas, $clave) {
  foreach ($l in $lineas) {
    if ($l -match "^\s*$([regex]::Escape($clave))\s*=(.*)$") { return $matches[1].Trim() }
  }
  return $null
}

function Fijar-ValorEnv($lineas, $clave, $valor) {
  for ($i = 0; $i -lt $lineas.Count; $i++) {
    if ($lineas[$i] -match "^\s*$([regex]::Escape($clave))\s*=") {
      $lineas[$i] = "$clave=$valor"
      return
    }
  }
  $lineas.Add("$clave=$valor")
}

Actualizar-Path

# 1. Node.js LTS
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Instalar-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
}
Write-Host "OK Node.js: $(& node --version)" -ForegroundColor Green

# 2. Python 3.12+
$pythonExe = Buscar-Python
if (-not $pythonExe) {
  Instalar-Winget 'Python.Python.3.12' 'Python 3.12'
  $pythonExe = Buscar-Python
  if (-not $pythonExe) { throw 'Python se instaló pero no se encontró en el sistema. Cierra y vuelve a abrir la terminal.' }
}
Write-Host "OK Python: $(& $pythonExe --version) ($pythonExe)" -ForegroundColor Green

# 3. .NET SDK 10.0
if (-not (Sdk10-Instalado)) {
  Instalar-Winget 'Microsoft.DotNet.SDK.10' '.NET SDK 10.0'
  if (-not (Sdk10-Instalado)) { throw '.NET SDK 10.0 se instaló pero dotnet no responde. Cierra y vuelve a abrir la terminal.' }
}
Write-Host "OK .NET SDK: $(& dotnet --version)" -ForegroundColor Green

# 4. Dependencias de Node.js
if (-not (Test-Path 'node_modules\pg') -or -not (Test-Path 'node_modules\express')) {
  Write-Host '>> Instalando dependencias de Node.js...' -ForegroundColor Cyan
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if (Test-Path 'package-lock.json') {
      & npm.cmd ci
    } else {
      & npm.cmd install
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'npm ci falló; reintentando con npm install...'
      & npm.cmd install
      if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de paquetes de Node.js.' }
    }
  } finally {
    $ErrorActionPreference = $prev
  }
}
Write-Host 'OK Node modules listos.' -ForegroundColor Green

# 5. Entorno virtual de Python (.venv) y requirements.txt
$pyVenv = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $pyVenv)) {
  Write-Host '>> Creando entorno virtual .venv...' -ForegroundColor Cyan
  & $pythonExe -m venv .venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pyVenv)) { throw 'No se pudo crear .venv.' }
}

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $pyVenv -c "import requests, psycopg2, dotenv, sqlalchemy, pandas, sklearn, xgboost, joblib, fastapi, pydantic, uvicorn" 2>$null
  $paquetesPyOk = ($LASTEXITCODE -eq 0)
} finally {
  $ErrorActionPreference = $prev
}

if (-not $paquetesPyOk) {
  Write-Host '>> Instalando dependencias de Python (requirements.txt)...' -ForegroundColor Cyan
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $pyVenv -m pip install --upgrade pip
    & $pyVenv -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de requirements.txt.' }
  } finally {
    $ErrorActionPreference = $prev
  }
}
Write-Host 'OK Entorno .venv y paquetes Python listos.' -ForegroundColor Green

# 6. Paquetes NuGet de .NET
$assets = Join-Path $PSScriptRoot 'backend\Scca.Api\obj\project.assets.json'
if (-not (Test-Path $assets)) {
  Write-Host '>> Restaurando paquetes de .NET (dotnet restore)...' -ForegroundColor Cyan
  & dotnet restore backend/Scca.Api/Scca.Api.csproj
  if ($LASTEXITCODE -ne 0) { throw 'Falló dotnet restore.' }
}
Write-Host 'OK Paquetes .NET restaurados.' -ForegroundColor Green

# 7. Configuración de .env
$rutaEnv = Join-Path $PSScriptRoot '.env'
$utf8SinBom = New-Object System.Text.UTF8Encoding $false
if (-not (Test-Path $rutaEnv)) {
  Write-Host '>> No existe .env; creando desde plantilla...' -ForegroundColor Yellow
  if (Test-Path '.env.example') {
    Copy-Item '.env.example' $rutaEnv
  } else {
    [System.IO.File]::WriteAllLines($rutaEnv, @(
      'DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/sistema_calidad_aire',
      'JWT_SECRET=REEMPLAZAR_POR_UN_SECRETO_PRIVADO',
      'IOT_API_KEY=REEMPLAZAR_POR_LA_CLAVE_DEL_ESP32',
      'PORT=3000'
    ), $utf8SinBom)
  }
}

$lineasEnv = [System.Collections.Generic.List[string]](Get-Content $rutaEnv -Encoding UTF8)
$cambioEnv = $false
$dbUrl = Obtener-ValorEnv $lineasEnv 'DATABASE_URL'
if (-not $dbUrl -or $dbUrl -match 'USUARIO:(CLAVE|CONTRASENA)@') {
  $entradaDb = (Read-Host 'Pega tu DATABASE_URL (postgresql://usuario:clave@host:puerto/base)').Trim()
  if (-not $entradaDb) { throw 'Se requiere DATABASE_URL válida en .env para iniciar SCCA.' }
  Fijar-ValorEnv $lineasEnv 'DATABASE_URL' $entradaDb
  $cambioEnv = $true
}
$jwtSecret = Obtener-ValorEnv $lineasEnv 'JWT_SECRET'
if (-not $jwtSecret -or $jwtSecret -match '^REEMPLAZAR_POR_') {
  Fijar-ValorEnv $lineasEnv 'JWT_SECRET' (Nuevo-SecretoHex)
  $cambioEnv = $true
}
$iotKey = Obtener-ValorEnv $lineasEnv 'IOT_API_KEY'
if (-not $iotKey -or $iotKey -match '^REEMPLAZAR_POR_') {
  Fijar-ValorEnv $lineasEnv 'IOT_API_KEY' (Nuevo-SecretoHex)
  Write-Host '>> Se generó IOT_API_KEY aleatoria. Si conectas un ESP32 físico, iguala esta clave en su firmware.' -ForegroundColor Yellow
  $cambioEnv = $true
}
if ($cambioEnv) {
  [System.IO.File]::WriteAllLines($rutaEnv, $lineasEnv, $utf8SinBom)
}
Write-Host 'OK Archivo .env configurado.' -ForegroundColor Green

# 8. Preparación inicial del registro local de modelos de demostración
$registroDemo = Join-Path $PSScriptRoot 'ml_engine\registro_modelos_demo\registro.json'
if (-not (Test-Path $registroDemo)) {
  Write-Host '>> Generando registro inicial de modelos ML de demostración...' -ForegroundColor Cyan
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $pyVenv -u 'ml_engine\ciclo_automatico.py'
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'No se pudo completar el ciclo inicial de modelos ML (continuando de todas formas).'
    }
  } catch {
    Write-Warning "No se pudo ejecutar ciclo_automatico.py: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $prev
  }
}
Write-Host 'OK Registro ML listo.' -ForegroundColor Green

# 9. Arrancar la aplicación
if ($SoloInstalar) {
  Write-Host '>> Instalación y verificación completadas (-SoloInstalar).' -ForegroundColor Green
  exit 0
}

Write-Host '>> Todo listo. Iniciando SCCA (node iniciar.js)...' -ForegroundColor Green
& node iniciar.js
exit $LASTEXITCODE
