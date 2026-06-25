@echo off
title BVR Order Alert - Startup Installer
echo ============================================
echo   BVR ORDER ALERT - STARTUP INSTALLER
echo ============================================
echo.

:: Find node.exe
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('where node') do set NODE_PATH=%%i
echo [OK] Found Node.js at: %NODE_PATH%

:: Check if the alert script exists
set ALERT_SCRIPT=%USERPROFILE%\Downloads\order-alert.mjs
if not exist "%ALERT_SCRIPT%" (
    echo [ERROR] order-alert.mjs not found at %ALERT_SCRIPT%
    echo Please copy order-alert.mjs to your Downloads folder first.
    pause
    exit /b 1
)
echo [OK] Found alert script at: %ALERT_SCRIPT%

:: Check if sound file exists
set SOUND_FILE=%USERPROFILE%\Downloads\swiggy_new_order.mp3.mpeg
if not exist "%SOUND_FILE%" (
    echo [WARNING] swiggy_new_order.mp3.mpeg not found in Downloads.
    echo The script will use system beep instead.
    echo For best results, copy swiggy_new_order.mp3.mpeg to Downloads.
    echo.
)

:: Create a VBS wrapper to run node silently (no visible window)
set VBS_FILE=%USERPROFILE%\Downloads\bvr-order-alert.vbs
echo Creating silent launcher...
(
    echo Set objShell = CreateObject("WScript.Shell"^)
    echo objShell.Run """" ^& "%NODE_PATH%" ^& """ """ ^& "%ALERT_SCRIPT%" ^& """", 0, False
) > "%VBS_FILE%"
echo [OK] Silent launcher created at: %VBS_FILE%

:: Create shortcut in Windows Startup folder
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_FOLDER%\BVR Order Alert.lnk

echo Creating startup shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%VBS_FILE%'; $s.WorkingDirectory = '%USERPROFILE%\Downloads'; $s.Description = 'BVR Restaurant New Order Alert Sound'; $s.Save()"

if exist "%SHORTCUT%" (
    echo [OK] Startup shortcut created.
) else (
    echo [ERROR] Failed to create startup shortcut.
    pause
    exit /b 1
)

:: Start the alert now
echo.
echo [INFO] Starting order alert now...
start "" wscript.exe "%VBS_FILE%"

echo.
echo ============================================
echo   SUCCESS! Order Alert is now set up.
echo.
echo   - Runs silently in background
echo   - Auto-starts when someone logs in
echo   - Plays alert sound on new orders
echo   - No browser needed
echo.
echo   To stop: Open Task Manager, find "node"
echo   and end the order-alert process.
echo.
echo   Sound file: %SOUND_FILE%
echo ============================================
echo.
pause
