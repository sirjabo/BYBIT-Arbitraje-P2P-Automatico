#!/bin/bash
# deploy.sh — Setup completo en Ubuntu 22.04 VPS
# Ejecutar como root o con sudo: bash deploy.sh
# Este script instala dependencias, configura el proyecto y lo deja corriendo con PM2.

set -euo pipefail

PROJECT_DIR="/opt/bybit-p2p-bot"
LOG_DIR="/var/log/bybit-p2p-bot"
NODE_VERSION="20"

echo "=================================================="
echo "  Bybit P2P Bot — Deploy Script"
echo "=================================================="

# ─── 1. Sistema base ──────────────────────────────────────────────────────────
echo "[1/7] Actualizando sistema..."
apt-get update -qq
apt-get install -y -qq curl git nginx ufw

# ─── 2. Node.js via NVM ───────────────────────────────────────────────────────
echo "[2/7] Instalando Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
echo "Node: $(node --version), npm: $(npm --version)"

# ─── 3. PM2 ───────────────────────────────────────────────────────────────────
echo "[3/7] Instalando PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ─── 4. Proyecto ─────────────────────────────────────────────────────────────
echo "[4/7] Configurando proyecto en ${PROJECT_DIR}..."
mkdir -p "$PROJECT_DIR" "$LOG_DIR"

# Copiar archivos del proyecto (asume que estás en el directorio del proyecto)
cp -r . "$PROJECT_DIR/"

# Instalar dependencias del backend
cd "${PROJECT_DIR}/backend"
npm install --omit=dev

# Build del frontend
cd "${PROJECT_DIR}/frontend"
npm install
npm run build

# ─── 5. .env ─────────────────────────────────────────────────────────────────
echo "[5/7] Configurando variables de entorno..."
if [ ! -f "${PROJECT_DIR}/backend/.env" ]; then
    cp "${PROJECT_DIR}/backend/.env.example" "${PROJECT_DIR}/backend/.env"
    echo ""
    echo "⚠️  IMPORTANTE: Editá el archivo .env antes de iniciar el bot:"
    echo "    nano ${PROJECT_DIR}/backend/.env"
    echo ""
fi

# ─── 6. Nginx ─────────────────────────────────────────────────────────────────
echo "[6/7] Configurando Nginx..."
cp "${PROJECT_DIR}/nginx.conf" /etc/nginx/sites-available/bybit-p2p-bot
ln -sf /etc/nginx/sites-available/bybit-p2p-bot /etc/nginx/sites-enabled/bybit-p2p-bot
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ─── 7. UFW Firewall ─────────────────────────────────────────────────────────
echo "[7/7] Configurando firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo ""
echo "=================================================="
echo "  Deploy completado!"
echo "=================================================="
echo ""
echo "Próximos pasos:"
echo "  1. Editá el .env con tus credenciales:"
echo "     nano ${PROJECT_DIR}/backend/.env"
echo ""
echo "  2. Iniciá el bot con PM2:"
echo "     cd ${PROJECT_DIR} && pm2 start ecosystem.config.js"
echo ""
echo "  3. Verificá que está corriendo:"
echo "     pm2 status"
echo "     pm2 logs bybit-p2p-bot"
echo ""
echo "  4. Dashboard en: http://$(curl -s ifconfig.me 2>/dev/null || echo 'tu-ip')"
echo ""
