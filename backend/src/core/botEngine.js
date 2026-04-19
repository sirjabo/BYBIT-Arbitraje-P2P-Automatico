// src/core/botEngine.js
// Main orchestration: runs the pricing cycle, manages cooldowns, coordinates all modules.

const { createLogger } = require('../utils/logger');
const log = createLogger('BotEngine');

class BotEngine {
  constructor({ bybitClient, pricingEngine, rateLimiter, stateManager, config }) {
    this.bybit = bybitClient;
    this.pricing = pricingEngine;
    this.rateLimiter = rateLimiter;
    this.state = stateManager;
    this.config = config;

    this._intervalHandle = null;
    this._running = false;

    // Cooldown tracking per side: timestamps of last update
    this._cooldowns = { buy: 0, sell: 0 };

    // Set initial ad IDs from config
    this.state.setAdIds(config.bybit.buyAdId, config.bybit.sellAdId);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async start() {
    if (this._running) {
      log.warn('Bot already running');
      return;
    }
    log.info('Starting bot engine');
    this._running = true;
    this.state.setRunning(true);
    this.state.addLog('info', 'Bot started');

    // Run first cycle immediately, then on interval
    await this._runCycle();
    this._intervalHandle = setInterval(
      () => this._runCycle(),
      this.config.bot.updateIntervalMs
    );
  }

  stop() {
    if (!this._running) return;
    log.info('Stopping bot engine');
    this._running = false;
    this.state.setRunning(false);
    this.state.addLog('info', 'Bot stopped');
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  // ─── Main Cycle ──────────────────────────────────────────────────────────────

  async _runCycle() {
    if (!this._running) return;

    const cycleStart = Date.now();
    this.state.recordCycle();
    log.debug('Starting pricing cycle');

    try {
      // Step 1: Fetch market data (top 2 each side)
      const [buyAds, sellAds] = await Promise.all([
        this.bybit.getTopBuyAds(2).catch(e => {
          log.error('Failed to fetch buy ads', { error: e.message });
          return [];
        }),
        this.bybit.getTopSellAds(2).catch(e => {
          log.error('Failed to fetch sell ads', { error: e.message });
          return [];
        }),
      ]);

      // Step 2: Analyze market
      const market = this.pricing.analyzeMarket(buyAds, sellAds);
      this.state.updateMarket(market);

      if (!market.bestBuyPrice && !market.bestSellPrice) {
        log.warn('No market data available — skipping cycle');
        this.state.addLog('warn', 'No market data — cycle skipped');
        return;
      }

      // Step 3: Calculate target prices
      const targets = this.pricing.calculateTargetPrices(market);
      if (!targets) {
        log.warn('Could not calculate target prices — skipping cycle');
        return;
      }

      this.state.updatePricing(targets, this.pricing.minSpreadPercent);
      this.state.updateAdState('buy', { targetPrice: targets.targetBuyPrice });
      this.state.updateAdState('sell', { targetPrice: targets.targetSellPrice });

      // Step 4: Record price history
      this.state.recordPricePoint(
        targets.targetBuyPrice,
        targets.targetSellPrice,
        targets.spreadPercent
      );

      // Step 5: Decide and execute updates
      await this._maybeUpdateAd('buy', targets.targetBuyPrice);
      await this._maybeUpdateAd('sell', targets.targetSellPrice);

      this.state.setError(null);
      log.debug(`Cycle completed in ${Date.now() - cycleStart}ms`);
    } catch (err) {
      log.error('Cycle error', { error: err.message, stack: err.stack });
      this.state.setError(err);
      this.state.addLog('error', `Cycle error: ${err.message}`);
    }
  }

  // ─── Ad Update Logic ─────────────────────────────────────────────────────────

  async _maybeUpdateAd(side, targetPrice) {
    const adState = this.state.ownAds[side];
    const adId = adState.id;

    if (!adId) {
      log.warn(`No adId configured for ${side} side`);
      return;
    }

    // Check cooldown
    const elapsed = Date.now() - this._cooldowns[side];
    if (elapsed < this.config.bot.cooldownAfterUpdateMs) {
      const remaining = Math.ceil((this.config.bot.cooldownAfterUpdateMs - elapsed) / 1000);
      log.debug(`${side} ad in cooldown for ${remaining}s more`);
      return;
    }

    // Check rate limit (max updates per 5-min window)
    if (!this.rateLimiter.canUpdateAd(adId)) {
      const waitMs = this.rateLimiter.msUntilAdCanUpdate(adId);
      log.warn(`${side} ad hit update limit, next slot in ${Math.ceil(waitMs / 1000)}s`);
      this.state.addLog('warn', `${side} ad update limit reached, waiting ${Math.ceil(waitMs / 1000)}s`);
      return;
    }

    const currentPrice = adState.currentPrice;

    // Decide if update is needed
    const { needsUpdate, reason, changePct } = this.pricing.shouldUpdateAd(
      currentPrice,
      targetPrice,
      `${side} ad`
    );

    if (!needsUpdate) {
      log.debug(`${side} ad: no update needed (${reason}, Δ${changePct?.toFixed(3)}%)`);
      return;
    }

    // Execute update
    try {
      log.info(`Updating ${side} ad ${adId}: ${currentPrice} → ${targetPrice}`);
      this.state.addLog('info', `Updating ${side} price: ${currentPrice} → ${targetPrice} ARS`);

      await this.bybit.updateAdPrice(adId, targetPrice);

      this.rateLimiter.recordAdUpdate(adId);
      this._cooldowns[side] = Date.now();

      this.state.updateAdState(side, {
        currentPrice: targetPrice,
        lastUpdatedAt: new Date().toISOString(),
        updatesInWindow: this.config.bot.maxUpdatesPer5Min - this.rateLimiter.adUpdatesRemaining(adId),
        lastUpdateResult: 'success',
      });

      this.state.addLog('info', `✓ ${side} ad updated to ${targetPrice} ARS`);
    } catch (err) {
      log.error(`Failed to update ${side} ad`, { error: err.message });
      this.state.updateAdState(side, { lastUpdateResult: `error: ${err.message}` });
      this.state.addLog('error', `Failed to update ${side} ad: ${err.message}`);
      // Don't rethrow: a failed update shouldn't crash the whole cycle
    }
  }

  // ─── Config Updates ───────────────────────────────────────────────────────────

  updatePricingConfig(updates) {
    this.pricing.updateConfig(updates);
    this.state.addLog('info', `Pricing config updated: ${JSON.stringify(updates)}`);
  }

  updateBotConfig(updates) {
    if (updates.updateIntervalMs) {
      this.config.bot.updateIntervalMs = updates.updateIntervalMs;
      // Restart interval with new timing
      if (this._intervalHandle) {
        clearInterval(this._intervalHandle);
        this._intervalHandle = setInterval(
          () => this._runCycle(),
          this.config.bot.updateIntervalMs
        );
      }
    }
    if (updates.cooldownAfterUpdateMs) {
      this.config.bot.cooldownAfterUpdateMs = updates.cooldownAfterUpdateMs;
    }
    this.state.addLog('info', `Bot config updated: ${JSON.stringify(updates)}`);
  }

  // ─── Manual Actions ───────────────────────────────────────────────────────────

  async forceRefresh() {
    log.info('Force refresh triggered');
    await this._runCycle();
  }

  /**
   * Sync current ad prices from Bybit (call on startup or manual sync)
   */
  async syncCurrentPrices() {
    log.info('Syncing current ad prices from Bybit');
    try {
      const [buyDetail, sellDetail] = await Promise.all([
        this.bybit.getAdDetail(this.config.bybit.buyAdId),
        this.bybit.getAdDetail(this.config.bybit.sellAdId),
      ]);
      if (buyDetail) {
        this.state.updateAdState('buy', { currentPrice: parseFloat(buyDetail.price) });
      }
      if (sellDetail) {
        this.state.updateAdState('sell', { currentPrice: parseFloat(sellDetail.price) });
      }
      log.info('Current prices synced', {
        buy: buyDetail?.price,
        sell: sellDetail?.price,
      });
      this.state.addLog('info', 'Ad prices synced from Bybit');
    } catch (err) {
      log.error('Failed to sync prices', { error: err.message });
      this.state.addLog('error', `Sync failed: ${err.message}`);
    }
  }
}

module.exports = { BotEngine };
