@echo off
setlocal enabledelayedexpansion

REM Determine the absolute path of the directory containing this script
set "ROOT_DIR=%~dp0"

pushd "%ROOT_DIR%" >nul

REM Collect every package.json that is not inside node_modules and execute npm test in its directory
for /f "delims=" %%F in ('dir /b /s package.json ^| findstr /vi "\\node_modules\\"') do (
    set "PACKAGE_DIR=%%~dpF"
    pushd "!PACKAGE_DIR!" >nul
    echo.
    echo ================================
    echo Running npm test in !PACKAGE_DIR!
    echo ================================
    call npm test
    if errorlevel 1 (
        echo.
        echo npm test failed in !PACKAGE_DIR!
        popd >nul
        popd >nul
        pause
        exit /b 1
    )
    popd >nul
)

popd >nul

echo.
echo All project tests completed successfully.
pause
