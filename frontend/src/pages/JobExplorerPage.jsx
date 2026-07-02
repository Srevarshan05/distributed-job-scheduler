// src/pages/JobExplorerPage.jsx
// Full job explorer with STATUS PIPELINE column, filters, and drawer.
// Tab bar matches the Xenia CRM step navigation reference.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orgs, projects, queues, jobs, connectWS, onWSMessage } from '../lib/api';
import StatusPipeline from '../components/StatusPipeline';
import StatusBadge from '../components/StatusBadge';
import JobDrawer from '../components/JobDrawer';
import Topbar from '../components/Topbar';
import Breadcrumb from '../components/Breadcrumb';
import EmptyState from '../components/EmptyState';

const STATUS_TABS = [
  { key: '', label: 'All', icon: '⊞' },
  { key: 'queued', label: 'Queued', icon: '●' },
  { key: 'running', label: 'Running', icon: '▶' },
  { key: 'completed', label: 'Completed', icon: '✓' },
  { key: 'failed', label: 'Failed', icon: '✕' },
  { key: 'dead', label: 'Dead', icon: '☠' },
];

const BUILTIN_TYPES = ['send_email', 'sleep', 'random_fail', 'always_fail'];

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

export default function JobExplorerPage() {
  const navigate = useNavigate();
  const [allQueues, setAllQueues] = useState([]);
  const [allJobs, setAllJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [activeTab, setActiveTab] = useState('');
  const [userRole, setUserRole] = useState('member_read_only');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  // Job creation modal state
  const [showCreate, setShowCreate] = useState(false);
  const [formQueue, setFormQueue] = useState('');
  const [formType, setFormType] = useState('send_email');
  const [formPriority, setFormPriority] = useState(0);
  const [formMaxAttempts, setFormMaxAttempts] = useState(3);
  const [formPayload, setFormPayload] = useState('{\n  "to": "user@example.com",\n  "subject": "Hello World"\n}');
  const [timingType, setTimingType] = useState('immediate');
  const [formRunAt, setFormRunAt] = useState('');
  const [formCron, setFormCron] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  const PAYLOAD_EXAMPLES = {
    send_email: '{\n  "to": "user@example.com",\n  "subject": "System Notification",\n  "body": "This is a background task notification."\n}',
    sleep: '{\n  "seconds": 10\n}',
    random_fail: '{\n  "failure_probability": 0.5\n}',
    always_fail: '{\n  "error_message": "Intentional failure for testing retry pipeline."\n}'
  };

  useEffect(() => {
    if (PAYLOAD_EXAMPLES[formType]) {
      setFormPayload(PAYLOAD_EXAMPLES[formType]);
    }
  }, [formType]);

  useEffect(() => {
    connectWS();
    loadAll();
    const unsub = onWSMessage(msg => {
      if (msg.event === 'job_status_changed') {
        setAllJobs(prev =>
          prev.map(j => j.id === msg.data.job_id ? { ...j, status: msg.data.status } : j)
        );
      }
    });
    return unsub;
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const orgList = await orgs.list();
      if (!orgList.items?.length) return;
      const org = orgList.items[0];
      setUserRole(org.role || 'member_read_only');
      const projList = await projects.list(org.id);
      const qs = [];
      for (const proj of projList.items || []) {
        const qList = await queues.list(org.id, proj.id);
        qs.push(...(qList.items || []).map(q => ({ ...q, orgId: org.id, projectId: proj.id })));
      }
      setAllQueues(qs);
      if (qs.length > 0 && !formQueue) {
        setFormQueue(qs[0].id);
      }

      const jobResults = await Promise.all(
        qs.map(q => jobs.list(q.id, { page_size: 50 }).catch(() => ({ items: [] })))
      );
      const flat = jobResults.flatMap(r => r.items || []);
      setAllJobs(flat);
    } catch (err) {
      console.error('Failed to load data in explorer:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateJob(e) {
    e.preventDefault();
    setFormError('');
    setCreating(true);

    let parsedPayload = {};
    try {
      if (formPayload.trim()) {
        parsedPayload = JSON.parse(formPayload);
      }
    } catch {
      setFormError('Invalid JSON format in payload.');
      setCreating(false);
      return;
    }

    if (!formQueue) {
      setFormError('Please select a queue.');
      setCreating(false);
      return;
    }

    const body = {
      job_type: formType,
      payload: parsedPayload,
      priority: parseInt(formPriority),
      max_attempts: parseInt(formMaxAttempts),
    };

    if (timingType === 'delayed' && formRunAt) {
      body.run_at = new Date(formRunAt).toISOString();
    } else if (timingType === 'cron' && formCron) {
      body.cron_expression = formCron;
    }

    try {
      await jobs.create(formQueue, body);
      setShowCreate(false);
      // Reset form
      setFormPriority(0);
      setFormMaxAttempts(3);
      setTimingType('immediate');
      setFormRunAt('');
      setFormCron('');
      setFormPayload('{\n  "to": "user@example.com",\n  "subject": "Hello World"\n}');
      // Reload list
      await loadAll();
    } catch (err) {
      setFormError(err.message || 'Failed to create job.');
    } finally {
      setCreating(false);
    }
  }

  const queueMap = Object.fromEntries(allQueues.map(q => [q.id, q]));

  const filtered = allJobs.filter(j => {
    if (selectedQueue && j.queue_id !== selectedQueue) return false;
    if (activeTab && j.status !== activeTab) return false;
    if (search && !j.job_type.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Tab counts
  const counts = {};
  for (const j of allJobs) counts[j.status] = (counts[j.status] || 0) + 1;
  counts['failed'] = (counts['failed'] || 0) + (counts['dead'] || 0);

  return (
    <>
      <Topbar
        title="Job Explorer"
        subtitle={`${allJobs.length} total jobs across ${allQueues.length} queues`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {userRole !== 'member_read_only' && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                + Create Job
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={loadAll}>
              ↻ Refresh
            </button>
          </div>
        }
      />
      <div className="page-body">
        <Breadcrumb items={[
          { label: 'Job Explorer', to: '/jobs' },
          { label: 'All Jobs' }
        ]} />

        {/* Tab bar — mimics Xenia step nav */}
        <div className="tabs">
          {STATUS_TABS.map((tab, i) => (
            <button
              key={tab.key}
              className={`tab-item${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {i > 0 && <span className="tab-number">{i}</span>}
              <span>{tab.icon}</span>
              {tab.label}
              {tab.key && counts[tab.key] ? (
                <span style={{ marginLeft: 4, fontSize: 'var(--font-xs)', opacity: 0.8 }}>
                  ({counts[tab.key]})
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <div className="search-input">
            <span style={{ color: 'var(--color-text-muted)' }}>🔍</span>
            <input
              placeholder="Search by job type…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={selectedQueue}
            onChange={e => setSelectedQueue(e.target.value)}
          >
            <option value="">All Queues</option>
            {allQueues.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </div>

        {/* Job table */}
        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-title">
              RECIPIENT ATTRIBUTION LOG
            </div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
              ✦ Click row to inspect timeline drawer. Use buttons to simulate action events.
            </div>
          </div>

          {loading ? (
            <div className="loading-row"><div className="spinner" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="◈"
              title="No jobs found"
              subtitle="Adjust your filters or submit a new job using the button above."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>JOB TYPE</th>
                  <th>QUEUE</th>
                  <th>STATUS PIPELINE</th>
                  <th>SELECTION REASON</th>
                  <th style={{ textAlign: 'right' }}>ATTEMPTS</th>
                  <th>ACTION SIMULATION</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(job => (
                  <tr key={job.id} className="fade-in-row" onClick={() => setSelected({ queueId: job.queue_id, jobId: job.id })}>
                    <td>
                      <span className="td-link">{job.job_type}</span>
                      <div className="td-mono mt-1">{job.id?.slice(0, 8)}…</div>
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-xs)' }}>
                      {queueMap[job.queue_id]?.name || '—'}
                    </td>
                    <td>
                      <StatusPipeline status={job.status} compact />
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-xs)' }}>
                      {job.cron_expression
                        ? `Cron: ${job.cron_expression}`
                        : `Priority: ${job.priority}`}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 600 }}>{job.attempts_made}</span>
                      <span className="text-muted">/{job.max_attempts}</span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <StatusBadge status={job.status} />
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ padding: '2px 8px', fontSize: 10 }}
                          onClick={() => navigate(`/jobs/${job.queue_id}/${job.id}`)}
                        >
                          Details
                        </button>
                        {(job.status === 'queued' || job.status === 'scheduled') && userRole !== 'member_read_only' && (
                          <button
                            className="btn btn-danger btn-sm"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            onClick={async () => {
                              try {
                                await jobs.cancel(job.queue_id, job.id);
                                loadAll();
                              } catch (err) {
                                alert(`Failed to cancel job: ${err.message}`);
                              }
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Job Modal */}
      {showCreate && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Submit New Job</h3>
              <button onClick={() => setShowCreate(false)} style={{ fontSize: 18, color: 'var(--color-text-secondary)' }}>&times;</button>
            </div>
            <form onSubmit={handleCreateJob} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {formError && (
                <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)' }}>
                  {formError}
                </div>
              )}
              
              {/* Destination Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Routing & Task Action</h4>
                <div style={formRowStyle}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Destination Queue</label>
                    <select className="filter-select" value={formQueue} onChange={e => setFormQueue(e.target.value)} required style={{ width: '100%' }}>
                      <option value="">-- Select Queue --</option>
                      {allQueues.map(q => (
                        <option key={q.id} value={q.id}>{q.name} ({q.required_worker_type === 'high_compute' ? 'High Compute' : 'Standard'})</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Select the queue that will receive and process this background task.
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Task Action (Job Type)</label>
                    <select className="filter-select" value={formType} onChange={e => setFormType(e.target.value)} required style={{ width: '100%' }}>
                      <option value="send_email">📧 Send Email Notification</option>
                      <option value="sleep">⏱ Simulate Idle Delay</option>
                      <option value="random_fail">🎲 Simulate Flaky Task</option>
                      <option value="always_fail">⚠️ Simulate Permanent Failure</option>
                    </select>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Choose the specific code function this task will execute.
                    </span>
                  </div>
                </div>
              </div>

              {/* Priority & Retries Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Priority & Failure Handlers</h4>
                <div style={formRowStyle}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Task Urgency (Priority 0-100)</label>
                    <input type="number" min="0" max="100" className="filter-select" value={formPriority} onChange={e => setFormPriority(e.target.value)} required style={{ width: '100%', padding: '8px 12px' }} />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Set urgency level. Higher values run first when workers are busy. (Default is 0).
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Retry Limit</label>
                    <input type="number" min="1" max="50" className="filter-select" value={formMaxAttempts} onChange={e => setFormMaxAttempts(e.target.value)} required style={{ width: '100%', padding: '8px 12px' }} />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      How many times the task should auto-retry on errors before giving up. (Default is 3).
                    </span>
                  </div>
                </div>
              </div>

              {/* Timing Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Timing & Schedule</h4>
                <div>
                  <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 4, marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-sm)', fontWeight: 400 }}>
                      <input type="radio" checked={timingType === 'immediate'} onChange={() => setTimingType('immediate')} /> Immediate (Run Now)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-sm)', fontWeight: 400 }}>
                      <input type="radio" checked={timingType === 'delayed'} onChange={() => setTimingType('delayed')} /> Delayed (Run at specific time)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-sm)', fontWeight: 400 }}>
                      <input type="radio" checked={timingType === 'cron'} onChange={() => setTimingType('cron')} /> Recurring Schedule (Cron)
                    </label>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 8 }}>
                    Set when the background task becomes eligible for workers to claim.
                  </span>
                </div>

                {timingType === 'delayed' && (
                  <div style={{ marginTop: 8 }}>
                    <label style={labelStyle}>Execution Time</label>
                    <input type="datetime-local" className="filter-select" value={formRunAt} onChange={e => setFormRunAt(e.target.value)} required style={{ width: '100%', padding: '8px 12px' }} />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      The future date and time this task will start running.
                    </span>
                  </div>
                )}

                {timingType === 'cron' && (
                  <div style={{ marginTop: 8 }}>
                    <label style={labelStyle}>Cron Expression (e.g. `*/5 * * * *`)</label>
                    <input placeholder="*/5 * * * *" className="filter-select" value={formCron} onChange={e => setFormCron(e.target.value)} required style={{ width: '100%', padding: '8px 12px' }} />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                      Time interval code (e.g. `*/5 * * * *` to run every 5 minutes).
                    </span>
                  </div>
                )}
              </div>

              {/* Payload Group */}
              <div>
                <h4 style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 12, fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Task Parameters (JSON Data)</h4>
                <textarea rows="3" value={formPayload} onChange={e => setFormPayload(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-sm)', background: 'var(--color-surface)', outline: 'none' }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                  Input variables for the task. Automatically changes based on selected task action.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Submitting…' : 'Submit Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <JobDrawer
          queueId={selected.queueId}
          jobId={selected.jobId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// Modal Inline Styles
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
  width: 500,
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
