// src/pages/QueuesPage.jsx
// Manage queues in a project with scheduling policy and required worker type support (Phase 9.1 & 9.2).
// Renders Breadcrumbs, Empty State when no queues exist, and a modal for creating new queues.

import { useEffect, useState } from 'react';
import { orgs, projects, queues } from '../lib/api';
import Topbar from '../components/Topbar';
import Breadcrumb from '../components/Breadcrumb';
import EmptyState from '../components/EmptyState';
import queueLogo from '../assets/queue.png';

const SCHEDULING_POLICIES = [
  { key: 'priority', label: 'Priority First' },
  { key: 'fifo', label: 'First In First Out (FIFO)' },
  { key: 'fair_share', label: 'Fair Share (Queue Rotation)' }
];

const WORKER_TYPES = [
  { key: 'standard', label: 'Standard Workers' },
  { key: 'high_compute', label: 'High Compute Workers' }
];

export default function QueuesPage() {
  const [queuesList, setQueuesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [userRole, setUserRole] = useState('member_read_only');
  const [updating, setUpdating] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Project Creation State
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [formProjName, setFormProjName] = useState('');
  const [formProjSlug, setFormProjSlug] = useState('');
  const [projectCreating, setProjectCreating] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formMaxWorkers, setFormMaxWorkers] = useState(1);
  const [formRetryLimit, setFormRetryLimit] = useState(3);
  const [formRetryStrategy, setFormRetryStrategy] = useState('exponential');
  const [formRetryDelay, setFormRetryDelay] = useState(60);
  const [formWorkerType, setFormWorkerType] = useState('standard');
  const [formPolicy, setFormPolicy] = useState('priority');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    loadQueues();
  }, []);

  // Auto-fill slug from name
  useEffect(() => {
    const slug = formName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    setFormSlug(slug);
  }, [formName]);

  // Auto-fill project slug from name
  useEffect(() => {
    const slug = formProjName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    setFormProjSlug(slug);
  }, [formProjName]);

  async function loadQueues() {
    setLoading(true);
    try {
      const orgList = await orgs.list();
      if (!orgList.items?.length) { setLoading(false); return; }
      const org = orgList.items[0];
      setOrgId(org.id);
      setUserRole(org.role || 'member_read_only');

      const projList = await projects.list(org.id);
      if (!projList.items?.length) {
        setProjectId(null);
        setProjectName('');
        setQueuesList([]);
        setLoading(false);
        return;
      }
      const proj = projList.items[0];
      setProjectId(proj.id);
      setProjectName(proj.name);

      const qList = await queues.list(org.id, proj.id);
      setQueuesList(qList.items || []);
    } catch (e) {
      console.error('Failed to load queues:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject(e) {
    e.preventDefault();
    setFormError('');
    setProjectCreating(true);
    try {
      const orgList = await orgs.list();
      if (!orgList.items?.length) {
        throw new Error('No active organization found.');
      }
      const org = orgList.items[0];
      await projects.create(org.id, {
        name: formProjName,
        slug: formProjSlug,
        description: 'Organization workspace project.'
      });
      setFormProjName('');
      setFormProjSlug('');
      setShowCreateProject(false);
      await loadQueues();
    } catch (err) {
      setFormError(err.message || 'Failed to create project.');
    } finally {
      setProjectCreating(false);
    }
  }

  async function togglePause(queue) {
    setUpdating(prev => ({ ...prev, [queue.id]: true }));
    try {
      if (queue.is_paused) {
        await queues.resume(orgId, projectId, queue.id);
      } else {
        await queues.pause(orgId, projectId, queue.id);
      }
      const qList = await queues.list(orgId, projectId);
      setQueuesList(qList.items || []);
    } catch (e) {
      console.error('Failed to toggle queue pause:', e);
    } finally {
      setUpdating(prev => ({ ...prev, [queue.id]: false }));
    }
  }

  async function handleCreateQueue(e) {
    e.preventDefault();
    setFormError('');
    setCreating(true);

    try {
      await queues.create(orgId, projectId, {
        name: formName,
        slug: formSlug,
        description: formDesc || null,
        max_workers: parseInt(formMaxWorkers),
        retry_limit: parseInt(formRetryLimit),
        retry_strategy: formRetryStrategy,
        retry_delay_seconds: parseInt(formRetryDelay),
        required_worker_type: formWorkerType,
        scheduling_policy: formPolicy
      });

      // Clear Form
      setFormName('');
      setFormSlug('');
      setFormDesc('');
      setFormMaxWorkers(1);
      setFormRetryLimit(3);
      setFormRetryStrategy('exponential');
      setFormRetryDelay(60);
      setFormWorkerType('standard');
      setFormPolicy('priority');
      setShowCreate(false);

      // Reload
      await loadQueues();
    } catch (err) {
      setFormError(err.message || 'Failed to create queue.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Topbar
        title="Queues"
        subtitle={`Manage queues in project: ${projectName || '—'}`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-outline btn-sm" onClick={loadQueues}>
              ↻ Refresh
            </button>
            {userRole !== 'member_read_only' && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} disabled={!projectId}>
                + Create Queue
              </button>
            )}
          </div>
        }
      />
      <div className="page-body">
        <Breadcrumb items={[
          { label: 'Queues', to: '/queues' },
          { label: projectName || 'Active Project' }
        ]} />

        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-title">Active Queue Subscriptions</div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              ✦ Enforce resource constraints and select scheduling policies per queue.
            </div>
          </div>

          {loading ? (
            <div className="loading-row"><div className="spinner" /> Loading queues…</div>
          ) : !projectId ? (
            <EmptyState
              icon="📁"
              title="No project found in organization"
              subtitle="Every queue belongs to a project. Create a project under this organization to configure queues."
              actionLabel={userRole === 'member_read_only' ? null : "Create Project"}
              onAction={userRole === 'member_read_only' ? null : () => setShowCreateProject(true)}
            />
          ) : queuesList.length === 0 ? (
            <EmptyState
              icon={queueLogo}
              title="No queues configured"
              subtitle="Queues group jobs and route them to standard or high-compute workers. Create your first queue to get started."
              actionLabel={userRole === 'member_read_only' ? null : "Create Queue"}
              onAction={userRole === 'member_read_only' ? null : () => setShowCreate(true)}
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>SLUG</th>
                  <th>SCHEDULING POLICY</th>
                  <th>ROUTING CAPABILITY</th>
                  <th style={{ textAlign: 'center' }}>MAX WORKERS</th>
                  <th>RETRY LIMIT / STRATEGY</th>
                  <th>RETRY DELAY</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {queuesList.map(q => (
                  <tr key={q.id}>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{q.name}</span>
                      {q.description && (
                        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                          {q.description}
                        </div>
                      )}
                    </td>
                    <td className="td-mono">{q.slug}</td>
                    <td>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 12,
                        background: q.scheduling_policy === 'fair_share' ? 'var(--color-warning-light)' : 'var(--color-border-light)',
                        color: q.scheduling_policy === 'fair_share' ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                        fontWeight: 600
                      }}>
                        {SCHEDULING_POLICIES.find(p => p.key === q.scheduling_policy)?.label || q.scheduling_policy}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 12,
                        background: q.required_worker_type === 'high_compute' ? 'var(--color-primary-light)' : 'var(--color-border-light)',
                        color: q.required_worker_type === 'high_compute' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        fontWeight: 600
                      }}>
                        {q.required_worker_type || 'standard'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{q.max_workers}</td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{q.retry_limit} attempts</span>
                      <div className="text-xs text-muted" style={{ textTransform: 'capitalize' }}>
                        {q.retry_strategy} strategy
                      </div>
                    </td>
                    <td>{q.retry_delay_seconds}s</td>
                    <td>
                      <span className={`badge ${q.is_paused ? 'badge-danger' : 'badge-success'}`}>
                        {q.is_paused ? 'Paused' : 'Active'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className={`btn btn-sm ${q.is_paused ? 'btn-outline' : 'btn-danger-outline'}`}
                        onClick={() => togglePause(q)}
                        disabled={updating[q.id] || userRole === 'member_read_only'}
                        style={{ padding: '4px 12px', minWidth: 80 }}
                      >
                        {updating[q.id] ? 'Updating…' : q.is_paused ? 'Resume' : 'Pause'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Queue Modal */}
      {showCreate && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Create New Queue</h3>
              <button onClick={() => setShowCreate(false)} style={{ fontSize: 18, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
            </div>
            <form onSubmit={handleCreateQueue} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {formError && (
                <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)' }}>
                  {formError}
                </div>
              )}

              {/* Identity & Description Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Identity & Purpose</h4>
                <div style={formRowStyle}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Queue Display Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Email Dispatcher"
                      className="filter-select"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      A friendly name describing what type of tasks this queue holds.
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Queue Slug (ID)</label>
                    <input
                      type="text"
                      required
                      placeholder="email-dispatcher"
                      className="filter-select"
                      value={formSlug}
                      onChange={e => setFormSlug(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      System identifier (lowercase, letters and hyphens only).
                    </span>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={labelStyle}>Queue Purpose (Description)</label>
                  <textarea
                    rows="2"
                    placeholder="Optional details about this queue's operational responsibility..."
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontFamily: 'inherit', fontSize: 'var(--font-sm)', background: 'var(--color-surface)', outline: 'none' }}
                  />
                </div>
              </div>

              {/* Routing & Policy Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Routing & Order Policies</h4>
                <div style={formRowStyle}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Task Dispatch Order</label>
                    <select
                      className="filter-select"
                      value={formPolicy}
                      onChange={e => setFormPolicy(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      <option value="priority">Priority First (Urgent tasks run first)</option>
                      <option value="fifo">First In First Out (FIFO - Strict order)</option>
                      <option value="fair_share">Fair Share (Alternates queues to prevent starvation)</option>
                    </select>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Determines which tasks are picked up first if multiple tasks are waiting.
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Allocated Worker Capability</label>
                    <select
                      className="filter-select"
                      value={formWorkerType}
                      onChange={e => setFormWorkerType(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      <option value="standard">Standard Worker (General background jobs)</option>
                      <option value="high_compute">High Compute Worker (Heavy workload execution)</option>
                    </select>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Matches standard background workers or intensive compute nodes to this queue.
                    </span>
                  </div>
                </div>
              </div>

              {/* Concurrency & Retries Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Concurrency limits & Error Retries</h4>
                <div style={formRowStyle}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Active Worker Concurrency Limit</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      className="filter-select"
                      value={formMaxWorkers}
                      onChange={e => setFormMaxWorkers(e.target.value)}
                      required
                      style={{ width: '100%', padding: '8px 12px' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Max workers allowed to pull tasks from this queue at the same time.
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Failure Retry limit</label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      className="filter-select"
                      value={formRetryLimit}
                      onChange={e => setFormRetryLimit(e.target.value)}
                      required
                      style={{ width: '100%', padding: '8px 12px' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Attempts allowed before the job is moved to the Dead Letter Queue.
                    </span>
                  </div>
                </div>
                <div style={{ ...formRowStyle, marginTop: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Retry Interval Strategy</label>
                    <select
                      className="filter-select"
                      value={formRetryStrategy}
                      onChange={e => setFormRetryStrategy(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      <option value="fixed">Fixed delay interval</option>
                      <option value="linear">Linear increase interval</option>
                      <option value="exponential">Exponential backoff delay (Recommended)</option>
                    </select>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Determines how long to wait before trying again after a task fails.
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Initial Retry Delay (seconds)</label>
                    <input
                      type="number"
                      min="1"
                      className="filter-select"
                      value={formRetryDelay}
                      onChange={e => setFormRetryDelay(e.target.value)}
                      required
                      style={{ width: '100%', padding: '8px 12px' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Wait duration before performing the very first retry attempt.
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create Queue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateProject && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Create New Project</h3>
              <button onClick={() => setShowCreateProject(false)} style={{ fontSize: 18, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
            </div>
            <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {formError && (
                <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)' }}>
                  {formError}
                </div>
              )}
              <div>
                <label style={labelStyle}>Project Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production Workspace"
                  className="filter-select"
                  value={formProjName}
                  onChange={e => setFormProjName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px' }}
                />
              </div>
              <div>
                <label style={labelStyle}>Project Slug (ID)</label>
                <input
                  type="text"
                  required
                  placeholder="production-workspace"
                  className="filter-select"
                  value={formProjSlug}
                  onChange={e => setFormProjSlug(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowCreateProject(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={projectCreating}>
                  {projectCreating ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// Modal Inline Styles (Consistent with JobExplorerPage)
const modalOverlayStyle = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalContentStyle = {
  width: 550,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: 'var(--space-5)',
};

const formRowStyle = {
  display: 'flex',
  gap: 'var(--space-4)',
};

const labelStyle = {
  display: 'block',
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--color-text-secondary)',
  marginBottom: 6,
};
