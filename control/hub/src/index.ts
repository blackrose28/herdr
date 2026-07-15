/**
 * Herdr Hub — Centralized control panel for Herdr agent runtime servers.
 *
 * Entry point: starts Express HTTP server with REST API + dual WebSocket gateways.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { router } from './api/router.js';
import { handleServerUpgrade } from './ws/server-gateway.js';
import { handleClientUpgrade } from './ws/client-gateway.js';

const app = express();

// ─── Middleware ───

app.use(express.json());

// CORS
app.use((_req, res, next) => {
  const origin = config.corsOrigins.includes('*') ? '*' : config.corsOrigins.join(',');
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ─── REST API ───

app.use('/api', router);

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// ─── HTTP + WebSocket Server ───

const httpServer = createServer(app);
const serverWss = new WebSocketServer({ noServer: true });
const clientWss = new WebSocketServer({ noServer: true });

// Route WebSocket upgrades to the correct gateway
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);

  if (url.pathname === '/ws/server') {
    handleServerUpgrade(serverWss, request, socket, head);
  } else if (url.pathname === '/ws/client') {
    handleClientUpgrade(clientWss, request, socket, head);
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

httpServer.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║              Herdr Hub v0.1.0                    ║
╠══════════════════════════════════════════════════╣
║  REST API:    http://localhost:${config.port}/api          ║
║  Health:      http://localhost:${config.port}/health       ║
║  Server WS:   ws://localhost:${config.port}/ws/server      ║
║  Client WS:   ws://localhost:${config.port}/ws/client      ║
╚══════════════════════════════════════════════════╝
  `);
});
