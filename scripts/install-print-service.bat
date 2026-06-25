@echo off
title BVR Print Bridge - Service Installer
echo ============================================
echo   BVR PRINT BRIDGE - WINDOWS SERVICE SETUP
echo ============================================
echo.

:: Check for admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] This script must be run as Administrator!
    echo Right-click this file and select "Run as administrator"
    pause
    exit /b 1
)

:: Find node.exe
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js first from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('where node') do set NODE_PATH=%%i
echo [OK] Found Node.js at: %NODE_PATH%

:: Check if the bridge script exists
set BRIDGE_SCRIPT=%USERPROFILE%\Downloads\local-print-bridge.mjs
if not exist "%BRIDGE_SCRIPT%" (
    echo [ERROR] local-print-bridge.mjs not found at %BRIDGE_SCRIPT%
    echo Please copy local-print-bridge.mjs to your Downloads folder first.
    pause
    exit /b 1
)
echo [OK] Found bridge script at: %BRIDGE_SCRIPT%

:: Download and extract NSSM if not present
set NSSM_DIR=%USERPROFILE%\Downloads\nssm
set NSSM_EXE=%NSSM_DIR%\nssm.exe

if not exist "%NSSM_EXE%" (
    echo.
    echo [INFO] Downloading NSSM...
    mkdir "%NSSM_DIR%" 2>nul
    
    powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%USERPROFILE%\Downloads\nssm.zip'"
    
    if not exist "%USERPROFILE%\Downloads\nssm.zip" (
        echo [ERROR] Failed to download NSSM. Please download manually from https://nssm.cc/download
        echo Extract nssm.exe to %NSSM_DIR%\nssm.exe
        pause
        exit /b 1
    )
    
    powershell -Command "Expand-Archive -Path '%USERPROFILE%\Downloads\nssm.zip' -DestinationPath '%USERPROFILE%\Downloads\nssm-temp' -Force"
    copy "%USERPROFILE%\Downloads\nssm-temp\nssm-2.24\win64\nssm.exe" "%NSSM_EXE%" >nul
    
    rmdir /s /q "%USERPROFILE%\Downloads\nssm-temp" 2>nul
    del "%USERPROFILE%\Downloads\nssm.zip" 2>nul
    
    if not exist "%NSSM_EXE%" (
        echo [ERROR] Failed to extract NSSM.
        pause
        exit /b 1
    )
    echo [OK] NSSM downloaded and extracted.
) else (
    echo [OK] NSSM already present.
)

:: Stop and remove existing service if present
echo.
echo [INFO] Removing old service if it exists...
"%NSSM_EXE%" stop BVRPrintBridge >nul 2>&1
timeout /t 2 /nobreak >nul
"%NSSM_EXE%" remove BVRPrintBridge confirm >nul 2>&1
timeout /t 1 /nobreak >nul

:: Install the service
echo.
echo [INFO] Installing BVR Print Bridge as Windows service...
"%NSSM_EXE%" install BVRPrintBridge "%NODE_PATH%" "%BRIDGE_SCRIPT%"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to install service!
    pause
    exit /b 1
)

:: Configure service settings
echo [INFO] Configuring service...

"%NSSM_EXE%" set BVRPrintBridge AppDirectory "%USERPROFILE%\Downloads"
"%NSSM_EXE%" set BVRPrintBridge DisplayName "BVR Network Print Bridge"
"%NSSM_EXE%" set BVRPrintBridge Description "Local network print bridge for BVR Restaurant thermal printers (ESC/POS on port 9100)"
"%NSSM_EXE%" set BVRPrintBridge Start SERVICE_AUTO_START
"%NSSM_EXE%" set BVRPrintBridge AppExit Default Restart
"%NSSM_EXE%" set BVRPrintBridge AppRestartDelay 5000

:: Log output to files for debugging
set LOG_DIR=%USERPROFILE%\Downloads\bvr-print-logs
mkdir "%LOG_DIR%" 2>nul
"%NSSM_EXE%" set BVRPrintBridge AppStdout "%LOG_DIR%\bridge-output.log"
"%NSSM_EXE%" set BVRPrintBridge AppStderr "%LOG_DIR%\bridge-error.log"
"%NSSM_EXE%" set BVRPrintBridge AppStdoutCreationDisposition 4
"%NSSM_EXE%" set BVRPrintBridge AppStderrCreationDisposition 4
"%NSSM_EXE%" set BVRPrintBridge AppRotateFiles 1
"%NSSM_EXE%" set BVRPrintBridge AppRotateBytes 1048576

echo [OK] Service configured.

:: Start the service
echo.
echo [INFO] Starting the service...
"%NSSM_EXE%" start BVRPrintBridge

timeout /t 3 /nobreak >nul

:: Verify it's running
sc query BVRPrintBridge | findstr "RUNNING" >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   SUCCESS! Print Bridge is now running as
    echo   a Windows service.
    echo.
    echo   - Auto-starts on PC boot
    echo   - Auto-restarts on crash
    echo   - Runs silently in background
    echo   - No terminal window needed
    echo.
    echo   Kitchen Printer:  192.168.1.100:9100
    echo   Counter Printer:  192.168.1.110:9100
    echo   Bridge URL:       http://127.0.0.1:9123
    echo.
    echo   Logs: %LOG_DIR%\
    echo ============================================
) else (
    echo.
    echo [WARNING] Service installed but may not be running yet.
    echo Check status with: sc query BVRPrintBridge
    echo Check logs at: %LOG_DIR%\
)

echo.
pause
