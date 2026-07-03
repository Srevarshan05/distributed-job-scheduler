// src/pages/ProjectsPage.jsx
// Phase 12.3 — Folder-grid view of all projects in the org.
// Each card shows live stats (queue count, running/waiting jobs).
// + New Project modal scoped here; no queue creation without opening a project.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orgs, projects } from '../lib/api';
import Topbar from '../components/Topbar';
import Breadcrumb from '../components/Breadcrumb';
import EmptyState from '../components/EmptyState';

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Stat pill used inside each project card
function StatPill({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '8px 14px', borderRadius: 'var(--radius-md)',
      background: 'var(--color-bg)', border: '1px solid var(--color-border)',
      minWidth: 72,
    }}>
      <span style={{
        fontSize: 18, fontWeight: 800,
        color: accent || 'var(--color-text-primary)', lineHeight: 1,
      }}>{value ?? '—'}</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
    </div>
  );
}

// Single project folder card
function ProjectCard({ project, orgId, onOpen }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    projects.stats(orgId, project.id)
      .then(setStats)
      .catch(() => setStats({ queue_count: 0, jobs_queued: 0, jobs_running: 0, jobs_completed_today: 0, jobs_dead: 0 }));
  }, [orgId, project.id]);

  return (
    <div
      onClick={() => onOpen(project.id)}
      className="card"
      style={{
        cursor: 'pointer', padding: 'var(--space-5)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
        transition: 'box-shadow var(--transition), transform var(--transition)',
        border: '1px solid var(--color-border)',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.transform = '';
      }}
    >
      {/* Folder tab accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'var(--color-primary)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--radius-md)',
          background: 'var(--color-border-light)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
        }}>
          📁
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-base)', color: 'var(--color-text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </div>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            /{project.slug}
          </div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
          color: 'var(--color-text-muted)', background: 'var(--color-border-light)',
          padding: '3px 8px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
        }}>
          {stats ? `${stats.queue_count} queue${stats.queue_count !== 1 ? 's' : ''}` : '…'}
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>
          {project.description}
        </p>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <StatPill label="Waiting" value={stats?.jobs_queued} />
        <StatPill label="Running" value={stats?.jobs_running} accent={stats?.jobs_running > 0 ? '#16a34a' : undefined} />
        <StatPill label="Done Today" value={stats?.jobs_completed_today} />
        <StatPill label="Dead" value={stats?.jobs_dead} accent={stats?.jobs_dead > 0 ? '#dc2626' : undefined} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border-light)' }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          Created {fmt(project.created_at)}
        </span>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>
          Open →
        </span>
      </div>
    </div>
  );
}

// ── Modal overlay helper ──────────────────────────────────────────────────────
function Modal({ onClose, children }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 480, padding: 'var(--space-6)', position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const navigate = useNavigate();
  const [orgId, setOrgId]         = useState(null);
  const [userRole, setUserRole]   = useState('member_read_only');
  const [projectList, setProjectList] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [formName, setFormName]   = useState('');
  const [formSlug, setFormSlug]   = useState('');
  const [formDesc, setFormDesc]   = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating]   = useState(false);

  // Auto-slug from name
  useEffect(() => {
    setFormSlug(
      formName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    );
  }, [formName]);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const orgList = await orgs.list();
      if (!orgList.items?.length) return;
      const org = orgList.items[0];
      setOrgId(org.id);
      setUserRole(org.role || 'member_read_only');
      const projList = await projects.list(org.id, 1);
      setProjectList(projList.items || []);
    } catch (e) {
      console.error('Failed to load projects:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setCreating(true);
    try {
      await projects.create(orgId, { name: formName, slug: formSlug, description: formDesc || null });
      setShowCreate(false);
      setFormName(''); setFormSlug(''); setFormDesc('');
      await loadProjects();
    } catch (err) {
      setFormError(err.message || 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  }

  const canCreate = userRole !== 'member_read_only';

  return (
    <>
      <Topbar
        title="Projects"
        subtitle="Each project is a folder of queues. Open a project to see its queues and submit jobs."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                + New Project
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={loadProjects}>↻ Refresh</button>
          </div>
        }
      />

      <div className="page-body">
        <Breadcrumb items={[{ label: 'Projects' }]} />

        {loading ? (
          <div className="loading-row"><div className="spinner" /> Loading projects…</div>
        ) : projectList.length === 0 ? (
          <EmptyState
            icon="📁"
            title="No projects yet"
            subtitle={canCreate
              ? 'Create your first project to start organizing queues and submitting jobs.'
              : 'No projects have been created in this organization yet.'}
            action={canCreate && (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                + Create First Project
              </button>
            )}
          />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 'var(--space-5)',
          }}>
            {projectList.map(proj => (
              <ProjectCard
                key={proj.id}
                project={proj}
                orgId={orgId}
                onOpen={id => navigate(`/projects/${id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>New Project</h3>
            <button onClick={() => setShowCreate(false)} style={{ fontSize: 18, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>

          {formError && (
            <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-4)' }}>
              {formError}
            </div>
          )}

          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <label style={labelStyle}>Project Name *</label>
              <input
                className="filter-select"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Payments, Email Service, Analytics"
                required
                style={{ width: '100%', padding: '8px 12px' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Slug (auto-generated)</label>
              <input
                className="filter-select"
                value={formSlug}
                onChange={e => setFormSlug(e.target.value)}
                placeholder="url-safe-identifier"
                required
                pattern="^[a-z0-9-]+$"
                title="Lowercase letters, numbers and hyphens only"
                style={{ width: '100%', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-sm)' }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                Used in API paths. Lowercase, hyphens only.
              </span>
            </div>
            <div>
              <label style={labelStyle}>Description (optional)</label>
              <textarea
                rows={3}
                className="filter-select"
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder="What kind of jobs live in this project?"
                style={{ width: '100%', padding: '8px 12px', fontFamily: 'var(--font-base)', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating || !formName}>
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const labelStyle = {
  display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.5px',
  color: 'var(--color-text-secondary)', marginBottom: 6,
};
