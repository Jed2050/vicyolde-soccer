@echo off
echo.
echo  ⚽ VICYOLDE SOCCER Blog — First Time Setup
echo  ==========================================
echo.
echo  Installing Node.js dependencies...
echo.
call npm install
echo.
if %ERRORLEVEL% EQU 0 (
  echo  ✓ Installation complete!
  echo.
  echo  Run start.bat to launch your blog.
  echo.
) else (
  echo  ✗ Installation failed. Make sure Node.js is installed:
  echo    https://nodejs.org
  echo.
)
pause
