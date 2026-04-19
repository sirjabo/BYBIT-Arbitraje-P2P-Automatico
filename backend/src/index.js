// src/index.js
// Entry point: wires all modules together and starts the HTTP+WS server.

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const { createLogger } = require('./utils/logger');
const { RateLimiter } = require('./utils/rateLimiter');
const { BybitClient } = require('./api/bybitClient');
const { PricingEngine } = require('./core/pricingEngine');
const { StateManager } = require('./core/stateManager');
const { BotEngine } = require('./core/botEngine');
const { WSServer } = require('./modules/wsServer');
const { createRouter } = require('./api/routes');

const log = createLogger('App');

async function main() {
  log.info('Initializing Bybit P2P Bot...');
  log.info(`Environment: buyAdId=${config.bybit.buyAdId}, sellAdId=${config.bybit.sellAdId}`);
  log.info(`Pricing: minSpread=${config.pricing.minSpreadPercent}%, tickSize=${config.pricing.tickSize || 1.0}`);

  // ─── Instantiate modules ──────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter(config);
  const bybitClient = new BybitClient(config, rateLimiter);
  const pricingEngine = new PricingEngine(config);
  const stateManager = new StateManager();

  const botEngine = new BotEngine({
    bybitClient,
    pricingEngine,
    rateLimiter,
    stateManager,
    config,
  });

  // ─── Express + HTTP server ────────────────────────────────────────────────────
  const app = express();

  app.use(cors({
    origin: '*', // Tighten in production
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  }));

  app.use(express.json());

  // API routes under /api
  const router = createRouter(botEngine, stateManager, config);
  app.use('/api', router);

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, '../public')));

  // SPA fallback: serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // Global error handler
  app.use((err, req, res, next) => {
    log.error('Unhandled express error', { error: err.message });
    res.status(500).json({ ok: false, error: 'Internal server error' });
  });

  const httpServer = http.createServer(app);

  // ─── WebSocket server ─────────────────────────────────────────────────────────
  const wsServer = new WSServer(httpServer, stateManager);
  wsServer.startHeartbeat(30000);

  // ─── Start HTTP server ────────────────────────────────────────────────────────
  await new Promise((resolve) => {
    httpServer.listen(config.server.port, () => {
      log.info(`Server listening on http://0.0.0.0:${config.server.port}`);
      log.info(`WebSocket endpoint: ws://0.0.0.0:${config.server.port}/ws`);
      resolve();
    });
  });

  // ─── Sync current prices before starting ─────────────────────────────────────
  log.info('Syncing current ad prices from Bybit...');
  await botEngine.syncCurrentPrices().catch(err => {
    log.warn(`Initial price sync failed: ${err.message} — bot will sync on first cycle`);
  });

  log.info('Bot ready. Use POST /api/bot/start to begin automated trading.');
  stateManager.addLog('info', 'System initialized and ready');

  // ─── Graceful shutdown ────────────────────────────────────────────────────────
  const shutdown = (signal) => {
    log.info(`Received ${signal} — shutting down`);
    botEngine.stop();
    httpServer.close(() => {
      log.info('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 5s if graceful close hangs
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
    stateManager.addLog('error', `Uncaught exception: ${err.message}`);
    // Don't exit — keep bot running. Log and recover.
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
    stateManager.addLog('error', `Unhandled rejection: ${String(reason)}`);
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
