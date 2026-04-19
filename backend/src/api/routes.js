// src/api/routes.js
// Express REST API routes. Used for configuration and manual commands.
// Real-time data flows through WebSocket.

const express = require('express');

function createRouter(botEngine, stateManager, config) {
  const router = express.Router();

  // ─── Status ───────────────────────────────────────────────────────────────────

  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      snapshot: stateManager.getSnapshot(),
    });
  });

  router.get('/health', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // ─── Bot Control ─────────────────────────────────────────────────────────────

  router.post('/bot/start', async (req, res) => {
    try {
      if (stateManager.isRunning()) {
        return res.status(400).json({ ok: false, error: 'Bot is already running' });
      }
      await botEngine.start();
      res.json({ ok: true, message: 'Bot started' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/bot/stop', (req, res) => {
    botEngine.stop();
    res.json({ ok: true, message: 'Bot stopped' });
  });

  router.post('/bot/sync', async (req, res) => {
    try {
      await botEngine.syncCurrentPrices();
      res.json({ ok: true, message: 'Prices synced' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/bot/force-cycle', async (req, res) => {
    try {
      await botEngine.forceRefresh();
      res.json({ ok: true, message: 'Cycle triggered' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Config ───────────────────────────────────────────────────────────────────

  router.get('/config', (req, res) => {
    res.json({
      ok: true,
      pricing: botEngine.pricing.getConfig(),
      bot: {
        updateIntervalMs: config.bot.updateIntervalMs,
        cooldownAfterUpdateMs: config.bot.cooldownAfterUpdateMs,
        maxUpdatesPer5Min: config.bot.maxUpdatesPer5Min,
      },
      adIds: {
        buyAdId: config.bybit.buyAdId,
        sellAdId: config.bybit.sellAdId,
      },
    });
  });

  router.post('/config/pricing', (req, res) => {
    const { minSpreadPercent, safetyMarginPercent, minChangeThresholdPercent } = req.body;
    const updates = {};

    if (minSpreadPercent !== undefined) {
      const v = parseFloat(minSpreadPercent);
      if (isNaN(v) || v < 0.1 || v > 20) {
        return res.status(400).json({ ok: false, error: 'minSpreadPercent must be between 0.1 and 20' });
      }
      updates.minSpreadPercent = v;
    }

    if (safetyMarginPercent !== undefined) {
      const v = parseFloat(safetyMarginPercent);
      if (isNaN(v) || v < 0 || v > 5) {
        return res.status(400).json({ ok: false, error: 'safetyMarginPercent must be between 0 and 5' });
      }
      updates.safetyMarginPercent = v;
    }

    if (minChangeThresholdPercent !== undefined) {
      const v = parseFloat(minChangeThresholdPercent);
      if (isNaN(v) || v < 0 || v > 5) {
        return res.status(400).json({ ok: false, error: 'minChangeThresholdPercent must be 0-5' });
      }
      updates.minChangeThresholdPercent = v;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid fields provided' });
    }

    botEngine.updatePricingConfig(updates);
    res.json({ ok: true, message: 'Pricing config updated', updates });
  });

  router.post('/config/bot', (req, res) => {
    const { updateIntervalMs, cooldownAfterUpdateMs } = req.body;
    const updates = {};

    if (updateIntervalMs !== undefined) {
      const v = parseInt(updateIntervalMs, 10);
      if (isNaN(v) || v < 5000 || v > 300000) {
        return res.status(400).json({ ok: false, error: 'updateIntervalMs must be 5000-300000ms' });
      }
      updates.updateIntervalMs = v;
    }

    if (cooldownAfterUpdateMs !== undefined) {
      const v = parseInt(cooldownAfterUpdateMs, 10);
      if (isNaN(v) || v < 0 || v > 600000) {
        return res.status(400).json({ ok: false, error: 'cooldownAfterUpdateMs must be 0-600000ms' });
      }
      updates.cooldownAfterUpdateMs = v;
    }

    botEngine.updateBotConfig(updates);
    res.json({ ok: true, message: 'Bot config updated', updates });
  });

  // ─── Logs ────────────────────────────────────────────────────────────────────

  router.get('/logs', (req, res) => {
    const n = Math.min(parseInt(req.query.n || '100', 10), 500);
    res.json({ ok: true, logs: stateManager.getRecentLogs(n) });
  });

  return router;
}

module.exports = { createRouter };
