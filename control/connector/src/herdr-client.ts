/**
 * Client for the Herdr local Unix socket API.
 * Sends JSON-RPC-style requests and parses responses.
 */

import { connect as netConnect, Socket } from 'net';

const HERDR_SOCKET_PATH = process.env.HERDR_SOCKET_PATH;

export interface HerdrResponse {
  id: string;
  result?: any;
  error?: { code: string; message: string };
}

let requestCounter = 0;

/**
 * Send a single request to the Herdr socket API and return the response.
 */
export function herdrRequest(method: string, params: Record<string, unknown> = {}): Promise<HerdrResponse> {
  const socketPath = HERDR_SOCKET_PATH;
  if (!socketPath) {
    return Promise.reject(new Error('HERDR_SOCKET_PATH is not set'));
  }

  return new Promise((resolve, reject) => {
    const id = `connector-${++requestCounter}`;
    const socket = netConnect(socketPath);
    let data = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`Herdr request timed out: ${method}`));
      }
    }, 10000);

    socket.on('connect', () => {
      const request = JSON.stringify({ id, method, params });
      socket.write(request + '\n');
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
    });

    socket.on('end', () => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      try {
        const response = JSON.parse(data.trim());
        resolve(response);
      } catch (err) {
        reject(new Error(`Invalid response from Herdr: ${data.slice(0, 200)}`));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error(`Herdr socket error: ${err.message}`));
      }
    });
  });
}

/**
 * Subscribe to Herdr events via a persistent socket connection.
 * Calls `onEvent` for each event received, and `onError` on failure.
 * Returns a function to close the subscription.
 */
export function herdrSubscribe(
  subscriptions: Array<{ type: string }>,
  onEvent: (event: any) => void,
  onError: (error: Error) => void
): () => void {
  const socketPath = HERDR_SOCKET_PATH;
  if (!socketPath) {
    onError(new Error('HERDR_SOCKET_PATH is not set'));
    return () => {};
  }

  const socket = netConnect(socketPath);
  let buffer = '';
  let isFirstMessage = true;

  socket.on('connect', () => {
    const request = JSON.stringify({
      id: 'event-sub',
      method: 'events.subscribe',
      params: { subscriptions },
    });
    socket.write(request + '\n');
  });

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (isFirstMessage) {
          // First message is the subscription confirmation
          isFirstMessage = false;
          if (parsed.error) {
            onError(new Error(`Subscription failed: ${parsed.error.message}`));
            socket.destroy();
          }
          continue;
        }
        onEvent(parsed);
      } catch {
        // Skip unparseable lines
      }
    }
  });

  socket.on('error', (err) => {
    onError(new Error(`Event subscription socket error: ${err.message}`));
  });

  socket.on('close', () => {
    onError(new Error('Event subscription socket closed'));
  });

  return () => {
    socket.destroy();
  };
}
