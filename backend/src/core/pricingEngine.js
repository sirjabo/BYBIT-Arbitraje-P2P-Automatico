// src/core/pricingEngine.js
// The heart of the bot. Given market order book data, calculates optimal
// buy/sell prices while enforcing spread constraints and stability criteria.

const { createLogger } = require('../utils/logger');
const log = createLogger('PricingEngine');

/**
 * Parse price from ad object. Bybit returns price as string.
 */
function parseAdPrice(ad) {
  return parseFloat(ad.price);
}

/**
 * Extract relevant info from a raw Bybit P2P ad object.
 */
function normalizeAd(ad) {
  return {
    id: ad.id,
    userId: ad.userId,
    nickName: ad.nickName,
    price: parseAdPrice(ad),
    minAmount: parseFloat(ad.minAmount),
    maxAmount: parseFloat(ad.maxAmount),
    quantity: parseFloat(ad.quantity),
    side: ad.side, // '0'=sell, '1'=buy
    completedOrderNum: parseInt(ad.recentOrderNum || 0),
    finishRate: parseFloat(ad.recentExecuteRate || 0),
  };
}

class PricingEngine {
  constructor(config) {
    this.minSpreadPercent         = config.pricing.minSpreadPercent;
    this.minChangeThresholdPercent = config.pricing.minChangeThresholdPercent;
    // TICK: cuántos ARS mejoramos sobre el top1 para quedar en posición ~2.
    // Default 1 ARS. Para mercados con precios muy altos (>10000 ARS) considerar 2-5.
    this.tickSize = config.pricing.tickSize ?? 1.0;
  }

  /**
   * Update runtime config (e.g., from UI)
   */
  updateConfig(updates) {
    if (updates.minSpreadPercent !== undefined) {
      this.minSpreadPercent = updates.minSpreadPercent;
      log.info(`minSpreadPercent updated to ${this.minSpreadPercent}`);
    }
    if (updates.minChangeThresholdPercent !== undefined) {
      this.minChangeThresholdPercent = updates.minChangeThresholdPercent;
    }
    if (updates.tickSize !== undefined) {
      this.tickSize = updates.tickSize;
      log.info(`tickSize updated to ${this.tickSize}`);
    }
  }

  /**
   * Core market analysis: returns best prices from the order book.
   *
   * From Bybit's perspective:
   *   - BUY ads (side=1): users want to BUY USDT (we are a SELLER competing here)
   *   - SELL ads (side=0): users want to SELL USDT (we are a BUYER competing here)
   *
   * Market dynamics:
   *   - Best BUY price = highest price someone is willing to pay for USDT
   *   - Best SELL price = lowest price someone is willing to accept to sell USDT
   *
   * Returns { bestBuyPrice, bestBuyAd, secondBuyPrice, bestSellPrice, bestSellAd, secondSellPrice }
   */
  analyzeMarket(buyAds, sellAds) {
    const normalizedBuys = buyAds.map(normalizeAd).sort((a, b) => b.price - a.price); // highest first
    const normalizedSells = sellAds.map(normalizeAd).sort((a, b) => a.price - b.price); // lowest first

    const result = {
      buyAds: normalizedBuys,
      sellAds: normalizedSells,
      bestBuyPrice: null,
      bestBuyAd: null,
      secondBuyPrice: null,
      bestSellPrice: null,
      bestSellAd: null,
      secondSellPrice: null,
      marketSpreadPercent: null,
    };

    if (normalizedBuys.length >= 1) {
      result.bestBuyAd = normalizedBuys[0];
      result.bestBuyPrice = normalizedBuys[0].price;
    }
    if (normalizedBuys.length >= 2) {
      result.secondBuyPrice = normalizedBuys[1].price;
    }
    if (normalizedSells.length >= 1) {
      result.bestSellAd = normalizedSells[0];
      result.bestSellPrice = normalizedSells[0].price;
    }
    if (normalizedSells.length >= 2) {
      result.secondSellPrice = normalizedSells[1].price;
    }

    if (result.bestBuyPrice && result.bestSellPrice) {
      // Market spread: buy side is higher (people pay more to buy), sell side is lower (people accept less to sell)
      // Actually in P2P: buy ads > sell ads is the normal state (market makers earn the spread)
      result.marketSpreadPercent =
        ((result.bestBuyPrice - result.bestSellPrice) / result.bestSellPrice) * 100;
    }

    return result;
  }

