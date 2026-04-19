# Bybit P2P Arbitrage Bot 🤖

Automatiza la actualización de precios de tus anuncios P2P en Bybit para capturar el máximo spread posible. El bot monitorea el mercado en tiempo real y ajusta tus precios cada 15 segundos para posicionarte entre el top1 y top2 de cada lado.

## Características

✅ **Actualización automática de precios** - Cada 15 segundos basado en el mercado  
✅ **Modo agresivo** - Se posiciona 1 ARS por encima/debajo del top1  
✅ **Spread mínimo garantizado** - Piso de 0.3% para evitar pérdidas  
✅ **Control en tiempo real** - Dashboard con start/stop/sync  
✅ **WebSocket live** - Estado actualizado al instante  
✅ **Rate limiting** - Respeta los límites de Bybit  
✅ **Logging detallado** - Monitorea cada acción  

## Tech Stack

- **Backend**: Node.js + Express + WebSocket
- **Frontend**: React + Hooks
- **API**: Bybit P2P v5 (con manejo de snake_case)
- **Hosting**: Render.com (24/7)

## Instalación Local

### Prerequisites
- Node.js 16+
- npm/yarn
- Credenciales Bybit P2P (API Key + Secret)
- Buy Ad ID (obtén de tu dashboard P2P)

### Setup

1. **Clone y instala dependencias**
```bash
cd bybit-p2p-bot

# Backend
cd backend
npm install

# Frontend (en otra terminal)
cd ../frontend
npm install
```

2. **Configura variables de entorno**
```bash
# backend/.env (copia desde .env.example)
cp .env.example .env
# Edita con tus credenciales Bybit
```

3. **Inicia los servicios**
```bash
# Terminal 1: Backend
cd backend && npm start

# Terminal 2: Frontend
cd frontend && npm start
```

4. **Abre en navegador**
```
http://localhost:3000
```

## Configuración

### Archivos importantes

- `backend/.env` - Credenciales y parámetros del bot
- `backend/src/core/pricingEngine.js` - Lógica de cálculo de precios
- `backend/src/config/index.js` - Configuración centralizada

### Parámetros ajustables

```env
# Spread mínimo (0.3% = muy agresivo, 1% = conservador)
MIN_SPREAD_PERCENT=0.3

# Cuántos ARS más/menos que el top1 (default 1 ARS)
TICK_SIZE=1.0

# Cambio mínimo para actualizar (0.15% = sensible)
MIN_CHANGE_THRESHOLD_PERCENT=0.15

# Frecuencia de actualización (15 segundos)
UPDATE_INTERVAL_MS=15000
```

## Cómo funciona

### Lógica de precios (Modo Agresivo)

**Tu precio de COMPRA (BUY_AD)**
- Se posiciona 1 ARS **por encima** del vendedor más barato del mercado
- Atrae vendedores ofreciendo el mejor precio (excepto el top1)

**Tu precio de VENTA (SELL_AD)**
- Se posiciona 1 ARS **por debajo** del comprador que más paga
- Atrae compradores ofreciendo el mejor precio (excepto el top1)

**Spread mínimo**
- Si el mercado está muy comprimido, ignora el mercado y aplica 0.3% de spread desde el midpoint
- Esto previene trades con pérdida

## API Endpoints

```
POST /api/bot/start           - Inicia el bot
POST /api/bot/stop            - Detiene el bot
POST /api/bot/sync            - Sincroniza precios actuales desde Bybit
POST /api/bot/force-cycle     - Fuerza una actualización inmediata
GET  /api/status              - Estado actual del bot
GET  /api/config              - Configuración actual
POST /api/config/pricing      - Actualiza config de precios
POST /api/config/bot          - Actualiza config del bot
```

## WebSocket

```
ws://localhost:3002/ws

Messages:
- { type: 'state', payload: botSnapshot }
- { type: 'log', payload: logEntry }
```

## Deploy en Render.com

1. **Push a GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/sirjabo/BYBIT-Arbitraje-P2P-Automatico
git push -u origin main
```

2. **En Render.com**
   - Conecta tu GitHub repo
   - Configura variables de entorno (BYBIT_API_KEY, BYBIT_API_SECRET, etc)
   - Deploy automático listo

## Troubleshooting

### "WebSocket desconectado"
- Verifica que backend está corriendo en port 3002
- Abre DevTools → Console y busca errores

### "Parameter exception" en Bybit API
- Verifica que BUY_AD_ID sea válido
- Asegúrate de que el API Key tenga permisos P2P

### Bot no actualiza precios
- Revisa los logs en `/api/status` → `logs`
- Verifica `MIN_CHANGE_THRESHOLD_PERCENT` no sea muy alto

## Disclaimer

⚠️ Este bot ajusta precios automáticamente. Úsalo bajo tu propio riesgo. Asegúrate de:
- Entender la lógica de precios antes de correrlo
- Tener fondos suficientes en tus ads
- Monitorear regularmente los logs

## License

MIT

---

Made with ❤️ for P2P traders
