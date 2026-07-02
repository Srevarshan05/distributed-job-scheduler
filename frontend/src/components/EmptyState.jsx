// src/components/EmptyState.jsx
// Reusable empty-state card shown when a list has no items.
// Plain labels, friendly message, optional call-to-action button.
export default function EmptyState({ icon = '📭', title, subtitle, actionLabel, onAction }) {
  const isImg = typeof icon === 'string' && (icon.endsWith('.png') || icon.startsWith('/') || icon.startsWith('data:'));
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-10) var(--space-6)',
      textAlign: 'center',
      gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isImg ? (
          <img src={icon} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
        ) : (
          <div style={{ fontSize: 48, lineHeight: 1 }}>{icon}</div>
        )}
      </div>
      <div style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', maxWidth: 380 }}>
          {subtitle}
        </div>
      )}
      {actionLabel && onAction && (
        <button
          className="btn btn-primary"
          onClick={onAction}
          style={{ marginTop: 'var(--space-2)' }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
