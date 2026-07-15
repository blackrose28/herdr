/**
 * WebSocket gateway for Dashboard / Android app clients.
 * Clients authenticate with a fixed access token.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { config } from '../config.js';
import { registry } from '../state/server-registry.js';
import type { ClientMessage } from './protocol.js';

export function handleClientUpgrade(
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: any,
  head: Buffer
): void {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token || token !== config.hubAccessToken) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleClientConnection(ws);
  });
}

function handleClientConnection(ws: WebSocket): void {
  console.log('[client-gateway] Client connected');

  const client = { socket: ws, connectedAt: new Date() };
  registry.addClient(client);

  // Send current state of all servers
  const overview = registry.getOverview();
  for (const server of overview.servers) {
    ws.send(JSON.stringify({
      type: 'server_online',
      data: {
        server_id: server.server_id,
        name: server.name,
        hostname: server.hostname,
        os: server.os,
        herdr_version: server.herdr_version,
      },
    }));

    if (server.state) {
      ws.send(JSON.stringify({
        type: 'server_state',
        data: { server_id: server.server_id, state: server.state },
      }));
    }
  }

  ws.on('message', (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      handleClientMessage(ws, message);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('[client-gateway] Client disconnected');
    registry.removeClient(client);
  });

  ws.on('error', (err) => {
    console.error('[client-gateway] WebSocket error:', err.message);
  });
}

async function handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
  switch (message.type) {
    case 'command': {
      try {
        const result = await registry.sendCommandToServer(
          message.server_id,
          message.method,
          message.params,
          ws
        );
        ws.send(JSON.stringify({
          type: 'command_response',
          id: `${message.method}-${Date.now()}`,
          result,
        }));
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'command_response',
          id: `${message.method}-${Date.now()}`,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
      break;
    }

    case 'subscribe_pane_output':
      registry.subscribePaneOutput(message.server_id, message.pane_id, ws, message.lines);
      break;

    case 'unsubscribe_pane_output':
      registry.unsubscribePaneOutput(message.server_id, message.pane_id, ws);
      break;
  }
}
