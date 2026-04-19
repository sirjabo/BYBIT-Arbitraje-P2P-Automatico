// src/api/bybitClient.js
// Handles all authenticated communication with Bybit REST API.
// Bybit uses HMAC-SHA256 with timestamp + apiKey + recvWindow + params as signature payload.

const crypto = require('crypto');
const axios = require('axios');
const { createLogger } = require('../utils/logger');
const log = createLogger('BybitClient');

const RECV_WINDOW = 5000;

class BybitClient {
  constructor(config, rateLimiter) {
    this.apiKey = config.bybit.apiKey;
    this.apiSecret = config.bybit.apiSecret;
    this.baseUrl = config.bybit.baseUrl;
    this.rateLimiter = rateLimiter;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': this.apiKey,
      },
    });

    // Response interceptor for unified error handling
    this.http.interceptors.response.use(
      res => {
        const data = res.data;
        // Bybit returns retCode 0 for success
        if (data.retCode !== undefined && data.retCode !== 0) {
          const err = new Error(`Bybit API error: [${data.retCode}] ${data.retMsg}`);
          err.bybitCode = data.retCode;
          err.bybitMsg = data.retMsg;
          throw err;
        }
        return res;
      },
      err => {
        if (err.response) {
          log.error('HTTP error from Bybit', {
            status: err.response.status,
            data: err.response.data,
          });
        }
        throw err;
      }
    );
  }

  _sign(timestamp, params) {
    // Bybit signature: HMAC-SHA256 of (timestamp + apiKey + recvWindow + queryString)
    const queryString = typeof params === 'string' ? params : JSON.stringify(params);
    const payload = `${timestamp}${this.apiKey}${RECV_WINDOW}${queryString}`;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(payload)
      .digest('hex');
  }

  _buildHeaders(timestamp, sign) {
    return {
      'X-BAPI-TIMESTAMP': String(timestamp),
      'X-BAPI-RECV-WINDOW': String(RECV_WINDOW),
      'X-BAPI-SIGN': sign,
    };
  }

  async _post(path, body) {
    await this.rateLimiter.throttle();
    const timestamp = Date.now();
    const bodyStr = JSON.stringify(body);
    const sign = this._sign(timestamp, bodyStr);
    const headers = this._buildHeaders(timestamp, sign);

    log.debug(`POST ${path}`, { body });
    const res = await this.http.post(path, body, { headers });
    return res.data;
  }

  async _get(path, params = {}) {
    await this.rateLimiter.throttle();
    const timestamp = Date.now();
    const queryString = new URLSearchParams(params).toString();
    const sign = this._sign(timestamp, queryString);
    const headers = this._buildHeaders(timestamp, sign);

    log.debug(`GET ${path}`, { params });
    const res = await this.http.get(path, { params, headers });
    return res.data;
  }

  /**
   * POST for P2P API endpoints.
   *
   * CRITICAL DIFFERENCE: The P2P API returns snake_case response keys:
   *   { ret_code: 0, ret_msg: "SUCCESS", result: {...} }
   * while the rest of the v5 API uses:
   *   { retCode: 0, retMsg: "OK", result: {...} }
   *
   * The axios interceptor only checks `retCode`, so it won't catch P2P errors.
   * This method checks both formats and throws on any non-zero code.
   */
  async _postP2P(path, body) {
    await this.rateLimiter.throttle();
    const timestamp = Date.now();
    const bodyStr = JSON.stringify(body);
    const sign = this._sign(timestamp, bodyStr);
    const headers = this._buildHeaders(timestamp, sign);

    log.debug(`POST (P2P) ${path}`, { body });

    // validateStatus: accept all HTTP codes so we can inspect the body ourselves
    const res = await this.http.post(path, body, {
      headers,
      validateStatus: () => true,
    });

    const data = res.data;

    // Real HTTP 404 = endpoint doesn't exist or not authorized
    if (res.status === 404) {
      throw new Error(
        `HTTP 404 on ${path} — endpoint not found. ` +
        `Confirm your account is a General Advertiser on Bybit P2P.`
      );
    }
    if (res.status >= 500) {
      throw new Error(`Bybit server error HTTP ${res.status} on ${path}`);
    }

    // P2P API uses snake_case (ret_code), rest of v5 uses camelCase (retCode)
    const retCode = data.ret_code ?? data.retCode;
    const retMsg  = data.ret_msg  ?? data.retMsg ?? 'Unknown error';

    if (retCode !== undefined && retCode !== 0) {
      const err = new Error(`Bybit P2P error [${retCode}]: ${retMsg}`);
      err.bybitCode = retCode;
      err.bybitMsg  = retMsg;
      err.path      = path;
      log.error(`P2P API error`, { path, retCode, retMsg, requestBody: body });
      throw err;
    }

    return data;
  }


  // ─── P2P Market Data ─────────────────────────────────────────────────────────

  /**
   * Fetch P2P order book (advertisements) for a given side.
   * side: 1 = Buy (users want to buy USDT), 0 = Sell (users want to sell USDT)
   * From a merchant perspective:
   *   - side=1 => competitors buying USDT (merchant's SELL side)
   *   - side=0 => competitors selling USDT (merchant's BUY side)
   */
  async getP2POrders({ tokenId = 'USDT', currencyId = 'ARS', side, page = 1, size = 10 }) {
    const body = {
      tokenId,
      currencyId,
      side: String(side),
      page: String(page),
      size: String(size),
    };
    const data = await this._postP2P('/v5/p2p/item/online', body);
    return data.result?.items || [];
  }

  /**
   * Fetch top N buy-side ads (users buying USDT, i.e. our sell competitors)
   */
  async getTopBuyAds(n = 2) {
    const items = await this.getP2POrders({ side: 1, size: Math.max(n, 3) });
    return items.slice(0, n);
  }

  /**
   * Fetch top N sell-side ads (users selling USDT, i.e. our buy competitors)
   */
  async getTopSellAds(n = 2) {
    const items = await this.getP2POrders({ side: 0, size: Math.max(n, 3) });
    return items.slice(0, n);
  }

  // ─── Own Ad Management ───────────────────────────────────────────────────────

  /**
   * Fetch own P2P ads list.
   * NOTE: The P2P API uses ret_code / ret_msg (snake_case), NOT retCode / retMsg.
   * We handle both formats here because the response interceptor checks retCode.
   */
  async getMyAds() {
    const data = await this._postP2P('/v5/p2p/item/personal/list', { status: '1' });
    return data.result?.list || data.result?.items || [];
  }

  /**
   * Get full details of a specific ad by ID.
   * Uses /v5/p2p/item/info with field `itemId`.
   */
  async getAdDetail(adId) {
    const data = await this._postP2P('/v5/p2p/item/info', { itemId: adId });
    return data.result;
  }

  /**
   * Update a P2P ad price.
   *
   * IMPORTANT: The documented endpoint /v5/p2p/item/update requires these exact fields:
   *   - id          (NOT itemId — the ad ID)
   *   - priceType   (string: "0" = fixed, "1" = floating)
   *   - premium     (string: empty for fixed price)
   *   - price       (string: price per token)
   *   - minAmount   (string)
   *   - maxAmount   (string)
   *   - remark      (string)
   *   - tradingPreferenceSet (object, can be {})
   *   - paymentIds  (array of strings — payment method IDs from paymentTerms[].id)
   *   - actionType  (string: "MODIFY" to change price, "ACTIVE" to relist offline ad)
   *   - quantity    (string: remaining quantity)
   *   - paymentPeriod (string: minutes)
   *
   * The P2P API response format uses snake_case: ret_code, ret_msg (not retCode/retMsg).
   * We use _postP2P() which handles both formats.
   */
  async updateAdPrice(adId, newPrice) {
    // Step 1: fetch current ad state — we must preserve all fields we're not changing
    const detail = await this.getAdDetail(adId);
    if (!detail) throw new Error(`Ad ${adId} not found or API returned empty result`);

    const priceStr = newPrice.toFixed(2);
    log.info(`Updating ad ${adId}: ${detail.price} → ${priceStr} ARS`);

    // Step 2: Extract payment IDs from paymentTerms (the authenticated detail endpoint)
    // paymentTerms is an array of objects with an `id` field (string, can be "-1" for balance)
    // Fall back to payments[] array (array of strings) if paymentTerms not present
    let paymentIds;
    if (detail.paymentTerms && detail.paymentTerms.length > 0) {
      paymentIds = detail.paymentTerms.map(pt => String(pt.id));
    } else if (detail.payments && detail.payments.length > 0) {
      paymentIds = detail.payments.map(p => String(p));
    } else {
      throw new Error(`Ad ${adId} has no payment methods configured`);
    }

    // Step 3: Determine actionType
    // Use "MODIFY" for an already-online ad. Use "ACTIVE" to relist an offline ad.
    const actionType = detail.status === 10 ? 'MODIFY' : 'ACTIVE';

    // Step 4: Build the update body with ALL required fields using exact field names from docs
    const updateBody = {
      id: String(adId),                              // "id", NOT "itemId"
      priceType: String(detail.priceType ?? 0),      // "0" = fixed price
      premium: String(detail.premium ?? ''),         // empty string for fixed price
      price: priceStr,                               // new price
      minAmount: String(detail.minAmount),
      maxAmount: String(detail.maxAmount),
      remark: detail.remark || '',
      tradingPreferenceSet: this._normalizeTradingPrefs(detail.tradingPreferenceSet),
      paymentIds,
      actionType,
      quantity: String(detail.lastQuantity ?? detail.quantity), // use remaining qty
      paymentPeriod: String(detail.paymentPeriod ?? 15),
    };

    log.debug(`Update body for ad ${adId}`, { updateBody });

    const data = await this._postP2P('/v5/p2p/item/update', updateBody);
    log.info(`Ad ${adId} updated successfully to ${priceStr} ARS`);
    return data.result;
  }

  /**
   * Normalize tradingPreferenceSet: convert all values to strings as the API expects.
   * The detail endpoint returns integers; the update endpoint expects strings.
   */
  _normalizeTradingPrefs(prefs) {
    if (!prefs || typeof prefs !== 'object') return {};
    const result = {};
    for (const [k, v] of Object.entries(prefs)) {
      result[k] = v !== null && v !== undefined ? String(v) : '0';
    }
    return result;
  }

  /**
   * Get server time to check clock sync
   */
  async getServerTime() {
    const res = await this.http.get('/v5/market/time');
    return parseInt(res.data.result?.timeSecond || res.data.result?.timeNano / 1e6);
  }
}

module.exports = { BybitClient };
