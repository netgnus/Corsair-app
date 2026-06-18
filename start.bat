@echo off
REM ---- iPad Dock launcher ----
REM Double-click this file to start the dock.
cd /d "%~dp0"

REM Install dependencies the first time (if node_modules is missing)
if not exist "node_modules\" (
    echo First run - installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Make sure Node.js is installed: https://nodejs.org
        pause
        exit /b 1
    )
)

REM Launch the app
call npm start
