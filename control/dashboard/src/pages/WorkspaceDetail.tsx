import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHubStore } from '../stores/hub-store';
import { api } from '../api/client';
import { CreateModal } from '../components/CreateModal';

type ModalState =
  | null
  | { type: 'pane'; workspaceId: string; targetPaneId?: string };

export function WorkspaceDetailPage() {
  const { serverId, workspaceId } = useParams<{ serverId: string; workspaceId: string }>();
  const navigate = useNavigate();
  const server = useHubStore(s => s.getServer(serverId || ''));
  const { setServersFromOverview } = useHubStore();
  const [modal, setModal] = useState<ModalState>(null);

  const refreshOverview = () => {
    api.getOverview().then(setServersFromOverview).catch(() => {});
  };

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

  const workspace = server.state?.workspaces?.find(ws => ws.workspace_id === workspaceId);

  if (!workspace) {
    return (
      <div className="animate-in">
        <div className="back-link" onClick={() => navigate(`/server/${serverId}`)}>
          ← Back to {server.name}
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">Workspace not found</div>
          <div className="empty-state-text">This workspace may have been closed or the server state hasn't synced yet.</div>
        </div>
      </div>
    );
  }

  const allTabs = server.state?.tabs || [];
  const allPanes = server.state?.panes || [];
  const allAgents = server.state?.agents || [];

  const tabs = allTabs.filter(t => t.workspace_id === workspaceId);
  const panes = allPanes.filter(p => p.workspace_id === workspaceId);
  const agents = allAgents.filter(a => a.workspace_id === workspaceId);
  const firstPaneInWs = panes[0];

  const workingAgents = agents.filter(a => a.agent_status === 'working').length;
  const blockedAgents = agents.filter(a => a.agent_status === 'blocked').length;

  const getAgentForPane = (paneId: string) => agents.find(a => a.pane_id === paneId);
  const getPanesForTab = (tabId: string) => panes.filter(p => p.tab_id === tabId);

  return (
    <div className="animate-in">
      {/* Breadcrumb */}
      <div className="ws-breadcrumb">
        <span className="ws-breadcrumb-item" onClick={() => navigate('/')}>
          Overview
        </span>
        <span className="ws-breadcrumb-sep">›</span>
        <span className="ws-breadcrumb-item" onClick={() => navigate(`/server/${serverId}`)}>
          {server.name}
        </span>
        <span className="ws-breadcrumb-sep">›</span>
        <span className="ws-breadcrumb-current">{workspace.label}</span>
      </div>

      {/* Workspace Header */}
      <div className="detail-header">
        <div className="ws-detail-icon">
          <span className={`status-dot ${workspace.agent_status}`} style={{ width: 10, height: 10 }} />
          <span className="ws-detail-number">#{workspace.number}</span>
        </div>
        <div className="detail-header-info">
          <div className="detail-header-title">
            {workspace.label}
            {workspace.focused && (
              <span className="ws-focused-badge">focused</span>
            )}
          </div>
          <div className="detail-header-meta">
            <span>{server.name}</span>
            {workspace.worktree && (
              <>
                <span>•</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                  {workspace.worktree.repo_name}
                </span>
              </>
            )}
          </div>
        </div>
        {server.is_online && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setModal({
              type: 'pane',
              workspaceId: workspace.workspace_id,
              targetPaneId: firstPaneInWs?.pane_id,
            })}
            id="ws-add-pane-btn"
          >
            ＋ Add Pane
          </button>
        )}
      </div>

      {/* Stats Row */}
      <div className="stats-row">
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
        {agents.length > 0 && (
          <>
            <div className="stat-card">
              <div className="stat-card-label">Working</div>
              <div className="stat-card-value working">{workingAgents}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Blocked</div>
              <div className="stat-card-value blocked">{blockedAgents}</div>
            </div>
          </>
        )}
      </div>

      {/* Worktree Info */}
      {workspace.worktree && (
        <div className="section">
          <div className="section-title">Repository</div>
          <div className="ws-repo-card">
            <div className="ws-repo-row">
              <span className="ws-repo-label">Repository</span>
              <span className="ws-repo-value">{workspace.worktree.repo_name}</span>
            </div>
            <div className="ws-repo-row">
              <span className="ws-repo-label">Root</span>
              <span className="ws-repo-value mono">{workspace.worktree.repo_root}</span>
            </div>
            <div className="ws-repo-row">
              <span className="ws-repo-label">Checkout</span>
              <span className="ws-repo-value mono">{workspace.worktree.checkout_path}</span>
            </div>
            {workspace.worktree.is_linked_worktree && (
              <div className="ws-repo-row">
                <span className="ws-repo-label">Type</span>
                <span className="ws-repo-value">
                  <span className="ws-worktree-badge">linked worktree</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agents in this workspace */}
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

      {/* Tabs & Panes Tree */}
      <div className="section">
        <div className="section-title">Tabs & Panes</div>
        {tabs.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-title">No tabs</div>
            <div className="empty-state-text">
              {server.is_online
                ? 'Add a pane to create a tab in this workspace.'
                : 'Server is offline — tabs will appear when it reconnects.'}
            </div>
          </div>
        ) : (
          <div className="ws-tabs-grid">
            {tabs.map(tab => {
              const tabPanes = getPanesForTab(tab.tab_id);
              return (
                <div key={tab.tab_id} className="ws-tab-card">
                  <div className="ws-tab-header">
                    <span className="ws-tab-icon">📁</span>
                    <span className="ws-tab-label">{tab.label}</span>
                    {tab.focused && (
                      <span className="ws-focused-badge" style={{ fontSize: 9 }}>active</span>
                    )}
                    <span className="ws-tab-count">{tab.pane_count} panes</span>
                  </div>
                  <div className="ws-tab-panes">
                    {tabPanes.map(pane => {
                      const paneAgent = getAgentForPane(pane.pane_id);
                      return (
                        <div
                          key={pane.pane_id}
                          className="ws-pane-row"
                          onClick={() => navigate(`/server/${serverId}/pane/${pane.pane_id}`)}
                        >
                          <span className={`status-dot ${pane.agent_status}`} />
                          <span className="ws-pane-label">
                            {pane.label || pane.display_agent || pane.agent || pane.cwd?.split('/').pop() || pane.pane_id}
                          </span>
                          {pane.cwd && (
                            <span className="ws-pane-cwd" title={pane.cwd}>
                              {pane.cwd.split('/').slice(-2).join('/')}
                            </span>
                          )}
                          {paneAgent ? (
                            <span className={`agent-badge ${pane.agent_status}`} style={{ fontSize: 10 }}>
                              {pane.agent_status}
                            </span>
                          ) : (
                            <span className="pane-item-type">terminal</span>
                          )}
                          <span className="ws-pane-arrow">→</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tokens */}
      {workspace.tokens && Object.keys(workspace.tokens).length > 0 && (
        <div className="section">
          <div className="section-title">Tokens</div>
          <div className="ws-tokens-grid">
            {Object.entries(workspace.tokens).map(([key, value]) => (
              <div key={key} className="stat-card" style={{ padding: '10px 14px' }}>
                <div className="stat-card-label">{key}</div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'JetBrains Mono' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {modal && serverId && (
        <CreateModal
          type={modal.type}
          serverId={serverId}
          workspaceId={modal.workspaceId}
          targetPaneId={modal.targetPaneId}
          onClose={() => setModal(null)}
          onCreated={refreshOverview}
        />
      )}
    </div>
  );
}
