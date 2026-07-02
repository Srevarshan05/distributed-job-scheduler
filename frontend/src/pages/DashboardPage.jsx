import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { orgs, projects, queues, jobs, onWSMessage, connectWS, health, dlq } from '../lib/api';
import StatusPipeline from '../components/StatusPipeline';
import StatusBadge from '../components/StatusBadge';
import JobDrawer from '../components/JobDrawer';
import Topbar from '../components/Topbar';
import trackLogo from '../assets/track.png';
import cpuTowerLogo from '../assets/cpu-tower.png';
import hardDiskLogo from '../assets/hard-disk.png';

const STATUSES = ['queued', 'scheduled', 'running', 'completed', 'failed', 'dead'];

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

const renderSparkline = (data, label, maxVal = 100, unit = '%') => {
  if (!data || data.length === 0) return null;
  const width = 280;
  const height = 40;
  
  // Scale points
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - (Math.min(maxVal, val) / maxVal) * (height - 6) - 3;
    return `${x},${y}`;
  });
  
  const fillPoints = `0,${height} ${points.join(' ')} ${width},${height}`;
  const linePoints = points.join(' ');
  
  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--color-border)', paddingTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
        <span>Real-Time {label} History</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>Current: {Math.round(data[data.length - 1])}{unit}</span>
      </div>
      <div style={{ background: '#fafafa', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
          {/* Grid line */}
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#e4e4e7" strokeDasharray="3,3" />
          
          {/* Area Fill */}
          <polygon
            points={fillPoints}
            fill="rgba(9, 9, 11, 0.06)"
          />
          {/* Outline Line */}
          <polyline
            points={linePoints}
            fill="none"
            stroke="#09090b"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};

export default function DashboardPage() {
  const [allJobs, setAllJobs] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [orgId, setOrgId] = useState(null);
  const [queueMap, setQueueMap] = useState({});
  const [systemHealth, setSystemHealth] = useState(null);
  const [dlqEntries, setDlqEntries] = useState([]);
  const [telemetryHistory, setTelemetryHistory] = useState({});

  useEffect(() => {
    connectWS();
    loadData();
    loadHealth();
    const unsub = onWSMessage(msg => {
      if (msg.event === 'job_status_changed') {
        setAllJobs(prev =>
          prev.map(j =>
            j.id === msg.data.job_id ? { ...j, status: msg.data.status } : j
          )
        );
        computeStats();
        if (msg.data.status === 'dead') {
          loadData();
        }
      }
      if (msg.event === 'worker_heartbeat') {
        // Refresh full health on heartbeat — real numbers, not extrapolated
        loadHealth();
        const { worker_id, cpu_percent, memory_mb } = msg.data;
        setTelemetryHistory(prev => {
          const wHist = prev[worker_id] || { cpu: Array(15).fill(0), mem: Array(15).fill(0) };
          const nextCpu = [...wHist.cpu, cpu_percent ?? 0].slice(-15);
          const nextMem = [...wHist.mem, memory_mb ?? 0].slice(-15);
          return {
            ...prev,
            [worker_id]: { cpu: nextCpu, mem: nextMem }
          };
        });
      }
    });
    return unsub;
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const orgList = await orgs.list();
      if (!orgList.items?.length) { setLoading(false); return; }
      const org = orgList.items[0];
      setOrgId(org.id);

      const projList = await projects.list(org.id);
      const allQueues = [];
      const qm = {};
      for (const proj of projList.items || []) {
        const qList = await queues.list(org.id, proj.id);
        for (const q of qList.items || []) {
          allQueues.push({ ...q, orgId: org.id, projectId: proj.id });
          qm[q.id] = q;
        }
      }
      setQueueMap(qm);

      const jobResults = await Promise.all(
        allQueues.map(q => jobs.list(q.id, { page_size: 20 }).catch(() => ({ items: [] })))
      );
      const flatJobs = jobResults.flatMap(r => r.items || []).slice(0, 100);
      setAllJobs(flatJobs);
      computeStatsFromJobs(flatJobs);

      // Load recent DLQ entries for all queues (Phase 10.5)
      const dlqResults = await Promise.all(
        allQueues.map(q => dlq.list(q.id).catch(() => ({ items: [] })))
      );
      const flatDLQ = dlqResults
        .flatMap(r => r.items || [])
        .sort((a, b) => new Date(b.promoted_at) - new Date(a.promoted_at))
        .slice(0, 3);
      setDlqEntries(flatDLQ);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadHealth() {
    try {
      const h = await health.system();
      setSystemHealth(h);
      if (h?.workers) {
        setTelemetryHistory(prev => {
          const next = { ...prev };
          let changed = false;
          for (const w of h.workers) {
            if (!next[w.worker_id]) {
              const initCpu = w.cpu_percent ?? 0;
              const initMem = w.memory_mb ?? 0;
              next[w.worker_id] = {
                cpu: Array(15).fill(initCpu),
                mem: Array(15).fill(initMem)
              };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    } catch { /* non-blocking */ }
  }

  function computeStatsFromJobs(jobList) {
    const s = {};
    for (const status of STATUSES) s[status] = 0;
    for (const j of jobList) {
      if (s[j.status] !== undefined) s[j.status]++;
    }
    s['failed'] = (s['failed'] || 0) + (s['dead'] || 0);
    setStats(s);
  }

  function computeStats() {
    computeStatsFromJobs(allJobs);
  }

  const filtered = statusFilter ? allJobs.filter(j => j.status === statusFilter) : allJobs;

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle="Live overview of all job activity"
        actions={
          <button className="btn btn-outline btn-sm" onClick={loadData}>↻ Refresh</button>
        }
      />
      <div className="page-body">
        {/* Getting Started Guide */}
        {((!loading && allJobs.length === 0) || (systemHealth && systemHealth.queues.length === 0)) && (
          <div className="card" style={{
            background: 'linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-surface) 100%)',
            border: '1px solid var(--color-primary-light)',
            marginBottom: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={trackLogo} alt="Track" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              <div>
                <h3 style={{ fontSize: 'var(--font-md)', fontWeight: 700, color: 'var(--color-primary)', margin: 0 }}>Getting Started with JobScheduler</h3>
                <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>Complete these three steps to begin running your background tasks.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
              <div style={{ background: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-primary)' }}>
                  <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>1</span>
                  Create Your First Queue
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 10px 0' }}>Queues partition your jobs and route them to standard or high-compute worker nodes.</p>
                <Link to="/queues" className="btn btn-outline btn-sm" style={{ textDecoration: 'none', display: 'inline-block' }}>Go to Queues ➔</Link>
              </div>
              <div style={{ background: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-primary)' }}>
                  <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>2</span>
                  Submit a Background Job
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 10px 0' }}>Submit a task to the queue. You can run email alerts, sleep tests, or custom compute jobs.</p>
                <Link to="/jobs" className="btn btn-outline btn-sm" style={{ textDecoration: 'none', display: 'inline-block' }}>Submit Job ➔</Link>
              </div>
              <div style={{ background: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-primary)' }}>
                  <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>3</span>
                  Watch It Run Live
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 10px 0' }}>Workers pick up claimed tasks automatically. Watch status pipelines update live in real-time.</p>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Monitoring active...</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Dashboard Split Columns: Left (Stats, Failures, Queues) vs Right (Compute Telemetry) */}
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          
          {/* Left Column (Stats + Failures + Queues): Flex 1.2 */}
          <div style={{ flex: '1.2 1 450px', display: 'flex', flexDirection: 'column' }}>
            
            {/* Stat Cards 3x2 Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
              <StatCard label="Queued"    value={stats.queued    ?? '—'} desc="Waiting for worker pickup" />
              <StatCard label="Scheduled" value={stats.scheduled ?? '—'} colorClass="primary" desc="Delayed/cron jobs" />
              <StatCard label="Running"   value={stats.running   ?? '—'} colorClass="warning" desc="Actively processing (Pulsing)" />
              <StatCard label="Completed" value={stats.completed ?? '—'} colorClass="success" desc="Completed successfully (Good)" />
              <StatCard label="Failed"    value={stats.failed    ?? '—'} colorClass="danger" desc="Unsuccessful attempts" />
              <StatCard label="Dead"      value={stats.dead      ?? '—'} desc="DLQ promoted (Needs action)" />
            </div>

            {/* JobRunR Failure Summary Explanation using Gen AI */}
            <div className="table-container" style={{ marginTop: 'var(--space-5)' }}>
              <div className="table-toolbar">
                <div>
                  <div className="table-toolbar-title">JobRunR Failure Summary Explanation using Gen AI</div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    ✦ Live automated diagnostics of dead-letter queue promotions. Click card to inspect timeline.
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="loading-row"><div className="spinner" /> Loading failures…</div>
              ) : dlqEntries.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" style={{ fontSize: 36, color: 'var(--color-text-muted)' }}>✓</div>
                  <div className="empty-state-title">No job failures recorded</div>
                  <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-sm)' }}>
                    All systems operating cleanly. Zero dead-letter promotions.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
                  {dlqEntries.map(entry => (
                    <div key={entry.id} className="fade-in-row" style={{
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-4)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)'
                    }} onClick={() => setSelected({ queueId: entry.queue_id, jobId: entry.job_id })}>
                      
                      {/* Top Bar: Job Type, ID and Time */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="badge badge-dead" style={{ background: '#09090b', color: '#ffffff', fontSize: 10, padding: '2px 6px', textTransform: 'uppercase', fontWeight: 700 }}>Dead</span>
                          <strong style={{ fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 700 }}>
                            {entry.job_type}
                          </strong>
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                            ID: {entry.job_id.slice(0, 8)}…
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          Promoted {fmt(entry.promoted_at)}
                        </span>
                      </div>

                      {/* High-Readability Gen AI explanation block */}
                      <div style={{
                        background: '#fafafa',
                        borderLeft: '4px solid #09090b',
                        padding: 'var(--space-3) var(--space-4)',
                        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                        margin: '2px 0'
                      }}>
                        <p style={{ margin: 0, fontSize: 14, color: '#09090b', fontWeight: 500, lineHeight: 1.5, letterSpacing: '-0.1px' }}>
                          {entry.ai_failure_summary || 'Gen AI failure diagnosis is being generated in the background...'}
                        </p>
                      </div>

                      {/* Metadata: Raw Error & Attempts */}
                      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        <span><strong>Raw Error:</strong> <code style={{ background: '#f4f4f5', padding: '2px 4px', borderRadius: 3 }}>{entry.failure_reason}</code></span>
                        <span>·</span>
                        <span><strong>Attempts:</strong> {entry.total_attempts}</span>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Queues & Depths */}
            <div className="card" style={{ marginTop: 'var(--space-5)' }}>
              <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
                Active Queues & Depths
                {systemHealth && (
                  <span style={{ fontSize: 'var(--font-xs)', fontWeight: 400, marginLeft: 10, color: 'var(--color-text-muted)' }}>
                    {systemHealth.total_running_jobs} active running total
                  </span>
                )}
              </div>

              {!systemHealth ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>Loading queue depths…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {systemHealth.queues.length === 0 && (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>No active queue subscriptions.</div>
                  )}
                  {systemHealth.queues.map(q => (
                    <div key={q.queue_id} className={q.running_count > 0 ? "pulse-telemetry" : ""} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: 'var(--space-3)',
                      background: 'var(--color-bg)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}>
                      <div>
                        <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {q.queue_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {q.scheduling_policy} · {q.required_worker_type}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                          {q.queued_count} waiting
                        </span>
                        {q.running_count > 0 && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, border: '1px solid #09090b', color: '#09090b', fontWeight: 700 }}>
                            {q.running_count} running
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column (Compute Telemetry): Flex 1 */}
          <div style={{ flex: '1 1 350px', display: 'flex', flexDirection: 'column' }}>
            <div className="card" style={{ width: '100%' }}>
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                <span>Worker Compute & Telemetry</span>
                <button className="btn btn-outline btn-sm" onClick={loadHealth}>↻ Refresh</button>
              </div>

              {!systemHealth ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>Loading worker telemetry…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {systemHealth.workers.length === 0 && (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>No active compute nodes registered.</div>
                  )}
                  {systemHealth.workers.map(w => {
                    const cpuHistory = telemetryHistory[w.worker_id]?.cpu || [w.cpu_percent ?? 0];
                    const memHistory = telemetryHistory[w.worker_id]?.mem || [w.memory_mb ?? 0];
                    
                    return (
                      <div key={w.worker_id} className={w.online && w.current_job_id ? "shimmer-processing" : ""} style={{
                        padding: 'var(--space-4)',
                        background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-3)',
                      }}>
                        {/* Worker Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{
                                width: 10, height: 10, borderRadius: '50%',
                                background: w.online ? 'var(--color-success)' : 'var(--color-text-muted)',
                              }} />
                              <strong style={{ fontSize: 'var(--font-md)', color: 'var(--color-text-primary)', fontWeight: 700 }}>
                                {getFriendlyName(w.worker_id)}
                              </strong>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, marginLeft: 16 }}>
                              ID: {w.worker_id} · Type: <code style={{ fontSize: 11 }}>{w.worker_type}</code>
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', background: '#f4f4f5', padding: '2px 8px', borderRadius: 10 }}>
                            {w.hostname || 'Local'}
                          </span>
                        </div>

                        {/* Active Task / Load */}
                        <div style={{ background: '#fafafa', padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Active Compute Load:</span>
                          {w.current_job_id ? (
                            <span style={{ fontSize: 12, color: '#09090b', fontWeight: 800 }}>
                              Claimed Job #{w.current_job_id.slice(0, 8)}…
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>Idle</span>
                          )}
                        </div>

                        {/* CPU Tower Progress */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                          <img src={cpuTowerLogo} alt="CPU" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                              <span>CPU Core load</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{Math.round(w.cpu_percent || 0)}%</span>
                            </div>
                            <div style={{ height: 8, background: '#e4e4e7', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
                              <div style={{ width: `${w.cpu_percent || 0}%`, height: '100%', background: '#09090b', transition: 'width 0.4s ease' }} />
                            </div>
                          </div>
                        </div>

                        {/* Memory Disk Progress */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <img src={hardDiskLogo} alt="Memory" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                              <span>Memory footprint</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{Math.round(w.memory_mb || 0)} MB</span>
                            </div>
                            <div style={{ height: 8, background: '#e4e4e7', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
                              <div style={{ width: `${Math.min(100, ((w.memory_mb || 0) / 8192) * 100)}%`, height: '100%', background: '#71717a', transition: 'width 0.4s ease' }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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

function StatCard({ label, value, colorClass, desc }) {
  return (
    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="stat-label" style={{ fontSize: 'var(--font-xs)', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className={`stat-value${colorClass ? ' ' + colorClass : ''}`} style={{ fontSize: 28, fontWeight: 700 }}>{value}</span>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-secondary)' }}>{label.toLowerCase()}</span>
      </div>
      {desc && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{desc}</div>
      )}
    </div>
  );
}
