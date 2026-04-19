@echo off
REM START_FRONTEND.cmd — Inicia el frontend React en modo desarrollo

title Bybit P2P Bot - Frontend

cd /d "%~dp0"

if not exist "frontend\node_modules" (
    echo [*] Instalando dependencias del frontend...
    cd frontend
    call npm install
    cd ..
)

echo [*] Iniciando frontend en http://localhost:3000
echo [*] Asegurate de que el backend ya este corriendo en :3001
echo.

cd frontend
npm start

pause
