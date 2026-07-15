import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useHubStore } from '../stores/hub-store';

export function AgentViewPage() {
  const { serverId, paneId } = useParams<{ serverId: string; paneId: string }>();
  const navigate = useNavigate();
  const server = useHubStore(s => s.getServer(serverId || ''));
  const agent = server?.state?.agents?.find(a => a.pane_id === paneId);

  const [terminalContent, setTerminalContent] = useState('');
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Initial load
  useEffect(() => {
    if (serverId && paneId) {
      loadPaneContent();
    }
  }, [serverId, paneId]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && serverId && paneId) {
      refreshTimerRef.current = setInterval(loadPaneContent, 1000);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [autoRefresh, serverId, paneId]);

  // Auto-scroll
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalContent]);

  async function loadPaneContent() {
    if (!serverId || !paneId) return;
    try {
      const result = await api.readPane(serverId, paneId, 'recent', 100);
      if (result.result?.text !== undefined) {
        setTerminalContent(result.result.text);
      }
    } catch (err) {
      console.error('Failed to read pane:', err);
    }
  }

  async function handleSend() {
    if (!inputText.trim() || !serverId || !paneId) return;
    setLoading(true);
    try {
      await api.sendToPane(serverId, paneId, inputText + '\n');
      setInputText('');
      // Refresh content after sending
      setTimeout(loadPaneContent, 500);
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

  return (
    <div className="animate-in">
      <div className="back-link" onClick={() => navigate(`/server/${serverId}`)}>
        ← Back to {server.name}
      </div>

      <div className="detail-header">
        <div className="detail-header-icon">
          <span className={`status-dot ${agent?.agent_status || 'unknown'}`} style={{ width: 12, height: 12 }} />
        </div>
        <div className="detail-header-info">
          <div className="detail-header-title">
            {agent?.display_agent || agent?.agent || agent?.name || 'Terminal'}
          </div>
          <div className="detail-header-meta">
            <span className={`agent-badge ${agent?.agent_status || 'unknown'}`}>
              {agent?.agent_status || 'unknown'}
            </span>
            {agent?.cwd && (
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                {agent.cwd}
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
          <button
            className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '⏸ Stop' : '▶ Live'}
          </button>
        </div>
      </div>

      {/* Agent metadata */}
      {agent && Object.keys(agent.state_labels).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {Object.entries(agent.state_labels).map(([key, value]) => (
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
            <span className={`status-dot ${agent?.agent_status || 'unknown'}`} />
            Terminal Output
            {autoRefresh && (
              <span style={{ color: 'var(--status-working)', fontSize: 10, fontWeight: 400 }}>
                ● LIVE
              </span>
            )}
          </div>
          <div className="terminal-actions">
            <button className="btn btn-ghost btn-sm" onClick={loadPaneContent}>
              Reload
            </button>
          </div>
        </div>

        <div className="terminal-body" ref={terminalRef}>
          {terminalContent || 'No output yet. Click "Refresh" to load terminal content.'}
        </div>

        <div className="terminal-input-bar">
          <input
            className="terminal-input"
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message and press Enter to send..."
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
