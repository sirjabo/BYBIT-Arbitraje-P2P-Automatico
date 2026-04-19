// src/utils/rateLimiter.js
// Token bucket rate limiter: maxRequestsPerSec sustained,
// plus per-ad update counter (max 10 per 5 minutes per Bybit policy).

const { createLogger } = require('./logger');
const log = createLogger('RateLimiter');

class TokenBucket {
  constructor(capacity, refillRatePerSec) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRatePerSec;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefill = now;
  }

  async consume(tokens = 1) {
    this._refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }
    // Wait until we have enough tokens
    const deficit = tokens - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillRatePerSec) * 1000) + 10;
    log.debug(`Rate limit: waiting ${waitMs}ms for ${tokens} token(s)`);
    await new Promise(r => setTimeout(r, waitMs));
    this._refill();
    this.tokens -= tokens;
  }
}

class AdUpdateTracker {
  // Tracks update counts per adId with a rolling 5-minute window
  constructor(maxPerWindow = 10, windowMs = 5 * 60 * 1000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.history = new Map(); // adId -> [timestamp, ...]
  }

  _pruneOld(adId) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const times = this.history.get(adId) || [];
    const pruned = times.filter(t => t > cutoff);
    this.history.set(adId, pruned);
    return pruned;
  }

  canUpdate(adId) {
    const times = this._pruneOld(adId);
    return times.length < this.maxPerWindow;
  }

  countInWindow(adId) {
    return this._pruneOld(adId).length;
  }

  record(adId) {
    const times = this._pruneOld(adId);
    times.push(Date.now());
    this.history.set(adId, times);
  }

  // Returns ms until the oldest update falls out of the window (0 if can update now)
  msUntilCanUpdate(adId) {
    const times = this._pruneOld(adId);
    if (times.length < this.maxPerWindow) return 0;
    const oldest = times[0];
    return Math.max(0, oldest + this.windowMs - Date.now()) + 100;
  }
}

class RateLimiter {
  constructor(config) {
    this.bucket = new TokenBucket(config.bot.maxRequestsPerSec, config.bot.maxRequestsPerSec);
    this.adTracker = new AdUpdateTracker(config.bot.maxUpdatesPer5Min);
  }

  async throttle() {
    await this.bucket.consume(1);
  }

  canUpdateAd(adId) {
    return this.adTracker.canUpdate(adId);
  }

  recordAdUpdate(adId) {
    this.adTracker.record(adId);
  }

  adUpdatesRemaining(adId) {
    return Math.max(0, this.adTracker.maxPerWindow - this.adTracker.countInWindow(adId));
  }

  msUntilAdCanUpdate(adId) {
    return this.adTracker.msUntilCanUpdate(adId);
  }
}

module.exports = { RateLimiter };
