/**
 * Mock Herdr connector — simulates a real Herdr server for integration testing.
 * Connects to the Hub via WebSocket, sends fake but realistic state,
 * and simulates agent activity with periodic status changes.
 */

import WebSocket from 'ws';

const HUB_URL = process.env.HUB_URL || 'ws://localhost:3001';
const API_KEY = process.env.API_KEY || '';

if (!API_KEY) {
  console.error('Usage: API_KEY=hdr_xxx node mock-connector.js');
  process.exit(1);
}

console.log(`[mock] Connecting to ${HUB_URL}/ws/server...`);

const ws = new WebSocket(`${HUB_URL}/ws/server?key=${encodeURIComponent(API_KEY)}`);

// ─── Mock state ───

const mockState = {
  workspaces: [
    {
      workspace_id: 'ws-1',
      number: 1,
      label: 'herdr-core',
      focused: true,
      pane_count: 3,
      tab_count: 2,
      active_tab_id: 'tab-1',
      agent_status: 'working',
      tokens: {},
      worktree: {
        repo_key: 'herdr',
        repo_name: 'herdr',
        repo_root: '/home/can/Projects/herdr',
        checkout_path: '/home/can/Projects/herdr',
        is_linked_worktree: false,
      },
    },
    {
      workspace_id: 'ws-2',
      number: 2,
      label: 'web-dashboard',
      focused: false,
      pane_count: 2,
      tab_count: 1,
      active_tab_id: 'tab-3',
      agent_status: 'idle',
      tokens: {},
      worktree: {
        repo_key: 'herdr-dashboard',
        repo_name: 'herdr-dashboard',
        repo_root: '/home/can/Projects/herdr-dashboard',
        checkout_path: '/home/can/Projects/herdr-dashboard',
        is_linked_worktree: false,
      },
    },
  ],
  tabs: [
    { tab_id: 'tab-1', workspace_id: 'ws-1', number: 1, label: 'main', focused: true, pane_count: 2 },
    { tab_id: 'tab-2', workspace_id: 'ws-1', number: 2, label: 'tests', focused: false, pane_count: 1 },
    { tab_id: 'tab-3', workspace_id: 'ws-2', number: 1, label: 'dev', focused: false, pane_count: 2 },
  ],
  panes: [
    {
      pane_id: 'pane-1', terminal_id: 'term-1', workspace_id: 'ws-1', tab_id: 'tab-1',
      focused: true, cwd: '/home/can/Projects/herdr/src', label: 'Claude Code',
      agent: 'claude', display_agent: 'Claude Code', agent_status: 'working',
      state_labels: { model: 'Claude 4 Sonnet', cost: '$0.42', turns: '12' },
      tokens: { input: '45200', output: '12800' }, revision: 42,
    },
    {
      pane_id: 'pane-2', terminal_id: 'term-2', workspace_id: 'ws-1', tab_id: 'tab-1',
      focused: false, cwd: '/home/can/Projects/herdr', label: 'Shell',
      agent_status: 'idle', state_labels: {}, tokens: {}, revision: 10,
    },
    {
      pane_id: 'pane-3', terminal_id: 'term-3', workspace_id: 'ws-1', tab_id: 'tab-2',
      focused: false, cwd: '/home/can/Projects/herdr', label: 'Gemini CLI',
      agent: 'gemini', display_agent: 'Gemini CLI', agent_status: 'blocked',
      state_labels: { status: 'Waiting for user input' },
      tokens: {}, revision: 28,
    },
    {
      pane_id: 'pane-4', terminal_id: 'term-4', workspace_id: 'ws-2', tab_id: 'tab-3',
      focused: false, cwd: '/home/can/Projects/herdr-dashboard/src', label: 'Cursor',
      agent: 'cursor', display_agent: 'Cursor', agent_status: 'done',
      state_labels: { mode: 'Agent', file: 'App.tsx' },
      tokens: {}, revision: 55,
    },
    {
      pane_id: 'pane-5', terminal_id: 'term-5', workspace_id: 'ws-2', tab_id: 'tab-3',
      focused: false, cwd: '/home/can/Projects/herdr-dashboard',
      label: 'npm dev', agent_status: 'idle', state_labels: {},
      tokens: {}, revision: 5,
    },
  ],
  agents: [
    {
      terminal_id: 'term-1', name: 'claude-code', agent: 'claude', title: 'Claude Code',
      display_agent: 'Claude Code', agent_status: 'working',
      state_labels: { model: 'Claude 4 Sonnet', cost: '$0.42', turns: '12' },
      tokens: { input: '45200', output: '12800' },
      workspace_id: 'ws-1', tab_id: 'tab-1', pane_id: 'pane-1',
      focused: true, cwd: '/home/can/Projects/herdr/src', revision: 42,
    },
    {
      terminal_id: 'term-3', name: 'gemini-cli', agent: 'gemini', title: 'Gemini CLI',
      display_agent: 'Gemini CLI', agent_status: 'blocked',
      state_labels: { status: 'Waiting for user input' },
      tokens: {},
      workspace_id: 'ws-1', tab_id: 'tab-2', pane_id: 'pane-3',
      focused: false, cwd: '/home/can/Projects/herdr', revision: 28,
    },
    {
      terminal_id: 'term-4', name: 'cursor', agent: 'cursor', title: 'Cursor',
      display_agent: 'Cursor', agent_status: 'done',
      state_labels: { mode: 'Agent', file: 'App.tsx' },
      tokens: {},
      workspace_id: 'ws-2', tab_id: 'tab-3', pane_id: 'pane-4',
      focused: false, cwd: '/home/can/Projects/herdr-dashboard/src', revision: 55,
    },
  ],
};

