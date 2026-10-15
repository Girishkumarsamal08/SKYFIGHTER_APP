# SKYFIGHTER PowerShell Desktop Launcher (Windows 10/11)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$IndexPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "..\web\index.html"))
$FileUri = [System.Uri]::new($IndexPath).AbsoluteUri

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  SKYFIGHTER UAV Ground Control Station (Windows)" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

# Try launching via Edge App Mode
$EdgePaths = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)

foreach ($Path in $EdgePaths) {
    if (Test-Path $Path) {
        Write-Host "Launching via Microsoft Edge Standalone App..." -ForegroundColor Green
        Start-Process $Path -ArgumentList "--app=`"$FileUri`"", "--window-size=1280,820"
        exit 0
    }
}

# Fallback
Write-Host "Launching via default browser..." -ForegroundColor Yellow
Start-Process $FileUri
