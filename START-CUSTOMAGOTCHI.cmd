@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto :end
)
echo.
echo Python 3.11 oder neuer wurde nicht gefunden.
echo Bitte Python installieren und dieses Skript erneut starten.
pause
:end
endlocal
