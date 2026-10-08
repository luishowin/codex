# Start the Codex daemon on Windows. Safe to run repeatedly.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LogDir = Join-Path $Root "_work\logs"
$OutLog = Join-Path $LogDir "codexd.out.log"
$ErrLog = Join-Path $LogDir "codexd.err.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Port = if ($env:CODEX_PORT) { $env:CODEX_PORT } else { "8765" }

# One daemon shows as two PIDs (venv redirector stub + base interpreter);
# match on the command line, never on the process name alone.
$running = Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
  Where-Object { $_.CommandLine -like '*codexd.py*' }
if ($running) {
  Write-Host "codexd already running (pid $($running.ProcessId -join ','))"
  exit 0
}

$Py = $null
if ($env:CODEX_PYTHON) { $Py = $env:CODEX_PYTHON }
elseif (Test-Path (Join-Path $Root ".venv\Scripts\python.exe")) {
  $Py = Join-Path $Root ".venv\Scripts\python.exe"
}
elseif (Get-Command py -ErrorAction SilentlyContinue) { $Py = "py" }
else {
  Write-Error "no Python found: create .venv in $Root (see README) or set CODEX_PYTHON"
  exit 1
}

Start-Process $Py -ArgumentList '-u',
  (Join-Path $Root 'app\codexd.py'),
  '--codex', (Join-Path $Root 'data\*.codex.db'),
  '--art', (Join-Path $Root 'data\art.db'),
  '--port', $Port,
  '-WindowStyle', 'Hidden',
  -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog |
  Out-Null

Write-Host "codexd starting - waiting for http://127.0.0.1:$Port/api/health"
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/api/health"
    if ($r.StatusCode -eq 200) {
      Write-Host "codexd up: http://127.0.0.1:$Port/"
      if ($env:CODEX_NO_BROWSER -ne "1") {
        Start-Process "http://127.0.0.1:$Port/"
      }
      exit 0
    }
  } catch { }
}
Write-Error "codexd did not come up in 90 s - see $ErrLog"
exit 1