  /**
   * MODO AGRESIVO: Posicionarse entre el anuncio top1 y top2 de cada lado,
   * capturando el máximo spread posible con un piso mínimo garantizado.
   *
   * Lógica de posicionamiento:
   *
   *   Lado BUY (nosotros compramos USDT):
   *     Competimos contra otros compradores. El top1 comprador ofrece el precio
   *     más alto. Queremos estar justo debajo del top1 pero encima del top2,
   *     ofreciendo 1 ARS menos que el top1 → quedamos en posición 2 del libro.
   *     Si no hay top2, usamos top1 - TICK como referencia.
   *     → targetBuyPrice = top1BuyPrice - TICK
   *
   *   Lado SELL (nosotros vendemos USDT):
   *     Competimos contra otros vendedores. El top1 vendedor ofrece el precio
   *     más bajo. Queremos estar justo encima del top1 pero debajo del top2,
   *     pidiendo 1 ARS más que el top1 → quedamos en posición 2 del libro.
   *     Si no hay top2, usamos top1 + TICK como referencia.
   *     → targetSellPrice = top1SellPrice + TICK
   *
   *   Spread enforcement (piso):
   *     Si (targetSell - targetBuy) / targetBuy < minSpread,
   *     expandimos simétricamente desde el midpoint hasta garantizar el mínimo.
   *     En ese caso el bot NO persigue el mercado — se queda en el piso.
   *
   *   Fallback si falta un lado:
   *     Si no hay anuncios en un lado, extrapolamos desde el lado disponible
   *     usando el spread mínimo como referencia.
   */
  calculateTargetPrices(market) {
    const { bestBuyPrice, secondBuyPrice, bestSellPrice, secondSellPrice } = market;
    const minSpreadFactor = this.minSpreadPercent / 100;

    // TICK: mínima unidad de mejora de precio en ARS.
    // 1 ARS nos pone entre top1 y top2 sin ser top1.
    const TICK = this.tickSize;

    const hasBuySide  = bestBuyPrice  !== null;
    const hasSellSide = bestSellPrice !== null;

    if (!hasBuySide && !hasSellSide) {
      log.warn('No market data on either side — cannot calculate prices');
      return null;
    }

    // ── Calcular targets de cada lado independientemente ──────────────────────

    let targetBuyPrice, targetSellPrice;

    if (hasBuySide) {
      // Nuestro precio de COMPRA debe competir en el libro de compradores.
      // Para atraer vendedores, ofrecemos 1 TICK por encima del top1 vendedor
      // → quedamos como el comprador más atractivo (posición 1-2 en el libro BUY).
      // Referencia: top1SellPrice (el vendedor más barato del mercado).
      targetBuyPrice = bestSellPrice + TICK;
    } else {
      targetBuyPrice = bestBuyPrice * (1 - minSpreadFactor * 1.5);
      log.warn(`No sell side — extrapolated targetBuyPrice: ${targetBuyPrice.toFixed(2)}`);
    }

    if (hasSellSide) {
      // Nuestro precio de VENTA debe competir en el libro de vendedores.
      // Para atraer compradores, pedimos 1 TICK por debajo del top1 comprador
      // → quedamos como el vendedor más barato (posición 1-2 en el libro SELL).
      // Referencia: top1BuyPrice (el comprador que más paga en el mercado).
      targetSellPrice = bestBuyPrice - TICK;
    } else {
      targetSellPrice = bestSellPrice * (1 + minSpreadFactor * 1.5);
      log.warn(`No buy side — extrapolated targetSellPrice: ${targetSellPrice.toFixed(2)}`);
    }

    // ── Enforcement del spread mínimo (piso) ──────────────────────────────────
    //
    // Si el mercado está muy comprimido (spread de mercado < minSpread),
    // el posicionamiento agresivo nos daría pérdida. En ese caso ignoramos
    // el mercado y nos fijamos en el midpoint con spread mínimo garantizado.

    const rawSpread = (targetSellPrice - targetBuyPrice) / targetBuyPrice;

    let spreadEnforced = false;
    if (rawSpread < minSpreadFactor) {
      const mid      = (targetBuyPrice + targetSellPrice) / 2;
      const halfSpread = mid * minSpreadFactor / 2;
      targetBuyPrice  = mid - halfSpread;
      targetSellPrice = mid + halfSpread;
      spreadEnforced  = true;
      log.warn('Mercado comprimido: spread mínimo forzado desde midpoint', {
        mid:        mid.toFixed(2),
        targetBuy:  targetBuyPrice.toFixed(2),
        targetSell: targetSellPrice.toFixed(2),
        rawSpreadPct: (rawSpread * 100).toFixed(3),
        minSpreadPct: this.minSpreadPercent,
      });
    }

    const achievedSpreadPercent = ((targetSellPrice - targetBuyPrice) / targetBuyPrice) * 100;

    log.debug('Prices calculated (aggressive mode)', {
      top1Buy:    bestBuyPrice?.toFixed(2),
      top2Buy:    secondBuyPrice?.toFixed(2),
      top1Sell:   bestSellPrice?.toFixed(2),
      top2Sell:   secondSellPrice?.toFixed(2),
      targetBuy:  targetBuyPrice.toFixed(2),
      targetSell: targetSellPrice.toFixed(2),
      spreadPct:  achievedSpreadPercent.toFixed(3),
      enforced:   spreadEnforced,
    });

    return {
      targetBuyPrice:  parseFloat(targetBuyPrice.toFixed(2)),
      targetSellPrice: parseFloat(targetSellPrice.toFixed(2)),
      spreadPercent:   achievedSpreadPercent,
      spreadEnforced,
      refBuyPrice:  bestBuyPrice,
      refSellPrice: bestSellPrice,
    };
  }

  /**
   * Decide whether an ad needs updating.
   * Returns { needsUpdate, reason } based on current vs target price.
   */
  shouldUpdateAd(currentPrice, targetPrice, label = 'ad') {
    if (currentPrice === null || currentPrice === undefined) {
      return { needsUpdate: true, reason: 'no_current_price' };
    }

    const changePct = Math.abs((targetPrice - currentPrice) / currentPrice) * 100;

    if (changePct < this.minChangeThresholdPercent) {
      log.debug(`${label}: change ${changePct.toFixed(3)}% below threshold — no update needed`);
      return { needsUpdate: false, reason: 'below_threshold', changePct };
    }

    log.info(`${label}: change ${changePct.toFixed(3)}% >= threshold — update needed`, {
      current: currentPrice,
      target: targetPrice,
    });
    return { needsUpdate: true, reason: 'above_threshold', changePct };
  }

  getConfig() {
    return {
      minSpreadPercent:          this.minSpreadPercent,
      minChangeThresholdPercent: this.minChangeThresholdPercent,
      tickSize:                  this.tickSize,
    };
  }
}

module.exports = { PricingEngine, normalizeAd };
