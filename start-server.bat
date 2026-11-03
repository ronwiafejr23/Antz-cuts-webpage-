@echo off
REM Double-click to run the Antz Cuts site with PayPal deposits.
REM I keep this window open while testing; closing it stops the server.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org & pause & exit /b)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/book.html"
node server.js
pause
