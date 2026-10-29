@echo off
rem Runs the training app on this computer with made-up people, at http://localhost:3100
cd /d "%~dp0"
if not exist node_modules call npm install --no-audit --no-fund
start "" http://localhost:3100
npm run try
pause
