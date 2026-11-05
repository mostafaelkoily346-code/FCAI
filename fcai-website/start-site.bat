@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/v1/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  start "FCAI site server" cmd /k "cd /d ""%~dp0"" && npm start"
  timeout /t 3 /nobreak >nul
)

start "" "http://127.0.0.1:8080/#admin"
endlocal
