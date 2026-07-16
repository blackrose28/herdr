import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, subscribePaneOutput, getWebSocket } from '../api/client';
import { useHubStore } from '../stores/hub-store';
import { TerminalPane, type TerminalPaneHandle } from '../components/TerminalPane';

export function AgentViewPage() {
  const { serverId, paneId } = useParams<{ serverId: string; paneId: string }>();
  const navigate = useNavigate();
  const server = useHubStore(s => s.getServer(serverId || ''));
  const wsStatus = useHubStore(s => s.wsStatus);
  const agent = server?.state?.agents?.find(a => a.pane_id === paneId);
  const pane = server?.state?.panes?.find(p => p.pane_id === paneId);

  // Derive display values from agent or pane
  const displayName = agent?.display_agent || agent?.agent || agent?.name || pane?.display_agent || pane?.agent || pane?.label || pane?.cwd?.split('/').pop() || 'Terminal';
  const displayStatus = agent?.agent_status || pane?.agent_status || 'unknown';
  const displayCwd = agent?.cwd || pane?.cwd;
  const isAgent = !!agent;
  const stateLabels = agent?.state_labels || pane?.state_labels || {};

  const [terminalContent, setTerminalContent] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<'streaming' | 'polling' | 'idle'>('idle');
  const terminalPaneRef = useRef<TerminalPaneHandle>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRevisionRef = useRef<number>(0);

  const loadPaneContent = useCallback(async () => {
    if (!serverId || !paneId) return;
    try {
      setLoadError(null);
      const result = await api.readPane(serverId, paneId, 'recent', 100);
      // Herdr response shape: { result: { type: "pane_read", read: { text: "...", revision: N } } }
      const text =
        result.result?.read?.text ??   // Herdr canonical: result.read.text
        result.result?.text ??          // Flat: result.text
        result.read?.text ??            // No wrapper
        result.text;                    // Direct
      if (text !== undefined) {
        setTerminalContent(text);
      } else {
        setTerminalContent('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to read pane:', msg);
      setLoadError(msg);
    } finally {
      setInitialLoading(false);
    }
  }, [serverId, paneId]);

  // Initial load
  useEffect(() => {
    if (serverId && paneId) {
      setInitialLoading(true);
      loadPaneContent();
    }
  }, [serverId, paneId, loadPaneContent]);

  // Real-time streaming via WebSocket with REST polling fallback
  useEffect(() => {
    if (!serverId || !paneId) return;

    let unsubscribe: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    // Try WebSocket streaming first
    const ws = getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStreamStatus('streaming');
      unsubscribe = subscribePaneOutput(serverId, paneId, (text, revision) => {
        if (revision !== lastRevisionRef.current) {
          lastRevisionRef.current = revision;
          setTerminalContent(text);
          setLoadError(null);
          setInitialLoading(false);
        }
      });
    } else {
      // Fallback to REST polling when WebSocket is not available
      setStreamStatus('polling');
      fallbackTimer = setInterval(loadPaneContent, 2000);
    }

    return () => {
      if (unsubscribe) unsubscribe();
      if (fallbackTimer) clearInterval(fallbackTimer);
      setStreamStatus('idle');
    };
  }, [serverId, paneId, wsStatus, loadPaneContent]);

  // Switch to polling if WebSocket disconnects, back to streaming when reconnected
  useEffect(() => {
    if (!serverId || !paneId) return;

    if (wsStatus === 'disconnected' && streamStatus === 'streaming') {
      // WebSocket dropped — start polling as fallback
      setStreamStatus('polling');
      pollTimerRef.current = setInterval(loadPaneContent, 2000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [wsStatus, streamStatus, serverId, paneId, loadPaneContent]);

  // Auto-scroll is handled by xterm.js TerminalPane internally

  async function handleSend() {
    if (!inputText.trim() || !serverId || !paneId) return;
    setLoading(true);
    try {
      // Hub routes this through pane.send_input which handles bracketed paste
      // mode correctly for both regular shells and coding agents
      await api.sendToPane(serverId, paneId, inputText + '\n');
      setInputText('');
      // If not streaming, refresh content after sending
      if (streamStatus !== 'streaming') {
        setTimeout(loadPaneContent, 500);
      }
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!server) {
    return (
      <div className="animate-in">
        <div className="back-link" onClick={() => navigate('/')}>← Back to Overview</div>
        <div className="empty-state">
          <div className="empty-state-title">Server not found</div>
        </div>
      </div>
    );
  }

  if (!agent && !pane) {
    return (
      <div className="animate-in">
        <div className="back-link" onClick={() => navigate(`/server/${serverId}`)}>
          ← Back to {server.name}
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">Pane not found</div>
          <div className="empty-state-text">This pane may have been closed or the server state hasn't synced yet.</div>
        </div>
      </div>
    );
  }

  const streamLabel = streamStatus === 'streaming'
    ? '● LIVE'
    : streamStatus === 'polling'
    ? '◐ POLLING'
    : '';

  const streamColor = streamStatus === 'streaming'
    ? 'var(--status-working)'
    : streamStatus === 'polling'
    ? 'var(--text-muted)'
    : undefined;

  return (
    <div className="animate-in">
      <div className="back-link" onClick={() => navigate(`/server/${serverId}`)}>
        ← Back to {server.name}
      </div>

      <div className="detail-header">
        <div className="detail-header-icon">
          <span className={`status-dot ${displayStatus}`} style={{ width: 12, height: 12 }} />
        </div>
        <div className="detail-header-info">
          <div className="detail-header-title">
            {displayName}
          </div>
          <div className="detail-header-meta">
            {isAgent ? (
              <span className={`agent-badge ${displayStatus}`}>
                {displayStatus}
              </span>
            ) : (
              <span className="pane-item-type" style={{ fontSize: 11 }}>terminal</span>
            )}
            {displayCwd && (
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                {displayCwd}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadPaneContent}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* State labels / metadata */}
      {Object.keys(stateLabels).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {Object.entries(stateLabels).map(([key, value]) => (
            <div key={key} className="stat-card" style={{ padding: '10px 14px' }}>
              <div className="stat-card-label">{key}</div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Terminal */}
      <div className="terminal-container">
        <div className="terminal-header">
          <div className="terminal-title">
            <span className={`status-dot ${displayStatus}`} />
            Terminal Output
            {streamLabel && (
              <span style={{ color: streamColor, fontSize: 10, fontWeight: 400, marginLeft: 8 }}>
                {streamLabel}
              </span>
            )}
          </div>
          <div className="terminal-actions">
            <button className="btn btn-ghost btn-sm" onClick={loadPaneContent}>
              Reload
            </button>
          </div>
        </div>

        <div className="terminal-body terminal-body-xterm">
          {initialLoading ? (
            <div className="terminal-placeholder">
              <span style={{ color: 'var(--text-muted)' }}>Loading terminal content...</span>
            </div>
          ) : loadError ? (
            <div className="terminal-placeholder">
              <span style={{ color: 'var(--status-error)' }}>Error: {loadError}</span>
            </div>
          ) : (
            <TerminalPane
              ref={terminalPaneRef}
              content={terminalContent}
              minHeight={300}
              maxHeight={600}
              fontSize={13}
            />
          )}
        </div>

        <div className="terminal-input-bar">
          <input
            className="terminal-input"
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAgent ? "Type a message for the agent..." : "Type a command and press Enter to send..."}
            disabled={loading}
          />
          <button
            className="terminal-send-btn"
            onClick={handleSend}
            disabled={loading || !inputText.trim()}
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
