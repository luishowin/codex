# Stop the Codex daemon on Windows. Safe to run when nothing is running.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\windows\stop.ps1
$ErrorActionPreference = "Stop"

# Match on the command line: one daemon is two PIDs (venv redirector stub +
# base interpreter child), and filtering on the executable name alone misses
# whichever one is not the stub.
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
  Where-Object { $_.CommandLine -like '*codexd.py*' }
if (-not $procs) {
  Write-Host "no codexd running"
  exit 0
}
foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force
  Write-Host "stopped pid $($p.ProcessId)"
}
Write-Host "codexd stopped"
