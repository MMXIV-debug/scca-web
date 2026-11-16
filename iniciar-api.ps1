$ErrorActionPreference = 'Stop'
$raizProyecto = $PSScriptRoot
$pythonProyecto = Join-Path $raizProyecto '.venv\Scripts\python.exe'
$proyectoApi = Join-Path $raizProyecto 'backend\Scca.Api\Scca.Api.csproj'
if (-not (Test-Path -LiteralPath $pythonProyecto)) {
    throw 'Primero crea .venv con python -m venv .venv e instala requirements.txt usando el pip de ese entorno.'
}
foreach ($puerto in @(5051, 8000)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $puerto -ErrorAction SilentlyContinue) {
        throw "El puerto $puerto ya está ocupado. Cierra la ejecución anterior antes de iniciar otra."
    }
}
$entornoAnterior = $env:ASPNETCORE_ENVIRONMENT
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$procesoModelo = $null
try {
    $procesoModelo = Start-Process -FilePath $pythonProyecto -ArgumentList @('-m', 'uvicorn', 'inferencia:app', '--app-dir', 'ml_engine', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $raizProyecto -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $raizProyecto 'ml-servicio.log') -RedirectStandardError (Join-Path $raizProyecto 'ml-errores.log')
    $listo = $false
    for ($intento = 0; $intento -lt 30; $intento++) {
        if ($procesoModelo.HasExited) { throw 'No arrancó el modelo. Revisa ml-errores.log.' }
        try {
            $estado = Invoke-RestMethod 'http://127.0.0.1:8000/api/modelo' -TimeoutSec 2
            if ($estado.disponible) { $listo = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $listo) { throw 'El modelo no está disponible. Revisa ml-errores.log.' }
    Write-Host 'Swagger: http://localhost:5051/swagger'
    Write-Host 'Presiona Ctrl+C para detener la API y el servicio ML.'
    & dotnet run --project $proyectoApi --no-launch-profile --urls 'http://localhost:5051'
} finally {
    if ($procesoModelo -and -not $procesoModelo.HasExited) {
        Stop-Process -Id $procesoModelo.Id -ErrorAction SilentlyContinue
    }
    $env:ASPNETCORE_ENVIRONMENT = $entornoAnterior
}
