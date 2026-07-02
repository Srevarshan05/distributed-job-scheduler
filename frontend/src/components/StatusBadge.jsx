// src/components/StatusBadge.jsx
// Matches exactly: queued | scheduled | running | completed | failed | dead | cancelled

const LABELS = {
  queued:    'Queued',
  scheduled: 'Scheduled',
  running:   'Running',
  completed: 'Completed',
  failed:    'Failed',
  dead:      'Dead',
  cancelled: 'Cancelled',
  active:    'Active',
  paused:    'Paused',
  stopped:   'Stopped',
  idle:      'Idle',
};

export default function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  return (
    <span className={`badge badge-${s}`}>
      {LABELS[s] || status}
    </span>
  );
}
