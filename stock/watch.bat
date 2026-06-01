@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE="

where python >nul 2>nul
if not errorlevel 1 (
    python --version >nul 2>nul
    if not errorlevel 1 set "PYTHON_EXE=python"
)

if not defined PYTHON_EXE (
    if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
        set "PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    )
)

if not defined PYTHON_EXE (
    where py >nul 2>nul
    if not errorlevel 1 (
        py --version >nul 2>nul
        if not errorlevel 1 set "PYTHON_EXE=py"
    )
)

if not defined PYTHON_EXE (
    echo Python was not found. Please install Python or add python/py to PATH.
    exit /b 1
)

"%PYTHON_EXE%" "%~dp0watch.py" %*
set "EXIT_CODE=%errorlevel%"

echo.
pause
exit /b %EXIT_CODE%
