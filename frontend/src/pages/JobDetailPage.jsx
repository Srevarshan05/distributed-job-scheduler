// src/pages/JobDetailPage.jsx
// Granular job detail view — Phase 9.3
// Sections: Overview, Timeline, Attempt History, Logs
// Breadcrumb: Job Explorer → Queue: {name} → Job #{shortId}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { jobs } from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// ── Label mapping: internal strings → plain English ──────────────────────────
const STATUS_LABELS = {
  queued: 'Waiting',
  scheduled: 'Scheduled',
  claimed: 'Claimed',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  dead: 'Dead',
  cancelled: 'Cancelled',
};

const STATUS_COLORS = {
  queued: 'var(--status-queued)',
  scheduled: 'var(--color-info)',
  claimed: 'var(--color-warning)',
  running: 'var(--color-warning)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
  dead: 'var(--status-dead)',
  cancelled: 'var(--color-text-muted)',
};

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`badge badge-${status}`} style={{ fontSize: 'var(--font-xs)' }}>
      {label}
    </span>
  );
}

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

function duration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Timeline step component ───────────────────────────────────────────────────
function TimelineStep({ label, timestamp, done, active }) {
  let cls = 'pipeline-step pending';
  if (done) cls = 'pipeline-step done';
  else if (active) cls = 'pipeline-step active';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 90 }}>
      <div className={cls} style={{ width: 32, height: 32 }}>
        {done ? '✓' : active ? '●' : '○'}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
        {label}
      </span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: 90 }}>
        {timestamp ? new Date(timestamp).toLocaleTimeString() : '—'}
      </span>
    </div>
  );
}

// ── Log level badge ───────────────────────────────────────────────────────────
function LevelBadge({ level }) {
  const colors = {
    info: { bg: 'var(--color-info-light)', color: 'var(--color-info)' },
    warning: { bg: 'var(--color-warning-light)', color: 'var(--color-warning)' },
    error: { bg: 'var(--color-danger-light)', color: 'var(--color-danger)' },
    debug: { bg: 'var(--color-border-light)', color: 'var(--color-text-muted)' },
  };
  const style = colors[level?.toLowerCase()] || colors.debug;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      background: style.bg, color: style.color,
    }}>
      {level || 'info'}
    </span>
  );
}

