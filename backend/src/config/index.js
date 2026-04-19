// src/config/index.js
require('dotenv').config();

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function parseFloat_(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseFloat(val);
  if (isNaN(n)) throw new Error(`Invalid float for env var ${key}: ${val}`);
  return n;
}

function parseInt_(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`Invalid int for env var ${key}: ${val}`);
  return n;
}

const config = {
  bybit: {
    apiKey: requireEnv('BYBIT_API_KEY'),
    apiSecret: requireEnv('BYBIT_API_SECRET'),
    baseUrl: process.env.BYBIT_BASE_URL || 'https://api.bybit.com',
    buyAdId: requireEnv('BUY_AD_ID'),
    sellAdId: process.env.SELL_AD_ID || '',
  },
  pricing: {
    minSpreadPercent:          parseFloat_('MIN_SPREAD_PERCENT', 0.3),
    tickSize:                  parseFloat_('TICK_SIZE', 1.0),
    minChangeThresholdPercent: parseFloat_('MIN_CHANGE_THRESHOLD_PERCENT', 0.15),
  },
  bot: {
    updateIntervalMs: parseInt_('UPDATE_INTERVAL_MS', 15000),
    cooldownAfterUpdateMs: parseInt_('COOLDOWN_AFTER_UPDATE_MS', 30000),
    maxUpdatesPer5Min: parseInt_('MAX_UPDATES_PER_5MIN', 10),
    maxRequestsPerSec: parseInt_('MAX_REQUESTS_PER_SEC', 5),
  },
  server: {
    port: parseInt_('PORT', 3001),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
