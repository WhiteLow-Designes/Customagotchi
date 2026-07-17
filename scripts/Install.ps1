$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) {
    $Launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($Launcher) { & $Launcher.Source -3 server.py --init-only; exit $LASTEXITCODE }
    throw 'Python 3.11 oder neuer wurde nicht gefunden.'
}

& $Python.Source server.py --init-only
if ($LASTEXITCODE -ne 0) { throw 'Die Datenbank konnte nicht eingerichtet werden.' }
Write-Host 'Customagotchi ist eingerichtet. Starte START-CUSTOMAGOTCHI.cmd.' -ForegroundColor Green
