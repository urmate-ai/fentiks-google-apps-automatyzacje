@echo off
setlocal enabledelayedexpansion

REM Determine the absolute path of the directory containing this script
set "ROOT_DIR=%~dp0"

pushd "%ROOT_DIR%" >nul

REM List of directories to run tests in
set "DIRS=BusinessCardAutomation GeminiEmailAutomation GmailKnowledgeSyncer InvoicesAutomation RagRefresherAutomation WooCommerceAutomatization"

REM Run npm test in each directory
for %%D in (%DIRS%) do (
    if exist "%%D" (
        pushd "%%D" >nul
        echo.
        echo ================================
        echo Running npm test in %%D
        echo ================================
        call npm test
        if errorlevel 1 (
            echo.
            echo npm test failed in %%D
            popd >nul
            popd >nul
            pause
            exit /b 1
        )
        popd >nul
    ) else (
        echo.
        echo Warning: Directory %%D does not exist, skipping...
    )
)

popd >nul

echo.
echo All project tests completed successfully.
pause
