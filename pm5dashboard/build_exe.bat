@echo off
REM Build PM5Dashboard.exe (single-file Windows binary).
REM Requires that the venv in .venv has the requirements installed.

setlocal ENABLEEXTENSIONS
pushd "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo [error] No virtualenv found at .venv. Run:
    echo         py -3.11 -m venv .venv
    echo         .venv\Scripts\pip install -r requirements.txt
    exit /b 1
)

call .venv\Scripts\activate.bat

echo [build] cleaning previous output
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [build] running PyInstaller
python -m PyInstaller --clean --noconfirm PM5Dashboard.spec
if errorlevel 1 (
    echo [error] PyInstaller failed.
    exit /b 1
)

echo.
echo [done] Binary is at: dist\PM5Dashboard.exe
popd
endlocal
