import { useState } from 'react';
import { api } from '../api/client';

interface CreateModalProps {
  type: 'workspace' | 'pane';
  serverId: string;
  /** For pane creation — which workspace to target */
  workspaceId?: string;
  /** For pane creation — target pane to split from */
  targetPaneId?: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Pane creation mode:
 * - "new_tab"    — creates a new tab with a fresh pane (like the + button in Herdr terminal)
 * - "split_right" — splits the target pane horizontally (new pane to the right)
 * - "split_down"  — splits the target pane vertically (new pane below)
 */
type PaneMode = 'new_tab' | 'split_right' | 'split_down';

export function CreateModal({ type, serverId, workspaceId, targetPaneId, onClose, onCreated }: CreateModalProps) {
  const [label, setLabel] = useState('');
  const [cwd, setCwd] = useState('');
  const [paneMode, setPaneMode] = useState<PaneMode>('new_tab');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);

    try {
      if (type === 'workspace') {
        await api.sendCommand(serverId, 'workspace.create', {
          ...(label ? { label } : {}),
          ...(cwd ? { cwd } : {}),
          focus: true,
        });
      } else if (paneMode === 'new_tab') {
        // tab.create — same as pressing + in terminal Herdr
        const params: Record<string, unknown> = { focus: true };
        if (workspaceId) params.workspace_id = workspaceId;
        if (cwd) params.cwd = cwd;
        if (label) params.label = label;

        await api.sendCommand(serverId, 'tab.create', params);
      } else {
        // pane.split — Herdr API expects direction = "right" | "down"
        const direction = paneMode === 'split_right' ? 'right' : 'down';
        const params: Record<string, unknown> = {
          direction,
          focus: true,
        };
        if (workspaceId) params.workspace_id = workspaceId;
        if (targetPaneId) params.target_pane_id = targetPaneId;
        if (cwd) params.cwd = cwd;

        await api.sendCommand(serverId, 'pane.split', params);
      }

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card animate-in"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <div className="modal-title">
            {type === 'workspace' ? '✦ New Workspace' : '⊞ New Pane'}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">


          {type === 'pane' && (
            <div className="form-group">
              <label className="form-label">Mode</label>
              <div className="split-direction-picker">
                <button
                  className={`split-direction-btn ${paneMode === 'new_tab' ? 'active' : ''}`}
                  onClick={() => setPaneMode('new_tab')}
                  type="button"
                  id="pane-mode-new-tab"
                >
                  <div className="split-direction-icon split-new-tab">
                    <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
                  </div>
                  <span>New Tab</span>
                </button>
                <button
                  className={`split-direction-btn ${paneMode === 'split_right' ? 'active' : ''}`}
                  onClick={() => setPaneMode('split_right')}
                  type="button"
                  id="pane-mode-split-right"
                >
                  <div className="split-direction-icon split-horizontal">
                    <div /><div />
                  </div>
                  <span>Split Right</span>
                </button>
                <button
                  className={`split-direction-btn ${paneMode === 'split_down' ? 'active' : ''}`}
                  onClick={() => setPaneMode('split_down')}
                  type="button"
                  id="pane-mode-split-down"
                >
                  <div className="split-direction-icon split-vertical">
                    <div /><div />
                  </div>
                  <span>Split Down</span>
                </button>
              </div>
              <div className="form-hint">
                {paneMode === 'new_tab'
                  ? 'Creates a new tab with a fresh terminal — like the ＋ button in Herdr'
                  : paneMode === 'split_right'
                  ? 'Splits the current pane horizontally, adding a new pane to the right'
                  : 'Splits the current pane vertically, adding a new pane below'}
              </div>
            </div>
          )}

          {(type === 'workspace' || paneMode === 'new_tab') && (
            <div className="form-group">
              <label className="form-label">{type === 'workspace' ? 'Workspace Label' : 'Tab Label'}</label>
              <input
                className="form-input"
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={type === 'workspace' ? 'e.g. Backend, Frontend, Testing…' : 'e.g. Build, Logs, Debug…'}
                autoFocus={type === 'workspace' || paneMode === 'new_tab'}
              />
              <div className="form-hint">Optional — leave blank for default naming</div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Working Directory</label>
            <input
              className="form-input form-input-mono"
              type="text"
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              placeholder="e.g. /home/user/project"
              autoFocus={type === 'pane' && paneMode !== 'new_tab'}
            />
            <div className="form-hint">Optional — defaults to home directory</div>
          </div>

          {error && (
            <div className="modal-error">{error}</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            {loading
              ? 'Creating…'
              : type === 'workspace'
              ? 'Create Workspace'
              : paneMode === 'new_tab'
              ? 'Create Tab'
              : 'Split Pane'}
          </button>
        </div>
      </div>
    </div>
  );
}
