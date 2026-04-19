// src/modules/wsServer.js
// Manages WebSocket connections and broadcasts state to all connected clients.

const WebSocket = require('ws');
const { createLogger } = require('../utils/logger');
const log = createLogger('WSServer');

class WSServer {
  constructor(httpServer, stateManager) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
    this.stateManager = stateManager;
    this._clients = new Set();

    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));

    // Subscribe to state changes
    stateManager.on('stateChange', snapshot => {
      this._broadcast({ type: 'state', payload: snapshot });
    });

    stateManager.on('log', entry => {
      this._broadcast({ type: 'log', payload: entry });
    });

    log.info('WebSocket server initialized');
  }

  _onConnection(ws, req) {
    const ip = req.socket.remoteAddress;
    log.info(`WebSocket client connected: ${ip}`);
    this._clients.add(ws);

    // Send current state immediately on connect
    ws.send(JSON.stringify({
      type: 'state',
      payload: this.stateManager.getSnapshot(),
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        log.debug('WS message received', { msg });
        // Could handle client->server messages here if needed
      } catch {
        log.warn('Invalid WS message received');
      }
    });

    ws.on('close', () => {
      this._clients.delete(ws);
      log.info(`WebSocket client disconnected: ${ip}`);
    });

    ws.on('error', (err) => {
      log.error(`WebSocket error for ${ip}: ${err.message}`);
      this._clients.delete(ws);
    });

    // Ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  }

  _broadcast(message) {
    const data = JSON.stringify(message);
    for (const ws of this._clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data, err => {
          if (err) {
            log.warn('WS send error', { error: err.message });
            this._clients.delete(ws);
          }
        });
      }
    }
  }

  // Periodic ping to detect dead connections
  startHeartbeat(intervalMs = 30000) {
    setInterval(() => {
      for (const ws of this._clients) {
        if (!ws.isAlive) {
          ws.terminate();
          this._clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, intervalMs);
  }

  getClientCount() {
    return this._clients.size;
  }
}

module.exports = { WSServer };