// ─── Mock terminal output ───

const mockTerminalOutput = `$ cargo build --release
   Compiling herdr v0.7.0 (/home/can/Projects/herdr)
   Compiling herdr-server v0.7.0 (/home/can/Projects/herdr/crates/server)
   Compiling herdr-detect v0.7.0 (/home/can/Projects/herdr/crates/detect)
   Compiling herdr-api v0.7.0 (/home/can/Projects/herdr/crates/api)
   Compiling herdr-tui v0.7.0 (/home/can/Projects/herdr/crates/tui)
    Finished release [optimized] target(s) in 45.23s

$ just check
Running cargo nextest...
  ● test platform::linux::tests::pty_spawn_echo ... passed (0.12s)
  ● test detect::manifest::tests::parse_valid ... passed (0.01s)
  ● test app::state::tests::workspace_create ... passed (0.03s)
  ● test api::schema::tests::event_serialize ... passed (0.01s)
  ● test persist::tests::plugin_registry ... passed (0.08s)
  ● test render::tests::compute_view_split ... passed (0.02s)

Test Results: 42 passed, 0 failed — 100% pass rate

Claude Code is analyzing the codebase for potential improvements...

[Agent] I found 3 suggestions for improving error handling in src/api/server.rs.
Would you like me to apply them?`;

// ─── WebSocket handlers ───

ws.on('open', () => {
  console.log('[mock] ✅ Connected to Hub');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(`[mock] Received: ${msg.type}`);

  switch (msg.type) {
    case 'request_snapshot':
      console.log('[mock] Sending state snapshot...');
      ws.send(JSON.stringify({ type: 'state_snapshot', data: mockState }));

      // Also send heartbeat
      ws.send(JSON.stringify({
        type: 'heartbeat',
        data: {
          uptime_seconds: 3600,
          herdr_version: '0.7.0',
          hostname: 'dev-workstation',
          os: 'linux',
        },
      }));
      break;

    case 'command': {
      console.log(`[mock] Command: ${msg.method} (id=${msg.id})`);

      // Handle pane.read with mock terminal output
      if (msg.method === 'pane.read') {
        ws.send(JSON.stringify({
          type: 'command_response',
          id: msg.id,
          result: { text: mockTerminalOutput, revision: 42 },
        }));
      }
      // Handle pane.send_text
      else if (msg.method === 'pane.send_text') {
        console.log(`[mock] Text sent to pane: "${msg.params?.text}"`);
        ws.send(JSON.stringify({
          type: 'command_response',
          id: msg.id,
          result: { ok: true },
        }));
      }
      else {
        ws.send(JSON.stringify({
          type: 'command_response',
          id: msg.id,
          result: { ok: true },
        }));
      }
      break;
    }

    case 'subscribe_pane_output':
      console.log(`[mock] Subscribing to pane output: ${msg.pane_id}`);
      // Send initial output
      ws.send(JSON.stringify({
        type: 'pane_output',
        pane_id: msg.pane_id,
        text: mockTerminalOutput,
        revision: 42,
      }));
      break;

    case 'unsubscribe_pane_output':
      console.log(`[mock] Unsubscribing from pane output: ${msg.pane_id}`);
      break;
  }
});

ws.on('close', (code, reason) => {
  console.log(`[mock] Disconnected: code=${code} reason=${reason.toString()}`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[mock] Error:', err.message);
});

// Simulate agent status changes periodically
let statusCycle = 0;
const statuses = ['working', 'working', 'blocked', 'working', 'done', 'idle', 'working'];

setInterval(() => {
  statusCycle = (statusCycle + 1) % statuses.length;
  const newStatus = statuses[statusCycle];

  // Update Claude Code agent status
  mockState.agents[0].agent_status = newStatus;
  mockState.panes[0].agent_status = newStatus;

  // Send event
  ws.send(JSON.stringify({
    type: 'event',
    data: {
      event: 'pane.agent_status_changed',
      pane_id: 'pane-1',
      agent: 'claude',
      display_agent: 'Claude Code',
      agent_status: newStatus,
    },
  }));

  // Send updated snapshot
  ws.send(JSON.stringify({ type: 'state_snapshot', data: mockState }));

  console.log(`[mock] Agent status changed: Claude Code → ${newStatus}`);
}, 10000);

// Keep alive
setInterval(() => {
  ws.send(JSON.stringify({
    type: 'heartbeat',
    data: {
      uptime_seconds: Math.floor((Date.now() - Date.now()) / 1000) + 3600,
      herdr_version: '0.7.0',
      hostname: 'dev-workstation',
      os: 'linux',
    },
  }));
}, 30000);

console.log('[mock] Mock connector running. Agent status will cycle every 10s.');
console.log('[mock] Press Ctrl+C to stop.');
