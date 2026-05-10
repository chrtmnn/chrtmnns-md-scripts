@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0md2pdf.ps1" %*
exit /b %ERRORLEVEL%
