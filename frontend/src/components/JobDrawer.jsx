// src/components/JobDrawer.jsx
// Right-side drawer showing full job detail with the status pipeline timeline.
// Matches the Xenia CRM "recipient timeline drawer" reference.

import { useEffect, useState } from 'react';
import { jobs } from '../lib/api';
import StatusPipeline from './StatusPipeline';
import StatusBadge from './StatusBadge';

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

function duration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function JobDrawer({ queueId, jobId, onClose }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!queueId || !jobId) return;
    setLoading(true);
    jobs.get(queueId, jobId)
      .then(setJob)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [queueId, jobId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Job Detail</div>
            {job && (
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                {job.job_type} · {job.id?.slice(0, 8)}…
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {loading && (
            <div className="loading-row"><div className="spinner" /> Loading…</div>
          )}

          {!loading && job && (
            <>
              {/* Status Pipeline — the key reference UI element */}
              <div style={{ marginBottom: 'var(--space-5)' }}>
                <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                  STATUS PIPELINE
                </div>
                <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', border: '1px solid var(--color-border)' }}>
                  <StatusPipeline status={job.status} />
                </div>
              </div>

              {/* Meta */}
              <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                <table style={{ width: '100%', fontSize: 'var(--font-sm)' }}>
                  <tbody>
                    {[
                      ['Status',       <StatusBadge status={job.status} />],
                      ['Job Type',     <code style={{ background: 'var(--color-border-light)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-xs)' }}>{job.job_type}</code>],
                      ['Priority',     job.priority],
                      ['Attempts',     `${job.attempts_made} / ${job.max_attempts}`],
                      ['Run At',       fmt(job.run_at)],
                      ['Claimed By',   job.claimed_by_worker_id || '—'],
                      ['Claimed At',   fmt(job.claimed_at)],
                      ['Created',      fmt(job.created_at)],
                      ['Cron',         job.cron_expression || '—'],
                      ['Submitted By', (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 20, height: 20, borderRadius: '50%',
                            background: 'var(--color-border)', fontSize: 10, fontWeight: 700,
                            color: 'var(--color-text-secondary)', flexShrink: 0
                          }}>
                            {(job.created_by_email || 'S')[0].toUpperCase()}
                          </span>
                          <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                            {job.created_by_email || 'system'}
                          </span>
                        </div>
                      )],
                    ].map(([label, val]) => (
                      <tr key={label} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                        <td style={{ padding: '6px 0', color: 'var(--color-text-muted)', width: 110, fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</td>
                        <td style={{ padding: '6px 0' }}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Payload */}
              <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Payload</div>
                <pre style={{ fontSize: 'var(--font-xs)', background: 'var(--color-border-light)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', overflow: 'auto', maxHeight: 160 }}>
                  {JSON.stringify(job.payload, null, 2)}
                </pre>
              </div>

              {/* Run History — the timeline */}
              {job.runs?.length > 0 && (
                <div>
                  <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                    RUN HISTORY ({job.runs.length})
                  </div>
                  <div className="timeline">
                    {[...job.runs].reverse().map((run) => (
                      <div className="timeline-item" key={run.id}>
                        <div className={`timeline-dot ${run.status}`}>
                          {run.status === 'completed' ? '✓' : run.status === 'failed' ? '✕' : '▶'}
                        </div>
                        <div className="timeline-title">
                          Attempt #{run.attempt_number} — <StatusBadge status={run.status} />
                        </div>
                        <div className="timeline-meta">
                          {fmt(run.started_at)} · {duration(run.duration_ms)}
                          {run.worker_id && ` · ${run.worker_id}`}
                        </div>
                        {run.error_message && (
                          <div className="timeline-detail">{run.error_message}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
