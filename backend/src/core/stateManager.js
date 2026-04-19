// src/core/stateManager.js
// Central state store for the bot. All modules read/write state here.
// Emits events for WebSocket broadcast.

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const log = createLogger('StateManager');

const MAX_HISTORY = 200; // Keep last 200 price snapshots
const MAX_LOG_ENTRIES = 500;

class StateManager extends EventEmitter {
  constructor() {
    super();
    this.botRunning = false;
    this.lastError = null;
    this.cycleCount = 0;
    this.lastCycleAt = null;
    this.startedAt = null;

    this.market = {
      bestBuyPrice: null,
      secondBuyPrice: null,
      bestSellPrice: null,
      secondSellPrice: null,
      marketSpreadPercent: null,
      fetchedAt: null,
    };

    this.ownAds = {
      buy: {
        id: null,
        currentPrice: null,
        targetPrice: null,
        lastUpdatedAt: null,
        updatesInWindow: 0,
        lastUpdateResult: null,
      },
      sell: {
        id: null,
        currentPrice: null,
        targetPrice: null,
        lastUpdatedAt: null,
        updatesInWindow: 0,
        lastUpdateResult: null,
      },
    };

    this.pricing = {
      spreadPercent: null,
      minSpreadPercent: null,
      refBuyPrice: null,
      refSellPrice: null,
    };

    this.priceHistory = []; // [{ts, buyPrice, sellPrice, spreadPct, marketBuy, marketSell}]
    this.logEntries = []; // [{ts, level, message, data}]
  }

  // ─── Bot Control ─────────────────────────────────────────────────────────────

  setRunning(running) {
    this.botRunning = running;
    if (running && !this.startedAt) this.startedAt = new Date().toISOString();
    if (!running) this.startedAt = null;
    this._emit();
  }

  isRunning() {
    return this.botRunning;
  }

  // ─── Market State ─────────────────────────────────────────────────────────────

  updateMarket(market) {
    this.market = {
      bestBuyPrice: market.bestBuyPrice,
      secondBuyPrice: market.secondBuyPrice,
      bestSellPrice: market.bestSellPrice,
      secondSellPrice: market.secondSellPrice,
      marketSpreadPercent: market.marketSpreadPercent,
      fetchedAt: new Date().toISOString(),
      topBuyAd: market.bestBuyAd
        ? { nickName: market.bestBuyAd.nickName, price: market.bestBuyAd.price }
        : null,
      topSellAd: market.bestSellAd
        ? { nickName: market.bestSellAd.nickName, price: market.bestSellAd.price }
        : null,
    };
    this._emit();
  }

  // ─── Ad State ─────────────────────────────────────────────────────────────────

  setAdIds(buyAdId, sellAdId) {
    this.ownAds.buy.id = buyAdId;
    this.ownAds.sell.id = sellAdId;
  }

  updateAdState(side, updates) {
    if (side !== 'buy' && side !== 'sell') throw new Error(`Invalid side: ${side}`);
    Object.assign(this.ownAds[side], updates);
    this._emit();
  }

  recordPricePoint(buyPrice, sellPrice, spreadPct) {
    const point = {
      ts: new Date().toISOString(),
      buyPrice,
      sellPrice,
      spreadPct,
      marketBuy: this.market.bestBuyPrice,
      marketSell: this.market.bestSellPrice,
    };
    this.priceHistory.push(point);
    if (this.priceHistory.length > MAX_HISTORY) {
      this.priceHistory.shift();
    }
  }

  // ─── Pricing State ────────────────────────────────────────────────────────────

  updatePricing(pricingResult, minSpreadPercent) {
    if (pricingResult) {
      this.pricing = {
        spreadPercent: pricingResult.spreadPercent,
        minSpreadPercent,
        refBuyPrice: pricingResult.refBuyPrice,
        refSellPrice: pricingResult.refSellPrice,
      };
    }
    this._emit();
  }

  // ─── Cycle Tracking ──────────────────────────────────────────────────────────

  recordCycle() {
    this.cycleCount++;
    this.lastCycleAt = new Date().toISOString();
  }

  setError(err) {
    this.lastError = err ? { message: err.message, ts: new Date().toISOString() } : null;
    this._emit();
  }

  // ─── Logging ─────────────────────────────────────────────────────────────────

  addLog(level, message, data = null) {
    const entry = { ts: new Date().toISOString(), level, message, data };
    this.logEntries.push(entry);
    if (this.logEntries.length > MAX_LOG_ENTRIES) this.logEntries.shift();
    // Emit log separately so frontend can display it in real time
    this.emit('log', entry);
  }

  getRecentLogs(n = 50) {
    return this.logEntries.slice(-n);
  }

  // ─── Full Snapshot ────────────────────────────────────────────────────────────

  getSnapshot() {
    return {
      running: this.botRunning,
      startedAt: this.startedAt,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastError: this.lastError,
      market: this.market,
      ownAds: this.ownAds,
      pricing: this.pricing,
      priceHistory: this.priceHistory.slice(-60), // last 60 points to frontend
      recentLogs: this.getRecentLogs(30),
    };
  }

  _emit() {
    this.emit('stateChange', this.getSnapshot());
  }
}

module.exports = { StateManager };
