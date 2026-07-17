$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root 'packages'
$Targets = @{
    'Webseite.zip' = 'C:\Users\xxps3\.chatgpt-work\HTML\Customagotchi'
    'Webseiten-App.zip' = 'C:\Users\xxps3\.chatgpt-work\Apps\Customagotchi'
    'Webseiten-Spiel.zip' = 'C:\Users\xxps3\.chatgpt-work\Spiele\Customagotchi'
}

foreach ($Entry in $Targets.GetEnumerator()) {
    $File = Join-Path $Source $Entry.Key
    if (-not (Test-Path -LiteralPath $File)) { throw "Paket fehlt: $File" }
    New-Item -ItemType Directory -Path $Entry.Value -Force | Out-Null
    Copy-Item -LiteralPath $File -Destination (Join-Path $Entry.Value $Entry.Key) -Force
    Write-Host "Kopiert: $($Entry.Key)" -ForegroundColor Green
}
