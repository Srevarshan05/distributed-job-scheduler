// src/pages/ProjectDetailPage.jsx
// Phase 12.4 — Open a project and see its queues + recent jobs.
// Breadcrumb: Projects → {project name}
// Queues are only creatable from inside this page — enforcing hierarchy.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { orgs, projects, queues, jobs } from '../lib/api';
import Topbar from '../components/Topbar';
import Breadcrumb from '../components/Breadcrumb';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';

const SCHEDULING_LABELS = {
  priority:   'Priority First',
  fifo:       'FIFO',
  fair_share: 'Fair Share',
};

const WORKER_LABELS = {
  standard:     'Standard',
  high_compute: 'High Compute',
};

const STRATEGY_LABELS = {
  fixed:       'Fixed',
  linear:      'Linear',
  exponential: 'Exponential',
};

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}
function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Stat chip in the project header ──────────────────────────────────────────
function Chip({ icon, label, value, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      fontSize: 'var(--font-sm)',
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontWeight: 700, color: accent || 'var(--color-text-primary)' }}>{value ?? '—'}</span>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)' }}>{label}</span>
    </div>
  );
}

// ── Queue card ────────────────────────────────────────────────────────────────
function QueueCard({ queue: q, orgId, projectId, onTogglePause, toggling }) {
  return (
    <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-base)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {q.name}
          </div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', marginTop: 2 }}>
            /{q.slug}
          </div>
        </div>
        {q.is_paused && (
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: '#fef9c3', color: '#854d0e', padding: '3px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid #fef08a' }}>
            Paused
          </span>
        )}
      </div>

      {/* Tags row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { label: SCHEDULING_LABELS[q.scheduling_policy] || q.scheduling_policy },
          { label: WORKER_LABELS[q.required_worker_type] || q.required_worker_type },
          { label: `${STRATEGY_LABELS[q.retry_strategy]} retry · ${q.retry_limit}×` },
          { label: `${q.max_workers} worker${q.max_workers !== 1 ? 's' : ''}` },
        ].map(t => (
          <span key={t.label} style={{
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px',
            background: 'var(--color-border-light)', color: 'var(--color-text-secondary)',
            padding: '3px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
          }}>{t.label}</span>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border-light)' }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          Created {fmtDate(q.created_at)}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn btn-sm ${q.is_paused ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '3px 10px', fontSize: 11 }}
            disabled={toggling}
            onClick={() => onTogglePause(q)}
          >
            {toggling ? '…' : q.is_paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function Modal({ onClose, children }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto', padding: 'var(--space-5)' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const LABEL = { display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', marginBottom: 6 };
const ROW   = { display: 'flex', gap: 'var(--space-4)' };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [orgId, setOrgId]             = useState(null);
  const [userRole, setUserRole]       = useState('member_read_only');
  const [project, setProject]         = useState(null);
  const [stats, setStats]             = useState(null);
  const [queuesList, setQueuesList]   = useState([]);
  const [recentJobs, setRecentJobs]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [toggling, setToggling]       = useState({});

  // Queue creation modal state
  const [showCreate, setShowCreate]         = useState(false);
  const [formName, setFormName]             = useState('');
  const [formSlug, setFormSlug]             = useState('');
  const [formDesc, setFormDesc]             = useState('');
  const [formMaxWorkers, setFormMaxWorkers] = useState(1);
  const [formRetryLimit, setFormRetryLimit] = useState(3);
  const [formRetryStrategy, setFormRetryStrategy] = useState('exponential');
  const [formRetryDelay, setFormRetryDelay] = useState(60);
  const [formWorkerType, setFormWorkerType] = useState('standard');
  const [formPolicy, setFormPolicy]         = useState('priority');
  const [formError, setFormError]           = useState('');
  const [creating, setCreating]             = useState(false);

  // Auto-slug from name
  useEffect(() => {
    setFormSlug(formName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
  }, [formName]);

  useEffect(() => { loadAll(); }, [projectId]);

  async function loadAll() {
    setLoading(true);
    try {
      // Resolve org
      const orgList = await orgs.list();
      if (!orgList.items?.length) return;
      const org = orgList.items[0];
      setOrgId(org.id);
      setUserRole(org.role || 'member_read_only');

      // Load project
      const proj = await projects.get(org.id, projectId);
      setProject(proj);

      // Load stats (non-blocking — we show skeletons if not yet ready)
      projects.stats(org.id, projectId).then(setStats).catch(() => {});

      // Load queues
      const qList = await queues.list(org.id, projectId);
      const qs = qList.items || [];
      setQueuesList(qs);

      // Load recent jobs across all queues in this project (up to 15 total)
      const jobsPerQueue = 5;
      const jobResults = await Promise.all(
        qs.map(q =>
          jobs.list(q.id, { page_size: jobsPerQueue }).catch(() => ({ items: [] }))
        )
      );
      const flat = jobResults
        .flatMap(r => r.items || [])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 15);
      setRecentJobs(flat);
    } catch (e) {
      console.error('Failed to load project detail:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePause(q) {
    setToggling(prev => ({ ...prev, [q.id]: true }));
    try {
      if (q.is_paused) {
        await queues.resume(orgId, projectId, q.id);
      } else {
        await queues.pause(orgId, projectId, q.id);
      }
      const qList = await queues.list(orgId, projectId);
      setQueuesList(qList.items || []);
    } catch (e) {
      console.error('Toggle pause failed:', e);
    } finally {
      setToggling(prev => ({ ...prev, [q.id]: false }));
    }
  }

  async function handleCreateQueue(e) {
    e.preventDefault();
    setFormError('');
    setCreating(true);
    try {
      await queues.create(orgId, projectId, {
        name: formName, slug: formSlug, description: formDesc || null,
        max_workers: parseInt(formMaxWorkers),
        retry_limit: parseInt(formRetryLimit),
        retry_strategy: formRetryStrategy,
        retry_delay_seconds: parseInt(formRetryDelay),
        required_worker_type: formWorkerType,
        scheduling_policy: formPolicy,
      });
      setShowCreate(false);
      setFormName(''); setFormSlug(''); setFormDesc('');
      setFormMaxWorkers(1); setFormRetryLimit(3); setFormRetryStrategy('exponential');
      setFormRetryDelay(60); setFormWorkerType('standard'); setFormPolicy('priority');
      await loadAll();
    } catch (err) {
      setFormError(err.message || 'Failed to create queue.');
    } finally {
      setCreating(false);
    }
  }

  const canWrite = userRole !== 'member_read_only';

  if (loading) {
    return (
      <>
        <Topbar title="Project" subtitle="Loading…" />
        <div className="page-body">
          <div className="loading-row"><div className="spinner" /> Loading project…</div>
        </div>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Topbar title="Not Found" subtitle="This project does not exist or you don't have access." />
        <div className="page-body">
          <EmptyState icon="◈" title="Project not found" subtitle="Go back to Projects to choose a valid project." action={<button className="btn btn-outline" onClick={() => navigate('/projects')}>← Back to Projects</button>} />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={project.name}
        subtitle={project.description || 'Project workspace'}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {canWrite && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                + New Queue
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={loadAll}>↻ Refresh</button>
          </div>
        }
      />

      <div className="page-body">
        <Breadcrumb items={[
          { label: 'Projects', to: '/projects' },
          { label: project.name },
        ]} />

        {/* Stats header row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <Chip icon="📋" label="queues" value={stats?.queue_count ?? queuesList.length} />
          <Chip icon="⏳" label="waiting" value={stats?.jobs_queued} />
          <Chip icon="▶" label="running" value={stats?.jobs_running} accent={stats?.jobs_running > 0 ? '#16a34a' : undefined} />
          <Chip icon="✓" label="done today" value={stats?.jobs_completed_today} />
          <Chip icon="💀" label="dead" value={stats?.jobs_dead} accent={stats?.jobs_dead > 0 ? '#dc2626' : undefined} />
        </div>

        {/* ── Queues section ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 'var(--space-7)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                Queues
              </h2>
              <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
                Queues in this project — workers pick up jobs from here.
              </p>
            </div>
            {canWrite && (
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(true)}>
                + New Queue
              </button>
            )}
          </div>

          {queuesList.length === 0 ? (
            <EmptyState
              icon="◫"
              title="No queues yet"
              subtitle={canWrite ? 'Create a queue to start submitting jobs to this project.' : 'No queues have been created in this project.'}
              action={canWrite && (
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create First Queue</button>
              )}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
              {queuesList.map(q => (
                <QueueCard
                  key={q.id}
                  queue={q}
                  orgId={orgId}
                  projectId={projectId}
                  onTogglePause={handleTogglePause}
                  toggling={!!toggling[q.id]}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Recent Jobs section ────────────────────────────────────────── */}
        {recentJobs.length > 0 && (
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                Recent Jobs
              </h2>
              <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
                Last {recentJobs.length} jobs across all queues in this project.
              </p>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>JOB TYPE</th>
                    <th>QUEUE</th>
                    <th>STATUS</th>
                    <th>SUBMITTED BY</th>
                    <th>ATTEMPTS</th>
                    <th>CREATED</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map(job => {
                    const queueName = queuesList.find(q => q.id === job.queue_id)?.name || '—';
                    return (
                      <tr key={job.id} className="fade-in-row">
                        <td>
                          <Link
                            to={`/jobs/${job.queue_id}/${job.id}`}
                            style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none', fontSize: 'var(--font-sm)' }}
                          >
                            {job.job_type}
                          </Link>
                          <div className="td-mono mt-1">{job.id?.slice(0, 8)}…</div>
                        </td>
                        <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-xs)' }}>
                          {queueName}
                        </td>
                        <td>
                          <StatusBadge status={job.status} />
                        </td>
                        <td style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-secondary)' }}>
                          {job.created_by_email || 'system'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 'var(--font-sm)' }}>
                          <span style={{ fontWeight: 600 }}>{job.attempts_made}</span>
                          <span className="text-muted">/{job.max_attempts}</span>
                        </td>
                        <td style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
                          {fmt(job.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 'var(--space-3)', textAlign: 'right' }}>
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/jobs')}>
                View all jobs in Job Explorer →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Queue Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, margin: 0 }}>New Queue</h3>
              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
                Scoped to project: <strong>{project.name}</strong>
              </p>
            </div>
            <button onClick={() => setShowCreate(false)} style={{ fontSize: 18, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>

          {formError && (
            <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-4)' }}>
              {formError}
            </div>
          )}

          <form onSubmit={handleCreateQueue} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Name + slug */}
            <div style={ROW}>
              <div style={{ flex: 2 }}>
                <label style={LABEL}>Queue Name *</label>
                <input className="filter-select" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Email Queue" required style={{ width: '100%', padding: '8px 12px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={LABEL}>Slug</label>
                <input className="filter-select" value={formSlug} onChange={e => setFormSlug(e.target.value)} required pattern="^[a-z0-9-]+$" style={{ width: '100%', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-sm)' }} />
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={LABEL}>Description</label>
              <input className="filter-select" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional description" style={{ width: '100%', padding: '8px 12px' }} />
            </div>

            {/* Retry policy */}
            <div>
              <h4 style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12 }}>
                Retry Policy
              </h4>
              <div style={ROW}>
                <div style={{ flex: 1 }}>
                  <label style={LABEL}>Strategy</label>
                  <select className="filter-select" value={formRetryStrategy} onChange={e => setFormRetryStrategy(e.target.value)} style={{ width: '100%' }}>
                    <option value="exponential">Exponential Backoff</option>
                    <option value="linear">Linear Backoff</option>
                    <option value="fixed">Fixed Delay</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={LABEL}>Retry Limit</label>
                  <input type="number" min={0} max={50} className="filter-select" value={formRetryLimit} onChange={e => setFormRetryLimit(e.target.value)} style={{ width: '100%', padding: '8px 12px' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={LABEL}>Base Delay (s)</label>
                  <input type="number" min={1} className="filter-select" value={formRetryDelay} onChange={e => setFormRetryDelay(e.target.value)} style={{ width: '100%', padding: '8px 12px' }} />
                </div>
              </div>
            </div>

            {/* Scheduling + worker type */}
            <div>
              <h4 style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12 }}>
                Routing & Concurrency
              </h4>
              <div style={ROW}>
                <div style={{ flex: 1 }}>
                  <label style={LABEL}>Scheduling</label>
                  <select className="filter-select" value={formPolicy} onChange={e => setFormPolicy(e.target.value)} style={{ width: '100%' }}>
                    <option value="priority">Priority First</option>
                    <option value="fifo">FIFO</option>
                    <option value="fair_share">Fair Share</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={LABEL}>Worker Type</label>
                  <select className="filter-select" value={formWorkerType} onChange={e => setFormWorkerType(e.target.value)} style={{ width: '100%' }}>
                    <option value="standard">Standard</option>
                    <option value="high_compute">High Compute</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={LABEL}>Max Workers</label>
                  <input type="number" min={1} max={100} className="filter-select" value={formMaxWorkers} onChange={e => setFormMaxWorkers(e.target.value)} style={{ width: '100%', padding: '8px 12px' }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating || !formName}>
                {creating ? 'Creating…' : 'Create Queue'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
