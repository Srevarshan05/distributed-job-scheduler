// src/pages/DLQPage.jsx
// Manage dead letter queue entries with manual retries and details (Phase 9.3).
// Renders Breadcrumbs, selector, and EmptyState components.

import { useEffect, useState } from 'react';
import { orgs, projects, queues, dlq } from '../lib/api';
import Topbar from '../components/Topbar';
import Breadcrumb from '../components/Breadcrumb';
import EmptyState from '../components/EmptyState';

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

export default function DLQPage() {
  const [allQueues, setAllQueues] = useState([]);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState('member_read_only');
  const [retrying, setRetrying] = useState({});
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    loadQueues();
  }, []);

  useEffect(() => {
    if (selectedQueue) {
      loadDLQ(selectedQueue);
    } else {
      setEntries([]);
    }
  }, [selectedQueue]);

  async function loadQueues() {
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
      if (qs.length > 0) {
        setSelectedQueue(qs[0].id);
      }
    } catch (e) {
      console.error('Failed to load queues:', e);
    }
  }

  async function loadDLQ(queueId) {
    setLoading(true);
    try {
      const res = await dlq.list(queueId);
      setEntries(res.items || []);
    } catch (e) {
      console.error('Failed to load DLQ:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry(entry) {
    setRetrying(prev => ({ ...prev, [entry.id]: true }));
    try {
      await dlq.retry(entry.id);
      await loadDLQ(selectedQueue);
    } catch (e) {
      alert(`Retry failed: ${e.message}`);
    } finally {
      setRetrying(prev => ({ ...prev, [entry.id]: false }));
    }
  }

  return (
    <>
      <Topbar
        title="Dead Letter Queue"
        subtitle="Manage failed jobs and trigger manual retries"
        actions={
          <button
            className="btn btn-outline btn-sm"
            onClick={() => selectedQueue && loadDLQ(selectedQueue)}
            disabled={!selectedQueue}
          >
            ↻ Refresh
          </button>
        }
      />
      <div className="page-body">
        <Breadcrumb items={[
          { label: 'Dead Letter Queue', to: '/dlq' },
          { label: 'Failures Log' }
        ]} />

        {/* Selector */}
        <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ fontSize: 'var(--font-sm)', fontWeight: 600, marginRight: 8, color: 'var(--color-text-secondary)' }}>
            Select Queue:
          </label>
          <select
            className="filter-select"
            value={selectedQueue}
            onChange={e => setSelectedQueue(e.target.value)}
            style={{ minWidth: 250 }}
          >
            <option value="">-- Choose a Queue --</option>
            {allQueues.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </div>

        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-title">DLQ Failures Log</div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              ✦ Inspect the execution error and trigger manual retry of dead jobs. Click a row to expand details.
            </div>
          </div>

          {!selectedQueue ? (
            <EmptyState
              icon="☠"
              title="No queue selected"
              subtitle="Choose a queue from the selector dropdown above to inspect dead jobs."
            />
          ) : loading ? (
            <div className="loading-row"><div className="spinner" /> Loading failures…</div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon="✓"
              title="DLQ is clean"
              subtitle="No failed jobs in this queue have exceeded their retry limit."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>JOB TYPE / ID</th>
                  <th style={{ width: '40%' }}>ERROR MESSAGE</th>
                  <th style={{ width: '15%' }}>FAILED AT</th>
                  <th style={{ width: '15%', textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => {
                  const isExpanded = expandedId === entry.id;
                  const isRetried = !!entry.retry_job_id;

                  return (
                    <tr
                      key={entry.id}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {entry.job_type || 'Unknown Job'}
                        </div>
                        <div className="td-mono mt-1" style={{ fontSize: 'var(--font-xs)' }}>
                          Job: {entry.job_id?.slice(0, 8)}…
                        </div>
                      </td>
                      <td>
                        <div
                          style={{
                            color: 'var(--color-danger)',
                            fontSize: 'var(--font-sm)',
                            fontWeight: 500,
                            whiteSpace: 'pre-wrap',
                            maxWidth: 500
                          }}
                        >
                          {entry.failure_reason || 'No failure reason provided'}
                        </div>
                        {isExpanded && (
                          <div style={{
                            marginTop: 10,
                            padding: 12,
                            background: 'var(--color-border-light)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--font-xs)',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--color-text-secondary)',
                          }} onClick={e => e.stopPropagation()}>
                            <strong>Attempts Made:</strong> {entry.total_attempts}
                            <br />
                            <strong>DLQ Entry ID:</strong> {entry.id}
                            {entry.retry_job_id && (
                              <>
                                <br />
                                <strong>Retried Job ID:</strong> {entry.retry_job_id}
                                <br />
                                <strong>Retried At:</strong> {fmt(entry.retried_at)}
                              </>
                            )}
                            <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 8, paddingTop: 8 }}>
                              <strong>🤖 JobRunR AI Failure Summary:</strong>
                              <div style={{
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text-primary)',
                                padding: '10px 14px',
                                borderRadius: 'var(--radius-sm)',
                                marginTop: 6,
                                marginBottom: 6,
                                fontFamily: 'inherit',
                                lineHeight: 1.4,
                                borderLeft: '3px solid #ffffff',
                                fontWeight: 500
                              }}>
                                {entry.ai_failure_summary || 'Explanation not available (still generating or API offline).'}
                                <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic', fontWeight: 400 }}>
                                  ⚠️ Note: Automated JobRunR AI failure diagnostics.
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="text-xs text-muted">{fmt(entry.promoted_at)}</td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        {isRetried ? (
                          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            ✓ Retried
                          </span>
                        ) : userRole === 'member_read_only' ? (
                          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            Read Only
                          </span>
                        ) : (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleRetry(entry)}
                            disabled={retrying[entry.id]}
                            style={{ minWidth: 85 }}
                          >
                            {retrying[entry.id] ? 'Retrying…' : 'Retry Job'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
