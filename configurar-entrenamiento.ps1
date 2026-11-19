$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\pythonw.exe'
$script = Join-Path $root 'ml_engine\ciclo_automatico.py'
if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $script)) { throw 'Falta preparar Python o el ciclo automático.' }
$backup = Join-Path $root 'backups\tareas'
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$task = Get-ScheduledTask -TaskName 'SCCA_Entrenamiento_ML' -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $python -Argument ('-u "' + $script + '"') -WorkingDirectory $root
if ($task) {
    Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Set-Content -LiteralPath (Join-Path $backup ('entrenamiento-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml'))
    Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $action -ErrorAction Stop | Out-Null
} else {
    if ((Get-TimeZone).BaseUtcOffset.TotalHours -ne -4) { throw 'Configura primero la programación para America/La_Paz (UTC-4).' }
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '10:00'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName 'SCCA_Entrenamiento_ML' -Action $action -Trigger $trigger -Settings $settings -Description 'Preparación y evaluación ML. Solo activa candidatos aptos de demostración y conserva la versión anterior.' | Out-Null
}
Write-Output 'Tarea adaptada al ciclo evaluado. Se conserva la programación existente y el XML anterior.'
