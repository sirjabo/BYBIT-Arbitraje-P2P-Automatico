// src/utils/api.js
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3002';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}/api${path}`, opts);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API error');
  return data;
}

export const api = {
  startBot: () => request('POST', '/bot/start'),
  stopBot: () => request('POST', '/bot/stop'),
  syncPrices: () => request('POST', '/bot/sync'),
  forceCycle: () => request('POST', '/bot/force-cycle'),
  getConfig: () => request('GET', '/config'),
  updatePricingConfig: (body) => request('POST', '/config/pricing', body),
  updateBotConfig: (body) => request('POST', '/config/bot', body),
  getStatus: () => request('GET', '/status'),
};
