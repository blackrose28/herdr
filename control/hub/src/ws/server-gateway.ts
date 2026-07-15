/**
 * WebSocket gateway for Herdr connector plugins.
 * Connectors authenticate with an API key and maintain a persistent connection.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { servers } from '../db/schema.js';
import { registry } from '../state/server-registry.js';
import type { ConnectorMessage } from './protocol.js';

export async function handleServerUpgrade(
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: any,
  head: Buffer
): Promise<void> {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const apiKey = url.searchParams.get('key');

  if (!apiKey) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const apiKeyHash = hashApiKey(apiKey);

  // Look up server by API key hash
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.apiKeyHash, apiKeyHash))
    .limit(1);

  if (!server) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Check if already connected — disconnect old connection
  const existing = registry.getServer(server.id);
  if (existing) {
    existing.socket.close(1000, 'Replaced by new connection');
    registry.removeServer(server.id);
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleServerConnection(ws, server.id, server.name, apiKeyHash);
  });
}

function handleServerConnection(ws: WebSocket, serverId: string, serverName: string, apiKeyHash: string): void {
  console.log(`[server-gateway] Server connected: ${serverName} (${serverId})`);

  registry.addServer({
    serverId,
    name: serverName,
    apiKeyHash,
    socket: ws,
    state: null,
    heartbeat: null,
    connectedAt: new Date(),
    lastHeartbeat: new Date(),
    paneOutputSubscribers: new Map(),
  });

  // Mark server online in DB
  db.update(servers)
    .set({ isOnline: true, lastSeenAt: new Date() })
    .where(eq(servers.id, serverId))
    .then(() => {})
    .catch(err => console.error('[server-gateway] Failed to update server status:', err));

  // Request initial state
  ws.send(JSON.stringify({ type: 'request_snapshot' }));

  ws.on('message', (data) => {
    try {
      const message: ConnectorMessage = JSON.parse(data.toString());
      handleConnectorMessage(serverId, message);
    } catch (err) {
      console.error('[server-gateway] Invalid message from connector:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[server-gateway] Server disconnected: ${serverName} (${serverId})`);
    registry.removeServer(serverId);

    db.update(servers)
      .set({ isOnline: false, lastSeenAt: new Date() })
      .where(eq(servers.id, serverId))
      .then(() => {})
      .catch(err => console.error('[server-gateway] Failed to update server status:', err));
  });

  ws.on('error', (err) => {
    console.error(`[server-gateway] WebSocket error for ${serverName}:`, err.message);
  });
}

function handleConnectorMessage(serverId: string, message: ConnectorMessage): void {
  switch (message.type) {
    case 'state_snapshot':
      registry.updateServerState(serverId, message.data);
      break;

    case 'event':
      registry.handleServerEvent(serverId, message.data);
      break;

    case 'heartbeat':
      registry.updateServerHeartbeat(serverId, message.data);
      db.update(servers)
        .set({
          lastSeenAt: new Date(),
          hostname: message.data.hostname,
          os: message.data.os,
          herdrVersion: message.data.herdr_version,
        })
        .where(eq(servers.id, serverId))
        .then(() => {})
        .catch(() => {});
      break;

    case 'command_response':
      registry.handleCommandResponse(message.id, message.result, message.error);
      break;

    case 'pane_output':
      registry.handlePaneOutput(serverId, message.pane_id, message.text, message.revision);
      break;
  }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
