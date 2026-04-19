// src/hooks/useWebSocket.js
import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3002';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 20;

export function useWebSocket() {
  const [state, setState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const attempts = useRef(0);
  const mounted = useRef(true);

  const connect = useCallback(() => {
    if (!mounted.current) return;

    try {
      const ws = new WebSocket(`${WS_URL}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted.current) return;
        setConnected(true);
        attempts.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mounted.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state') {
            setState(msg.payload);
          } else if (msg.type === 'log') {
            setLogs(prev => {
              const next = [...prev, msg.payload];
              return next.slice(-100); // Keep last 100 log entries
            });
          }
        } catch (e) {
          console.warn('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        if (!mounted.current) return;
        setConnected(false);
        wsRef.current = null;

        if (attempts.current < MAX_RECONNECT_ATTEMPTS) {
          attempts.current++;
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (e) {
      console.error('WS connect error:', e);
      if (attempts.current < MAX_RECONNECT_ATTEMPTS) {
        attempts.current++;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    connect();
    return () => {
      mounted.current = false;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { state, logs, connected };
}
