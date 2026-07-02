// src/components/Breadcrumb.jsx
// Reusable breadcrumb navigation component.
// Takes an array of { label, to? } items — last item is not a link.
import { Link } from 'react-router-dom';

export default function Breadcrumb({ items = [] }) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-sm)', marginBottom: 'var(--space-5)' }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!isLast && item.to ? (
              <Link
                to={item.to}
                style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}
              >
                {item.label}
              </Link>
            ) : (
              <span style={{ color: isLast ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontWeight: isLast ? 600 : 400 }}>
                {item.label}
              </span>
            )}
            {!isLast && (
              <span style={{ color: 'var(--color-text-muted)' }}>›</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