export default function JobDetailPage() {
  const { queueId, jobId } = useParams();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  useEffect(() => {
    if (!queueId || !jobId) return;
    setLoading(true);
    jobs.get(queueId, jobId)
      .then(setJob)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [queueId, jobId]);

  async function handleExport(format) {
    setExportMsg('');
    const token = localStorage.getItem('access_token');
    const url = `${API_BASE}/queues/${queueId}/jobs/${jobId}/logs/export?format=${format}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { setExportMsg('Export failed.'); return; }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `job-${jobId.slice(0, 8)}-logs.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setExportMsg('Export failed.');
    }
  }

  if (loading) return (
    <div className="page-content" style={{ padding: 'var(--space-6)' }}>
      <div style={{ color: 'var(--color-text-muted)' }}>Loading…</div>
    </div>
  );

  if (error) return (
    <div className="page-content" style={{ padding: 'var(--space-6)' }}>
      <div style={{ color: 'var(--color-danger)' }}>{error}</div>
    </div>
  );

  if (!job) return null;

  const shortId = job.id.slice(0, 8);
  const statusColor = STATUS_COLORS[job.status] || 'var(--color-text-muted)';

  const timeline = [
    { label: 'Created', ts: job.created_at, done: true },
    { label: 'Scheduled', ts: job.run_at, done: !!job.claimed_at || ['running','completed','failed','dead'].includes(job.status) },
    { label: 'Claimed', ts: job.claimed_at, done: !!job.claimed_at, active: job.status === 'claimed' },
    { label: 'Running', ts: job.runs?.[job.runs.length - 1]?.started_at, done: ['completed','failed','dead'].includes(job.status), active: job.status === 'running' },
    { label: 'Finished', ts: job.runs?.[job.runs.length - 1]?.finished_at, done: ['completed','failed','dead','cancelled'].includes(job.status) },
  ];

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 1100, margin: '0 auto' }}>
      <Breadcrumb items={[
        { label: 'Job Explorer', to: '/jobs' },
        { label: `Queue: ${job.queue_name || queueId.slice(0,8)}`, to: '/jobs' },
        { label: `Job #${shortId}` },
      ]} />

      {/* ── 1. Overview ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--font-xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              {job.job_type}
              <span style={{ marginLeft: 10, fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                #{shortId}
              </span>
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)' }}>
              Queue: <strong>{job.queue_name || '—'}</strong>
            </div>
          </div>
          <StatusBadge status={job.status} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
          {[
            ['Priority', job.priority],
            ['Queue Position', job.queue_position != null ? `#${job.queue_position + 1} in queue` : '—'],
            ['Attempts', `${job.attempts_made} / ${job.max_attempts}`],
            ['Submitted by', job.created_by_email || '—'],
            ['Worker', job.claimed_by_worker_id ? `${job.claimed_worker_hostname || job.claimed_by_worker_id.slice(0,10)}` : '—'],
            ['Cron', job.cron_expression || 'One-time'],
          ].map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Payload */}
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Payload
          </div>
          <pre style={{
            background: 'var(--color-border-light)', borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)', fontSize: 12, overflowX: 'auto', maxHeight: 120,
            color: 'var(--color-text-primary)', margin: 0,
          }}>
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>

        {/* AI-generated failure explanation (Phase 10.5) */}
        {job.status === 'dead' && (
          <div style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            marginTop: 'var(--space-4)',
            borderLeft: '3px solid #ffffff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <strong style={{ fontSize: 'var(--font-xs)', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.5px' }}>JobRunR AI Failure Summary</strong>
            </div>
            <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)', margin: '0 0 6px 0', lineHeight: 1.4, fontWeight: 500 }}>
              {job.ai_failure_summary || 'Explanation not available (still generating or API offline).'}
            </p>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              ⚠️ Note: Automated JobRunR AI failure diagnostics.
            </span>
          </div>
        )}
      </div>

      {/* ── 2. Timeline ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Timeline</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto' }}>
          {timeline.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
              <TimelineStep label={step.label} timestamp={step.ts} done={step.done} active={step.active} />
              {i < timeline.length - 1 && (
                <div style={{
                  width: 32, height: 2, background: step.done ? 'var(--color-success)' : 'var(--color-border)',
                  marginTop: 15, flexShrink: 0,
                }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          {[
            ['Created', job.created_at],
            ['Scheduled to run', job.run_at],
            ['Claimed at', job.claimed_at],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)' }}>{fmt(val)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Attempt History ───────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Attempt History</div>
        {job.runs?.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>No attempts recorded yet.</div>
        ) : (
          <div className="table-container" style={{ boxShadow: 'none', border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Worker</th>
                  <th>Started</th>
                  <th>Finished</th>
                  <th>Duration</th>
                  <th>Outcome</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {(job.runs || []).sort((a, b) => a.attempt_number - b.attempt_number).map(run => (
                  <tr key={run.id}>
                    <td style={{ fontWeight: 600 }}>{run.attempt_number}</td>
                    <td className="td-mono">{run.worker_id.slice(0, 12)}</td>
                    <td style={{ fontSize: 'var(--font-xs)' }}>{fmt(run.started_at)}</td>
                    <td style={{ fontSize: 'var(--font-xs)' }}>{fmt(run.finished_at)}</td>
                    <td>{duration(run.duration_ms)}</td>
                    <td>
                      <span className={`badge badge-${run.status}`}>{run.status}</span>
                    </td>
                    <td style={{ fontSize: 'var(--font-xs)', color: 'var(--color-danger)', maxWidth: 240 }}>
                      {run.error_message ? (
                        <span title={run.error_message}>{run.error_message.slice(0, 80)}{run.error_message.length > 80 ? '…' : ''}</span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 4. Logs ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <div className="card-title">Logs</div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {exportMsg && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-danger)' }}>{exportMsg}</span>}
            <button className="btn btn-outline btn-sm" onClick={() => handleExport('csv')}>
              ↓ CSV
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => handleExport('pdf')}>
              ↓ PDF
            </button>
          </div>
        </div>
        {job.logs?.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>No log entries recorded yet.</div>
        ) : (
          <div style={{
            maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
            fontFamily: 'monospace', fontSize: 12,
          }}>
            {(job.logs || []).map(log => (
              <div key={log.id} style={{
                display: 'grid', gridTemplateColumns: '140px 60px auto',
                gap: 'var(--space-3)', padding: '4px 8px', borderRadius: 4,
                background: log.level === 'error' ? 'var(--color-danger-light)' : 'transparent',
              }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                  {new Date(log.logged_at).toLocaleTimeString()}
                </span>
                <LevelBadge level={log.level} />
                <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
