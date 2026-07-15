import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useHubStore } from '../stores/hub-store';
import type { WorkspaceInfo, TabInfo, PaneInfo, AgentInfo } from '../api/client';

export function ServerDetailPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const server = useHubStore(s => s.getServer(serverId || ''));
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());

  // Auto-expand first workspace
  useEffect(() => {
    if (server?.state?.workspaces?.length) {
      setExpandedWorkspaces(new Set([server.state.workspaces[0].workspace_id]));
    }
  }, [server?.state?.workspaces?.length]);

  if (!server) {
    return (
      <div className="animate-in">
        <div className="back-link" onClick={() => navigate('/')}>← Back to Overview</div>
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <div className="empty-state-title">Server not found</div>
          <div className="empty-state-text">This server may be offline or has been removed.</div>
        </div>
      </div>
    );
  }

  const workspaces = server.state?.workspaces || [];
  const tabs = server.state?.tabs || [];
  const panes = server.state?.panes || [];
  const agents = server.state?.agents || [];

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getTabsForWorkspace = (wsId: string) => tabs.filter(t => t.workspace_id === wsId);
  const getPanesForTab = (tabId: string) => panes.filter(p => p.tab_id === tabId);
  const getAgentForPane = (paneId: string) => agents.find(a => a.pane_id === paneId);

  return (
    <div className="animate-in">
      <div className="back-link" onClick={() => navigate('/')}>← Back to Overview</div>

      <div className="detail-header">
        <div className="detail-header-icon">
          {server.is_online ? '🟢' : '🔴'}
        </div>
        <div className="detail-header-info">
          <div className="detail-header-title">{server.name}</div>
          <div className="detail-header-meta">
            {server.hostname && <span>{server.hostname}</span>}
            {server.os && <span>• {server.os}</span>}
            {server.herdr_version && <span>• Herdr v{server.herdr_version}</span>}
            <span className={`server-card-status ${server.is_online ? 'online' : 'offline'}`}>
              <span className={`status-dot ${server.is_online ? 'online' : 'offline'}`} />
              {server.is_online ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-label">Workspaces</div>
          <div className="stat-card-value">{workspaces.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Tabs</div>
          <div className="stat-card-value">{tabs.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Panes</div>
          <div className="stat-card-value">{panes.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Agents</div>
          <div className="stat-card-value accent">{agents.length}</div>
        </div>
      </div>

      {/* Agents section */}
      {agents.length > 0 && (
        <div className="section">
          <div className="section-title">Agents</div>
          <div className="agent-list">
            {agents.map(agent => (
              <div
                key={agent.pane_id}
                className="agent-row"
                onClick={() => navigate(`/server/${serverId}/pane/${agent.pane_id}`)}
              >
                <span className={`status-dot ${agent.agent_status}`} />
                <span className="agent-row-name">
                  {agent.display_agent || agent.agent || agent.name || 'Unknown Agent'}
                </span>
                <span className={`agent-badge ${agent.agent_status}`}>
                  {agent.agent_status}
                </span>
                <span className="agent-row-detail">
                  {agent.cwd?.split('/').slice(-2).join('/') || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workspace tree */}
      <div className="section">
        <div className="section-title">Workspaces</div>
        {workspaces.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No workspaces</div>
          </div>
        ) : (
          <div className="workspace-tree">
            {workspaces.map(ws => {
              const isExpanded = expandedWorkspaces.has(ws.workspace_id);
              const wsTabs = getTabsForWorkspace(ws.workspace_id);

              return (
                <div key={ws.workspace_id} className="workspace-item">
                  <div
                    className={`workspace-item-header ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => toggleWorkspace(ws.workspace_id)}
                  >
                    <span className="chevron">{isExpanded ? '▼' : '▶'}</span>
                    <span className={`status-dot ${ws.agent_status}`} />
                    <span className="workspace-item-label">{ws.label}</span>
                    <div className="workspace-item-counts">
                      <span>{ws.tab_count} tabs</span>
                      <span>{ws.pane_count} panes</span>
                    </div>
                    {ws.worktree && (
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono' }}>
                        {ws.worktree.repo_name}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="tab-list">
                      {wsTabs.map(tab => {
                        const tabPanes = getPanesForTab(tab.tab_id);
                        return (
                          <div key={tab.tab_id}>
                            <div className="tab-item">
                              <span style={{ color: 'var(--text-tertiary)' }}>📁</span>
                              <span style={{ fontWeight: 500 }}>{tab.label}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto' }}>
                                {tab.pane_count} panes
                              </span>
                            </div>
                            {tabPanes.map(pane => {
                              const paneAgent = getAgentForPane(pane.pane_id);
                              return (
                                <div
                                  key={pane.pane_id}
                                  className="pane-item clickable"
                                  onClick={() => navigate(`/server/${serverId}/pane/${pane.pane_id}`)}
                                >
                                  <span className={`status-dot ${pane.agent_status}`} />
                                  <span className="pane-item-label">
                                    {pane.label || pane.display_agent || pane.agent || pane.cwd?.split('/').pop() || pane.pane_id}
                                  </span>
                                  {paneAgent ? (
                                    <span className={`agent-badge ${pane.agent_status}`} style={{ fontSize: 10 }}>
                                      {pane.agent_status}
                                    </span>
                                  ) : (
                                    <span className="pane-item-type">terminal</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
