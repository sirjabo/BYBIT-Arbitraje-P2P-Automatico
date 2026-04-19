// src/App.jsx
import React, { useState, useCallback, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './utils/api';

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtARS(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n) {
  if (n == null) return '—';
  return n.toFixed(3) + '%';
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-AR');
}

function timeSince(iso) {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ running }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      background: running ? '#0d2e1f' : '#1e1a14',
      color: running ? '#00ff88' : '#f0a020',
      border: `1px solid ${running ? '#00ff88' : '#f0a020'}`,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: running ? '#00ff88' : '#f0a020',
        boxShadow: running ? '0 0 6px #00ff88' : '0 0 6px #f0a020',
        animation: running ? 'pulse 2s infinite' : 'none',
      }} />
      {running ? 'ACTIVO' : 'DETENIDO'}
    </span>
  );
}

function ConnectionDot({ connected }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
      color: connected ? '#00ff88' : '#ff4444',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: connected ? '#00ff88' : '#ff4444',
      }} />
      {connected ? 'WS conectado' : 'WS desconectado'}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: '#0e1117',
      border: '1px solid #1e2530',
      borderRadius: 10,
      padding: '16px 20px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function BigPrice({ value, color = '#e2e8f0' }) {
  return (
    <div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
      {value != null ? `$${fmtARS(value)}` : <span style={{ color: '#2d3748' }}>—</span>}
    </div>
  );
}

function MetricRow({ label, value, sub, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#4a5568' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: valueColor || '#a0aec0', fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {sub && <span style={{ fontSize: 10, color: '#4a5568', marginLeft: 4 }}>{sub}</span>}
      </span>
    </div>
  );
}

function ActionButton({ label, onClick, color = '#2d3748', textColor = '#a0aec0', disabled }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (loading || disabled) return;
    setLoading(true);
    try { await onClick(); } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };
  return (
    <button
      onClick={handle}
      disabled={disabled || loading}
      style={{
        padding: '8px 16px', borderRadius: 7, border: `1px solid ${color}`,
        background: 'transparent', color: loading ? '#4a5568' : textColor,
        fontSize: 12, fontWeight: 600, cursor: disabled || loading ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s', letterSpacing: '0.03em',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {loading ? '...' : label}
    </button>
  );
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function MarketPanel({ market }) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
        Mercado P2P — USDT/ARS
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Label>Mejor Precio Compra (top 1)</Label>
          <BigPrice value={market?.bestBuyPrice} color="#00ff88" />
          {market?.topBuyAd && (
            <div style={{ fontSize: 11, color: '#4a5568', marginTop: 3 }}>
              {market.topBuyAd.nickName}
            </div>
          )}
          {market?.secondBuyPrice && (
            <div style={{ fontSize: 11, color: '#4a5568', marginTop: 6 }}>
              top 2: ${fmtARS(market.secondBuyPrice)}
            </div>
          )}
        </div>
        <div>
          <Label>Mejor Precio Venta (top 1)</Label>
          <BigPrice value={market?.bestSellPrice} color="#ff6b6b" />
          {market?.topSellAd && (
            <div style={{ fontSize: 11, color: '#4a5568', marginTop: 3 }}>
              {market.topSellAd.nickName}
            </div>
          )}
          {market?.secondSellPrice && (
            <div style={{ fontSize: 11, color: '#4a5568', marginTop: 6 }}>
              top 2: ${fmtARS(market.secondSellPrice)}
            </div>
          )}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #1e2530', marginTop: 14, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#4a5568' }}>
          Spread de mercado
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#ffd700' }}>
          {market?.marketSpreadPercent != null ? fmtPct(market.marketSpreadPercent) : '—'}
        </span>
      </div>
      {market?.fetchedAt && (
        <div style={{ fontSize: 10, color: '#2d3748', marginTop: 4 }}>
          Actualizado {timeSince(market.fetchedAt)}
        </div>
      )}
    </Card>
  );
}

