# Is the daemon running, and is it healthy? (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\windows\status.ps1
$ErrorActionPreference = "Stop"

$Port = if ($env:CODEX_PORT) { $env:CODEX_PORT } else { "8765" }

$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
  Where-Object { $_.CommandLine -like '*codexd.py*' }
if ($procs) {
  Write-Host "codexd : running (pid $($procs.ProcessId -join ','))"
} else {
  Write-Host "codexd : not running"
}

try {
  $h = Invoke-RestMethod -TimeoutSec 3 "http://127.0.0.1:$Port/api/health"
  Write-Host "health : ok - http://127.0.0.1:$Port/"
  Write-Host ("codexes: " + (($h.codexes | ForEach-Object { $_.name }) -join ", "))
} catch {
  Write-Host "health : no response on port $Port"
}
