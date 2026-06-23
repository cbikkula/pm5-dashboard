@echo off
REM Run PM5Dashboard from source using the .venv virtual environment.

setlocal ENABLEEXTENSIONS
pushd "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo [error] No virtualenv found at .venv. Run:
    echo         py -3.11 -m venv .venv
    echo         .venv\Scripts\pip install -r requirements.txt
    exit /b 1
)

call .venv\Scripts\activate.bat
python -m app %*
popd
endlocal
