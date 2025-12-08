@echo off
setlocal enabledelayedexpansion

REM Determine the absolute path of the directory containing this script
set "ROOT_DIR=%~dp0"
set "LOG_FILE=%ROOT_DIR%test-results.log"

pushd "%ROOT_DIR%" >nul

REM Clear previous log file
> "%LOG_FILE%" echo Test run started at %date% %time%

REM List of directories to run tests in
set "DIRS=BusinessCardAutomation GmailDraftsAutomation\GeminiEmailAutomation GmailDraftsAutomation\GmailKnowledgeSyncer GmailDraftsAutomation\RagRefresherAutomation GmailDraftsAutomation\ScheduleScraper InvoicesAutomation WooCommerceAutomatization"

set "FAILED_COUNT=0"
set "PASSED_COUNT=0"

REM Run npm test in each directory
for %%D in (%DIRS%) do (
    if exist "%%D" (
        pushd "%%D" >nul
        echo.
        echo ================================
        echo Running npm test in %%D
        echo ================================
        >> "%LOG_FILE%" echo.
        >> "%LOG_FILE%" echo ================================
        >> "%LOG_FILE%" echo Running npm test in %%D
        >> "%LOG_FILE%" echo ================================
        call npm test >> "%LOG_FILE%" 2>&1
        set "TEST_RESULT=!errorlevel!"
        if !TEST_RESULT! neq 0 (
            echo npm test FAILED in %%D ^(error code: !TEST_RESULT!^)
            >> "%LOG_FILE%" echo.
            >> "%LOG_FILE%" echo *** npm test FAILED in %%D with error code !TEST_RESULT! ***
            set /a FAILED_COUNT+=1
        ) else (
            echo npm test PASSED in %%D
            >> "%LOG_FILE%" echo.
            >> "%LOG_FILE%" echo *** npm test PASSED in %%D ***
            set /a PASSED_COUNT+=1
        )
        popd >nul
    ) else (
        echo.
        echo Warning: Directory %%D does not exist, skipping...
        >> "%LOG_FILE%" echo Warning: Directory %%D does not exist, skipping...
    )
)

popd >nul

echo.
echo ================================
echo Test Summary
echo ================================
echo Passed: %PASSED_COUNT%
echo Failed: %FAILED_COUNT%
echo.
>> "%LOG_FILE%" echo.
>> "%LOG_FILE%" echo ================================
>> "%LOG_FILE%" echo Test Summary
>> "%LOG_FILE%" echo ================================
>> "%LOG_FILE%" echo Passed: %PASSED_COUNT%
>> "%LOG_FILE%" echo Failed: %FAILED_COUNT%

if %FAILED_COUNT% gtr 0 (
    echo.
    echo Some tests failed. Check %LOG_FILE% for details.
    exit /b 1
) else (
    echo.
    echo All project tests completed successfully.
    >> "%LOG_FILE%" echo.
    >> "%LOG_FILE%" echo All project tests completed successfully.
)

echo.
echo Full test results saved to: %LOG_FILE%
echo.
pause
