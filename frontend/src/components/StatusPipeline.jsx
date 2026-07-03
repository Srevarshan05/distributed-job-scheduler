// src/components/StatusPipeline.jsx
// Matches the Xenia CRM reference UI exactly:
// Step icons in a horizontal pipeline with arrows between them.
// Completed steps are filled green, active = orange, failed = red, pending = grey outline.

const STEPS = [
  { key: 'queued',    icon: <img src="/line.png" style={{ width: '12px', height: '12px', objectFit: 'contain' }} alt="" />, title: 'Queued' },
  { key: 'scheduled', icon: '⏰', title: 'Scheduled' },
  { key: 'running',   icon: <img src="/running.png" style={{ width: '12px', height: '12px', objectFit: 'contain' }} alt="" />, title: 'Running' },
  { key: 'completed', icon: <img src="/checked.png" style={{ width: '12px', height: '12px', objectFit: 'contain' }} alt="" />, title: 'Completed' },
  { key: 'failed',    icon: <img src="/delete.png" style={{ width: '12px', height: '12px', objectFit: 'contain' }} alt="" />, title: 'Failed' },
  { key: 'dead',      icon: <img src="/human-skull.png" style={{ width: '12px', height: '12px', objectFit: 'contain' }} alt="" />, title: 'Dead' },
];

// Map current status to which steps are "done" vs "active" vs "failed" vs "pending"
function resolveSteps(status) {
  const order = ['queued', 'scheduled', 'running', 'completed'];

  return STEPS.map((step) => {
    if (status === 'completed') {
      // All up to completed are done
      if (['queued', 'scheduled', 'running', 'completed'].includes(step.key)) {
        return { ...step, state: step.key === 'completed' ? 'done' : 'done' };
      }
      return { ...step, state: 'pending' };
    }

    if (status === 'dead' || status === 'failed') {
      if (step.key === 'dead' || step.key === 'failed') return { ...step, state: 'failed' };
      if (['queued', 'scheduled', 'running'].includes(step.key)) return { ...step, state: 'done' };
      return { ...step, state: 'pending' };
    }

    if (status === 'cancelled') {
      if (step.key === 'queued') return { ...step, state: 'done' };
      return { ...step, state: 'pending' };
    }

    const currentIdx = order.indexOf(status);
    const stepIdx    = order.indexOf(step.key);

    if (stepIdx < 0) return { ...step, state: 'pending' };
    if (stepIdx < currentIdx)  return { ...step, state: 'done' };
    if (stepIdx === currentIdx) return { ...step, state: 'active' };
    return { ...step, state: 'pending' };
  });
}

export default function StatusPipeline({ status, compact = false }) {
  const steps = resolveSteps(status);

  // In compact mode (table rows) only show relevant steps
  const visibleSteps = compact
    ? steps.filter(s => ['queued', 'running', 'completed', 'failed', 'dead'].includes(s.key))
    : steps;

  return (
    <div className="status-pipeline" title={`Current status: ${status}`}>
      {visibleSteps.map((step, i) => (
        <span key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span className="pipeline-arrow">→</span>}
          <span
            className={`pipeline-step ${step.state}`}
            title={step.title}
            style={{ fontSize: compact ? '10px' : '12px', width: compact ? '22px' : '28px', height: compact ? '22px' : '28px' }}
          >
            {step.icon}
          </span>
        </span>
      ))}
    </div>
  );
}
