@echo off
REM START.cmd — Launcher para desarrollo local en Windows
REM Inicia el backend Node.js. El frontend se sirve con `npm start` en otra terminal.

title Bybit P2P Bot

cd /d "%~dp0"

echo.
echo  ================================================
echo    Bybit P2P Bot - Backend
echo  ================================================
echo.

REM Verificar que existe .env
if not exist "backend\.env" (
    echo [!] No se encontro backend\.env
    echo [!] Copiando desde .env.example...
    copy "backend\.env.example" "backend\.env" >nul
    echo [!] Edita backend\.env con tus credenciales antes de continuar.
    pause
    exit /b 1
)

REM Instalar dependencias si no existen
if not exist "backend\node_modules" (
    echo [*] Instalando dependencias del backend...
    cd backend
    call npm install
    cd ..
)

echo [*] Iniciando backend en http://localhost:3001
echo [*] WebSocket en ws://localhost:3001/ws
echo.

cd backend
node src/index.js

pause
