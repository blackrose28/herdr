/**
 * REST API router for the Hub.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { servers } from '../db/schema.js';
import { registry } from '../state/server-registry.js';
import { hashApiKey } from '../ws/server-gateway.js';
import { requireAuth } from './auth.js';

export const router = Router();

// All routes require authentication
router.use(requireAuth);

// ─── Server management ───

/**
 * POST /api/servers
 * Register a new Herdr server. Returns the generated API key (shown only once).
 */
router.post('/servers', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const apiKey = `hdr_${randomBytes(32).toString('hex')}`;
    const apiKeyHashValue = hashApiKey(apiKey);

    const [server] = await db.insert(servers).values({
      name,
      apiKeyHash: apiKeyHashValue,
    }).returning();

    res.status(201).json({
      id: server.id,
      name: server.name,
      api_key: apiKey, // Only returned once at creation time
      created_at: server.createdAt,
    });
  } catch (err) {
    console.error('[api] Failed to create server:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/servers
 * List all registered servers with online status.
 */
router.get('/servers', async (_req, res) => {
  try {
    const allServers = await db.select().from(servers);
    const result = allServers.map(s => {
      const connected = registry.getServer(s.id);
      return {
        id: s.id,
        name: s.name,
        hostname: connected?.heartbeat?.hostname || s.hostname,
        os: connected?.heartbeat?.os || s.os,
        herdr_version: connected?.heartbeat?.herdr_version || s.herdrVersion,
        is_online: !!connected,
        last_seen_at: s.lastSeenAt,
        created_at: s.createdAt,
      };
    });
    res.json({ servers: result });
  } catch (err) {
    console.error('[api] Failed to list servers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/servers/:id
 * Unregister a server and disconnect it.
 */
router.delete('/servers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Disconnect if online
    const connected = registry.getServer(id);
    if (connected) {
      connected.socket.close(1000, 'Server removed');
      registry.removeServer(id);
    }

    await db.delete(servers).where(eq(servers.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error('[api] Failed to delete server:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Aggregated overview ───

/**
 * GET /api/overview
 * Aggregated view of all servers, workspaces, and agent statuses.
 */
router.get('/overview', (_req, res) => {
  const overview = registry.getOverview();
  res.json(overview);
});

// ─── Per-server state ───

/**
 * GET /api/servers/:id/workspaces
 */
router.get('/servers/:id/workspaces', (req, res) => {
  const server = registry.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found or offline' });
    return;
  }
  res.json({ workspaces: server.state?.workspaces || [] });
});

/**
 * GET /api/servers/:id/agents
 */
router.get('/servers/:id/agents', (req, res) => {
  const server = registry.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found or offline' });
    return;
  }
  res.json({ agents: server.state?.agents || [] });
});

/**
 * GET /api/servers/:id/panes
 */
router.get('/servers/:id/panes', (req, res) => {
  const server = registry.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found or offline' });
    return;
  }
  res.json({ panes: server.state?.panes || [] });
});

/**
 * GET /api/servers/:id/tabs
 */
router.get('/servers/:id/tabs', (req, res) => {
  const server = registry.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found or offline' });
    return;
  }
  res.json({ tabs: server.state?.tabs || [] });
});

// ─── Command forwarding ───

/**
 * POST /api/servers/:id/command
 * Send a Herdr API command to a specific server.
 * Body: { method: "pane.read", params: { pane_id: "..." } }
 */
router.post('/servers/:id/command', async (req, res) => {
  try {
    const { method, params } = req.body;
    if (!method || typeof method !== 'string') {
      res.status(400).json({ error: 'method is required' });
      return;
    }

    const result = await registry.sendCommandToServer(
      req.params.id,
      method,
      params || {}
    );
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * POST /api/servers/:id/panes/:paneId/read
 * Convenience endpoint to read terminal content from a pane.
 */
router.post('/servers/:id/panes/:paneId/read', async (req, res) => {
  try {
    const { source = 'recent', lines, format = 'ansi' } = req.body || {};
    const result = await registry.sendCommandToServer(
      req.params.id,
      'pane.read',
      {
        pane_id: req.params.paneId,
        source,
        lines,
        format,
      }
    );
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * POST /api/servers/:id/panes/:paneId/send
 * Send text to a pane. Uses pane.send_input which handles bracketed paste mode
 * correctly for coding agents.
 */
router.post('/servers/:id/panes/:paneId/send', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    // Use pane.send_input instead of pane.send_text:
    // pane.send_input wraps text in bracketed paste sequences when the terminal
    // has bracketed paste mode enabled (common for coding agents like Grok, Claude).
    // pane.send_text sends raw bytes which get swallowed by bracketed paste mode.
    // Split text from trailing newline — send text as paste, Enter as key.
    const hasTrailingNewline = text.endsWith('\n');
    const textContent = hasTrailingNewline ? text.slice(0, -1) : text;

    const result = await registry.sendCommandToServer(
      req.params.id,
      'pane.send_input',
      {
        pane_id: req.params.paneId,
        text: textContent,
        keys: hasTrailingNewline ? ['enter'] : [],
      }
    );
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * POST /api/servers/:id/agents/start
 * Start a new agent on a server.
 */
router.post('/servers/:id/agents/start', async (req, res) => {
  try {
    const { name, argv, cwd, workspace_id, focus = true } = req.body;
    if (!name || !argv) {
      res.status(400).json({ error: 'name and argv are required' });
      return;
    }

    const result = await registry.sendCommandToServer(
      req.params.id,
      'agent.start',
      { name, argv, cwd, workspace_id, focus }
    );
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});
