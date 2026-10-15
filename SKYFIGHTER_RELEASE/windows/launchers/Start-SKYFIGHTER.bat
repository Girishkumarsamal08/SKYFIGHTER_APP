@echo off
setlocal
title SKYFIGHTER Ground Control Station
echo ========================================================
echo   SKYFIGHTER — Forest Fire Drone Ground Control Station
echo   Zero-Cost Cross-Platform Desktop Edition (Windows)
echo ========================================================
echo.

set SCRIPT_DIR=%~dp0
set WEB_DIR=%SCRIPT_DIR%..\web
set INDEX_PATH=%WEB_DIR%\index.html

:: Check for Microsoft Edge
where msedge >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Launching SKYFIGHTER in standalone Edge App mode...
    start msedge --app="file:///%INDEX_PATH:\=/%" --window-size=1280,820
    exit /b 0
)

:: Check for Google Chrome
where chrome >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Launching SKYFIGHTER in standalone Chrome App mode...
    start chrome --app="file:///%INDEX_PATH:\=/%" --window-size=1280,820
    exit /b 0
)

:: Fallback to default browser
echo Launching in default web browser...
start "" "%INDEX_PATH%"
exit /b 0
