import { useEffect, useState } from 'react';
import { workers, connectWS, onWSMessage } from '../lib/api';
import Topbar from '../components/Topbar';
import Breadcrumb from '../components/Breadcrumb';
import EmptyState from '../components/EmptyState';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

const getFriendlyName = (id) => {
  if (!id) return '—';
  if (id.startsWith('high-')) {
    const num = id.split('-')[1] || '1';
    return `High-Performance Compute Node #${num}`;
  }
  if (id.startsWith('standard-')) {
    const num = id.split('-')[1] || '1';
    return `Standard Background Worker #${num}`;
  }
  return id;
};

export default function WorkersPage() {
  const [workersList, setWorkersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pingedWorkers, setPingedWorkers] = useState({}); // workerId -> timestamp of last ping

  useEffect(() => {
    connectWS();
    loadWorkers();

    const unsub = onWSMessage(msg => {
      if (msg.event === 'worker_heartbeat') {
        const { worker_id } = msg.data;
        setWorkersList(prev =>
          prev.map(w =>
            w.worker_id === worker_id
              ? { ...w, last_seen_at: new Date().toISOString(), status: 'active' }
              : w
          )
        );
        // Trigger ping flash
        setPingedWorkers(prev => ({ ...prev, [worker_id]: Date.now() }));
        setTimeout(() => {
          setPingedWorkers(prev => {
            const next = { ...prev };
            delete next[worker_id];
            return next;
          });
        }, 1000);
      }
    });

    return unsub;
  }, []);

  async function loadWorkers() {
    setLoading(true);
    try {
      const res = await workers.list();
      setWorkersList(res.items || []);
    } catch (e) {
      console.error('Failed to load workers:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Topbar
        title="Worker Monitor"
        subtitle={`${workersList.filter(w => w.status !== 'stopped').length} active worker processes connected`}
        actions={
          <button className="btn btn-outline btn-sm" onClick={loadWorkers}>
            ↻ Refresh
          </button>
        }
      />
      <div className="page-body">
        <Breadcrumb items={[
          { label: 'Workers', to: '/workers' },
          { label: 'Monitor' }
        ]} />
        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-title">Active Processes & Heartbeats</div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              ✦ Live connection monitor. Green indicators flash on heartbeat signal.
            </div>
          </div>

          {loading ? (
            <div className="loading-row"><div className="spinner" /> Loading workers…</div>
          ) : workersList.length === 0 ? (
            <EmptyState
              icon="⚙"
              title="No workers registered"
              subtitle="Start a worker process (worker/app/main.py) to see it register here and begin processing jobs."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>WORKER ID</th>
                  <th>TYPE</th>
                  <th>HOSTNAME</th>
                  <th>STATUS</th>
                  <th>CPU %</th>
                  <th>MEMORY MB</th>
                  <th>STARTED</th>
                  <th>LAST SEEN</th>
                  <th style={{ textAlign: 'center' }}>HEARTBEAT</th>
                </tr>
              </thead>
              <tbody>
                {workersList.map(w => {
                  const isPinged = !!pingedWorkers[w.worker_id];
                  const isOffline = (Date.now() - new Date(w.last_seen_at).getTime()) > 90000;
                  const displayStatus = w.status === 'stopped' || isOffline ? 'offline' : w.status;
                  const hb = w.latest_heartbeat;

                  return (
                    <tr key={w.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {getFriendlyName(w.worker_id)}
                        </div>
                        <div className="td-mono text-muted" style={{ fontSize: 10, marginTop: 2 }}>
                          ID: {w.worker_id}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12,
                          background: w.worker_type === 'high_compute' ? 'var(--color-primary-light)' : 'var(--color-border-light)',
                          color: w.worker_type === 'high_compute' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          fontWeight: 600 }}>
                          {w.worker_type || 'standard'}
                        </span>
                      </td>
                      <td>{w.hostname || '—'}</td>
                      <td>
                        <span className={`badge ${
                          displayStatus === 'active' ? 'badge-success' :
                          displayStatus === 'idle' ? 'badge-warning' :
                          'badge-danger'
                        }`}>
                          {displayStatus === 'active' ? 'Active' :
                           displayStatus === 'idle' ? 'Idle' : 'Offline'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: hb?.cpu_percent > 80 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                        {hb?.cpu_percent != null ? `${hb.cpu_percent}%` : '—'}
                      </td>
                      <td style={{ color: 'var(--color-text-secondary)' }}>
                        {hb?.memory_mb != null ? `${hb.memory_mb} MB` : '—'}
                      </td>
                      <td className="text-xs text-muted">{fmt(w.started_at)}</td>
                      <td className="text-xs text-muted">{fmt(w.last_seen_at)}</td>
                      <td style={{ textAlign: 'center', verticalAlign: 'middle', width: 80 }}>
                        {displayStatus === 'offline' ? (
                          <div style={{
                            width: 12, height: 12, borderRadius: '50%',
                            background: '#e4e4e7',
                            border: '1px solid var(--color-border)',
                            display: 'inline-block',
                            opacity: 0.4
                          }} />
                        ) : (
                          <div style={{ width: 48, height: 48, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                            <DotLottieReact
                              src="/animation.lottie"
                              loop
                              autoplay
                            />
                          </div>
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