function OwnAdsPanel({ ownAds, pricing }) {
  const buy = ownAds?.buy;
  const sell = ownAds?.sell;
  return (
    <Card>
      <div style={{ fontSize: 11, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
        Mis Anuncios
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Label>Precio Compra (actual / objetivo)</Label>
          <BigPrice value={buy?.currentPrice} color="#48bb78" />
          {buy?.targetPrice && (
            <div style={{ fontSize: 12, color: '#2d9cdb', marginTop: 4 }}>
              objetivo: ${fmtARS(buy.targetPrice)}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <MetricRow
              label="Último update"
              value={buy?.lastUpdatedAt ? timeSince(buy.lastUpdatedAt) : '—'}
            />
            <MetricRow
              label="Updates en ventana"
              value={`${buy?.updatesInWindow ?? 0}/10`}
            />
            {buy?.lastUpdateResult && (
              <MetricRow
                label="Resultado"
                value={buy.lastUpdateResult}
                valueColor={buy.lastUpdateResult === 'success' ? '#00ff88' : '#ff4444'}
              />
            )}
          </div>
        </div>
        <div>
          <Label>Precio Venta (actual / objetivo)</Label>
          <BigPrice value={sell?.currentPrice} color="#fc8181" />
          {sell?.targetPrice && (
            <div style={{ fontSize: 12, color: '#2d9cdb', marginTop: 4 }}>
              objetivo: ${fmtARS(sell.targetPrice)}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <MetricRow
              label="Último update"
              value={sell?.lastUpdatedAt ? timeSince(sell.lastUpdatedAt) : '—'}
            />
            <MetricRow
              label="Updates en ventana"
              value={`${sell?.updatesInWindow ?? 0}/10`}
            />
            {sell?.lastUpdateResult && (
              <MetricRow
                label="Resultado"
                value={sell.lastUpdateResult}
                valueColor={sell.lastUpdateResult === 'success' ? '#00ff88' : '#ff4444'}
              />
            )}
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid #1e2530', marginTop: 14, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#4a5568' }}>Spread actual</span>
        <span style={{
          fontSize: 16, fontWeight: 800,
          color: pricing?.spreadPercent >= (pricing?.minSpreadPercent || 0.5) ? '#00ff88' : '#ff4444',
        }}>
          {fmtPct(pricing?.spreadPercent)}
        </span>
        {pricing?.minSpreadPercent && (
          <span style={{ fontSize: 11, color: '#4a5568' }}>
            mín: {fmtPct(pricing.minSpreadPercent)}
          </span>
        )}
      </div>
    </Card>
  );
}

function PriceChart({ history }) {
  if (!history || history.length < 2) {
    return (
      <Card style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#2d3748', fontSize: 13 }}>Sin datos históricos aún...</span>
      </Card>
    );
  }

  const data = history.map((p, i) => ({
    name: fmtTime(p.ts),
    Compra: p.buyPrice,
    Venta: p.sellPrice,
    'Spread %': parseFloat(p.spreadPct?.toFixed(3)),
  }));

  return (
    <Card style={{ padding: '16px 8px' }}>
      <div style={{ fontSize: 11, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, paddingLeft: 12 }}>
        Historial de Precios
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2530" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#4a5568', fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="price"
            tick={{ fill: '#4a5568', fontSize: 10 }}
            tickFormatter={v => fmtARS(v)}
            width={80}
          />
          <YAxis
            yAxisId="spread"
            orientation="right"
            tick={{ fill: '#ffd700', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={50}
          />
          <Tooltip
            contentStyle={{ background: '#0e1117', border: '1px solid #1e2530', fontSize: 12 }}
            formatter={(value, name) => {
              if (name === 'Spread %') return [`${value}%`, name];
              return [`$${fmtARS(value)}`, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Line yAxisId="price" type="monotone" dataKey="Compra" stroke="#48bb78" dot={false} strokeWidth={1.5} />
          <Line yAxisId="price" type="monotone" dataKey="Venta" stroke="#fc8181" dot={false} strokeWidth={1.5} />
          <Line yAxisId="spread" type="monotone" dataKey="Spread %" stroke="#ffd700" dot={false} strokeWidth={1} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function ConfigPanel({ onConfigUpdate }) {
  const [minSpread, setMinSpread] = useState('0.5');
  const [safetyMargin, setSafetyMargin] = useState('0.05');
  const [threshold, setThreshold] = useState('0.2');
  const [intervalSec, setIntervalSec] = useState('15');
  const [cooldownSec, setCooldownSec] = useState('30');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      await api.updatePricingConfig({
        minSpreadPercent: parseFloat(minSpread),
        safetyMarginPercent: parseFloat(safetyMargin),
        minChangeThresholdPercent: parseFloat(threshold),
      });
      await api.updateBotConfig({
        updateIntervalMs: parseInt(intervalSec) * 1000,
        cooldownAfterUpdateMs: parseInt(cooldownSec) * 1000,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (onConfigUpdate) onConfigUpdate();
    } catch (e) {
      alert('Error guardando config: ' + e.message);
    }
  };

  const inputStyle = {
    background: '#070a0f',
    border: '1px solid #1e2530',
    borderRadius: 6,
    color: '#a0aec0',
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  };

  const fieldLabel = {
    fontSize: 11, color: '#4a5568', marginBottom: 4, display: 'block',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  };

  return (
    <Card>
      <div style={{ fontSize: 11, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
        Configuración
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={fieldLabel}>Spread Mínimo (%)</label>
          <input style={inputStyle} type="number" step="0.1" min="0.1" max="20"
            value={minSpread} onChange={e => setMinSpread(e.target.value)} />
        </div>
        <div>
          <label style={fieldLabel}>Margen Seguridad (%)</label>
          <input style={inputStyle} type="number" step="0.01" min="0" max="5"
            value={safetyMargin} onChange={e => setSafetyMargin(e.target.value)} />
        </div>
        <div>
          <label style={fieldLabel}>Umbral Cambio Mín (%)</label>
          <input style={inputStyle} type="number" step="0.05" min="0" max="5"
            value={threshold} onChange={e => setThreshold(e.target.value)} />
        </div>
        <div>
          <label style={fieldLabel}>Intervalo Ciclo (seg)</label>
          <input style={inputStyle} type="number" step="1" min="5" max="300"
            value={intervalSec} onChange={e => setIntervalSec(e.target.value)} />
        </div>
        <div>
          <label style={fieldLabel}>Cooldown Post-Update (seg)</label>
          <input style={inputStyle} type="number" step="5" min="0" max="600"
            value={cooldownSec} onChange={e => setCooldownSec(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <ActionButton label="Guardar Configuración" onClick={handleSave} color="#2d9cdb" textColor="#2d9cdb" />
        {saved && <span style={{ fontSize: 12, color: '#00ff88' }}>✓ Guardado</span>}
      </div>
    </Card>
  );
}

function LogPanel({ logs }) {
  const logColors = { info: '#4a5568', warn: '#f0a020', error: '#ff4444', debug: '#2d3748' };

  return (
    <Card style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
        Log en Tiempo Real
      </div>
      <div style={{
        height: 180, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11,
        display: 'flex', flexDirection: 'column-reverse',
      }}>
        {[...(logs || [])].reverse().map((entry, i) => (
          <div key={i} style={{ marginBottom: 3, lineHeight: 1.5 }}>
            <span style={{ color: '#2d3748' }}>{fmtTime(entry.ts)} </span>
            <span style={{ color: logColors[entry.level] || '#4a5568', textTransform: 'uppercase', fontSize: 10 }}>
              [{entry.level}]{' '}
            </span>
            <span style={{ color: '#718096' }}>{entry.message}</span>
          </div>
        ))}
        {(!logs || logs.length === 0) && (
          <span style={{ color: '#2d3748' }}>Esperando eventos...</span>
        )}
      </div>
    </Card>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { state, logs, connected } = useWebSocket();
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const doAction = useCallback(async (fn) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionLoading(false);
    }
  }, []);

  // Clear error after 5s
  useEffect(() => {
    if (actionError) {
      const t = setTimeout(() => setActionError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [actionError]);

  const running = state?.running;
  const market = state?.market;
  const ownAds = state?.ownAds;
  const pricing = state?.pricing;
  const priceHistory = state?.priceHistory || [];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#070a0f',
      color: '#e2e8f0',
      fontFamily: "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace",
      padding: '24px',
      boxSizing: 'border-box',
    }}>
      {/* Google Fonts */}
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap" rel="stylesheet" />

      {/* Keyframe animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #070a0f; }
        ::-webkit-scrollbar-thumb { background: #1e2530; border-radius: 2px; }
        input:focus { outline: none; border-color: #2d9cdb !important; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#e2e8f0' }}>
              BYBIT P2P BOT
            </h1>
            <StatusBadge running={running} />
          </div>
          <div style={{ fontSize: 11, color: '#2d3748' }}>
            USDT/ARS · {state?.cycleCount || 0} ciclos · {state?.lastCycleAt ? `último: ${timeSince(state.lastCycleAt)}` : 'sin ciclos aún'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <ConnectionDot connected={connected} />
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionButton
              label={running ? 'Detener Bot' : 'Iniciar Bot'}
              onClick={() => doAction(running ? api.stopBot : api.startBot)}
              color={running ? '#ff4444' : '#00ff88'}
              textColor={running ? '#ff4444' : '#00ff88'}
              disabled={actionLoading || !connected}
            />
            <ActionButton
              label="Forzar Ciclo"
              onClick={() => doAction(api.forceCycle)}
              color="#ffd700"
              textColor="#ffd700"
              disabled={actionLoading || !connected}
            />
            <ActionButton
              label="Sincronizar"
              onClick={() => doAction(api.syncPrices)}
              color="#a0aec0"
              textColor="#a0aec0"
              disabled={actionLoading || !connected}
            />
          </div>
        </div>
      </div>

      {/* Error banner */}
      {(actionError || state?.lastError) && (
        <div style={{
          background: '#1a0a0a', border: '1px solid #ff4444', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#ff4444',
        }}>
          ⚠ {actionError || state?.lastError?.message}
          {state?.lastError?.ts && <span style={{ color: '#4a5568', marginLeft: 8 }}>{timeSince(state.lastError.ts)}</span>}
        </div>
      )}

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <MarketPanel market={market} />
        <OwnAdsPanel ownAds={ownAds} pricing={pricing} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <PriceChart history={priceHistory} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ConfigPanel />
        <LogPanel logs={logs} />
      </div>

      {/* Stats footer */}
      <div style={{
        marginTop: 16,
        padding: '10px 16px',
        background: '#0a0d12',
        border: '1px solid #1e2530',
        borderRadius: 8,
        display: 'flex', gap: 32, flexWrap: 'wrap',
      }}>
        {[
          ['Buy Ad ID', ownAds?.buy?.id || '—'],
          ['Sell Ad ID', ownAds?.sell?.id || '—'],
          ['Spread Mín', pricing?.minSpreadPercent ? fmtPct(pricing.minSpreadPercent) : '—'],
          ['Spread Actual', fmtPct(pricing?.spreadPercent)],
          ['Ref Compra', pricing?.refBuyPrice ? `$${fmtARS(pricing.refBuyPrice)}` : '—'],
          ['Ref Venta', pricing?.refSellPrice ? `$${fmtARS(pricing.refSellPrice)}` : '—'],
          ['Iniciado', state?.startedAt ? fmtTime(state.startedAt) : '—'],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: '#2d3748', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</div>
            <div style={{ fontSize: 12, color: '#718096', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
