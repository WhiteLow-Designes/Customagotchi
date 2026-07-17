$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Output = Join-Path $Root 'packages'
$Staging = Join-Path $Root '.build'

if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Recurse -Force }
New-Item -ItemType Directory -Path $Staging, $Output -Force | Out-Null

$Excluded = @('.build', 'packages', 'variants', '__pycache__', 'customagotchi.db', 'mail-outbox.log')
function Copy-Project([string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Root -Force | Where-Object { $Excluded -notcontains $_.Name } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $Destination 'data') -Force | Out-Null
    Remove-Item -LiteralPath (Join-Path $Destination 'data\customagotchi.db') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Destination 'data\mail-outbox.log') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Destination '__pycache__') -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $Destination -Directory -Recurse -Filter '__pycache__' | Remove-Item -Recurse -Force
}

$Web = Join-Path $Staging 'Webseite'
$App = Join-Path $Staging 'Webseiten-App'
$Game = Join-Path $Staging 'Webseiten-Spiel'
Copy-Project $Web
Copy-Project $App
Copy-Project $Game

# Die klassische Webseiten-Version besitzt keine Installationsregistrierung.
$WebIndex = Join-Path $Web 'static\index.html'
$WebHtml = Get-Content -LiteralPath $WebIndex -Raw
$WebHtml = $WebHtml.Replace('  <link rel="manifest" href="/manifest.webmanifest">', '')
Set-Content -LiteralPath $WebIndex -Value $WebHtml -Encoding utf8
Remove-Item -LiteralPath (Join-Path $Web 'static\manifest.webmanifest') -Force
Remove-Item -LiteralPath (Join-Path $Web 'static\sw.js') -Force
Remove-Item -LiteralPath (Join-Path $Web 'START-SPIEL.cmd') -Force

# Die App-Version startet regulär; nur das Spiele-Paket erhält den Direktstart.
Remove-Item -LiteralPath (Join-Path $App 'START-SPIEL.cmd') -Force

Copy-Item -LiteralPath (Join-Path $Root 'variants\Webseite.txt') -Destination (Join-Path $Web 'PAKET-VERSION.txt')
Copy-Item -LiteralPath (Join-Path $Root 'variants\Webseiten-App.txt') -Destination (Join-Path $App 'PAKET-VERSION.txt')
Copy-Item -LiteralPath (Join-Path $Root 'variants\Webseiten-Spiel.txt') -Destination (Join-Path $Game 'PAKET-VERSION.txt')

Compress-Archive -Path (Join-Path $Web '*') -DestinationPath (Join-Path $Output 'Webseite.zip') -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $App '*') -DestinationPath (Join-Path $Output 'Webseiten-App.zip') -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $Game '*') -DestinationPath (Join-Path $Output 'Webseiten-Spiel.zip') -CompressionLevel Optimal

Write-Host "Pakete erstellt unter $Output" -ForegroundColor Green
